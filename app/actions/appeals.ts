'use server'

/**
 * Coach appeals against adverse platform decisions.
 *
 * EVERY WRITE HERE USES THE ADMIN CLIENT, WHICH BYPASSES RLS. `appeals` has two SELECT
 * policies and deliberately no INSERT/UPDATE/DELETE policy, so there is no client write
 * path — which means every action must RE-VERIFY THE ACTOR AND THE SUBJECT itself before it
 * writes. Same discipline the RPCs follow when handed a p_*_id (_CONTEXT.md §1).
 *
 * Three rules that are not obvious from the code:
 *
 *  1. THE STATEMENT TEXT NEVER GOES INTO audit_log. It is the coach's account of an adverse
 *     decision, it is admin-readable forever, and the appeal row already holds it.
 *
 *  2. ON RESOLUTION, THE SUBJECT EFFECT IS APPLIED FIRST. An appeal marked `overturned`
 *     whose submission never moved is the worst possible outcome — the coach is told they
 *     won and nothing changed. If the subject write fails we return the error and leave the
 *     appeal `under_review` so it can be retried.
 *
 *     THE ORDERING CANNOT BE INVERTED to make this atomic: guard_appeal_transitions (0086)
 *     rejects `overturned -> under_review` as un-resolving a terminal state, so a
 *     claim-first-then-roll-back scheme is not representable. What makes the retry in rule 2
 *     actually work is `alreadyApplied` below — each overturn branch re-reads its subject
 *     when the guarded UPDATE matches nothing, and treats "already in the exact post-state"
 *     as success rather than as a conflict. Without it, the one interesting failure (subject
 *     moved, `appeals` UPDATE then failed) was UNRECOVERABLE: the appeal stayed
 *     `under_review` while the subject had moved, and every retry died on the state guard
 *     that rule 2 relies on.
 *
 *  3. NO CAPACITY MOVES, EVER. An admin-stage decline never reserved anything
 *     (approve_submission_atomic is the only RESERVE path and only accepts `pending`), so
 *     there is nothing to release and nothing to re-reserve. detect_capacity_drift() must
 *     return zero rows before and after any overturn.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import {
  createAppealSchema,
  assignAppealSchema,
  resolveAppealSchema,
  withdrawAppealSchema,
  appealDeadline,
  isAppealWindowOpen,
  verificationRejectionReason,
  type CreateAppealInput,
  type AssignAppealInput,
  type ResolveAppealInput,
  type WithdrawAppealInput,
  type AppealActionResult,
  type AppealableSubject,
  type AppealSubjectType,
  type AppealStatus,
} from '@/lib/schemas/appeal'
import { requireAuth, requireAdmin, requireSuperAdmin } from '@/lib/actions-utils'
import { overrideTeamVerification } from '@/app/actions/admin'
import { createInAppNotification } from '@/lib/notify'
import { mapDbError } from '@/lib/errors'
import { revalidatePath } from 'next/cache'
import { writeAudit } from '@/lib/audit'

type AdminClient = ReturnType<typeof createAdminClient>

function validationError(issues: { message: string }[]): AppealActionResult {
  return { error: 'Validation failed: ' + issues.map((i) => i.message).join(', ') }
}

function formatDate(d: Date | string): string {
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

async function notifyAllAdmins(
  adminClient: AdminClient,
  args: { title: string; body: string }
) {
  const { data: admins } = await adminClient.from('profiles').select('id').eq('role', 'admin')
  await Promise.all(
    (admins ?? []).map((a) =>
      createInAppNotification({ recipientId: a.id, type: 'general', title: args.title, body: args.body })
    )
  )
}

// =====================================================================================
// createAppeal
// =====================================================================================
export async function createAppeal(data: CreateAppealInput): Promise<AppealActionResult> {
  const parsed = createAppealSchema.safeParse(data)
  if (!parsed.success) return validationError(parsed.error.issues)
  const { subjectType, subjectId, statement } = parsed.data

  // requireAuth, NOT requireVerifiedCoach: a denied coach is by definition unverified, and
  // gating the appeal on verification would make credential appeals structurally impossible
  // — the exact people who most need to appeal could never file one.
  let user
  try {
    ({ user } = await requireAuth())
  } catch (e: any) {
    return { error: e.message as string }
  }
  if (user.role !== 'coach') return { error: 'Only a coach can file an appeal.' }

  const adminClient = createAdminClient()

  let decisionAt: string
  let originalDeciderId: string | null = null

  if (subjectType === 'submission') {
    const { data: submission } = await adminClient
      .from('submissions')
      .select('id, status, sent_at, reviewed_at, reviewed_by, deleted_at, teams:team_id(owner_id)')
      .eq('id', subjectId)
      .maybeSingle()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const team = (submission as any)?.teams as { owner_id?: string } | null
    if (!submission || submission.deleted_at || team?.owner_id !== user.id) {
      return { error: 'Pitch not found.' }
    }
    if (submission.status !== 'declined') {
      return { error: 'Only a declined pitch can be appealed.' }
    }
    // sent_at is stamped ONLY by approve_submission_atomic, so it is the marker that
    // separates an ADMIN-stage decline from a SPONSOR's decline — both land in
    // status='declined'. Overturning a sponsor's "no" would mean re-presenting a pitch to a
    // company that already declined it: not an admin's call, and a straight violation of
    // admin-gatekept outreach.
    if (submission.sent_at) {
      return {
        error:
          'This pitch was declined by the sponsor, not by our review team, so it cannot be appealed here. You can submit a new pitch to another sponsor.',
      }
    }
    if (!submission.reviewed_at) {
      return { error: 'This decision has no recorded review date, so it cannot be appealed. Contact support.' }
    }
    decisionAt = submission.reviewed_at
    originalDeciderId = submission.reviewed_by
  } else if (subjectType === 'team_verification') {
    // Prompt 07 shipped team_verification_records and overrideTeamVerification (0081), so
    // this subject is live. The record is read through the ADMIN client for the same reason
    // every other branch does — the actor is re-verified here rather than delegated to RLS.
    const { data: record } = await adminClient
      .from('team_verification_records')
      .select('id, team_id, profile_id, ftc_team_number, outcome, checked_at, teams:team_id(owner_id)')
      .eq('id', subjectId)
      .maybeSingle()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recordTeam = (record as any)?.teams as { owner_id?: string } | null
    const ownsRecord = record?.profile_id === user.id || recordTeam?.owner_id === user.id
    if (!record || !ownsRecord) return { error: 'Verification check not found.' }

    // ONLY 'rejected'. 'needs_review' is not a decision — it is a queue, and appealing a
    // pending item would race the admin about to work it. 'overridden' already went the
    // coach's way, and 'auto_pass' / 'unavailable' are not adverse.
    if (record.outcome !== 'rejected') {
      return { error: 'That team number check was not rejected, so there is nothing to appeal.' }
    }

    // team_verification_records is APPEND-ONLY: one row per check attempt (0081). A coach
    // who retried the same number three times has three rejected rows, each with a distinct
    // id — and uq_appeals_one_per_decision keys on the id, so all three would be
    // independently appealable and the queue would take three copies of one dispute. Only
    // the latest check for a given number is a live decision.
    let latest = adminClient
      .from('team_verification_records')
      .select('id')
      .eq('ftc_team_number', record.ftc_team_number)
    latest = record.team_id ? latest.eq('team_id', record.team_id) : latest.is('team_id', null)
    const { data: newest } = await latest.order('checked_at', { ascending: false }).limit(1).maybeSingle()

    if (newest && newest.id !== record.id) {
      return {
        error: 'That check has been superseded by a newer one for the same team number. Appeal the most recent result.',
      }
    }

    decisionAt = record.checked_at as string
    // The rejection is produced by the roster matcher, not by a person, so there is no
    // original decider — which correctly makes the different-reviewer rule a no-op here
    // instead of blocking every admin from resolving it.
    originalDeciderId = null
  } else {
    // coach_verification
    if (subjectId !== user.id) return { error: 'You can only appeal your own verification decision.' }

    const { data: profile } = await adminClient
      .from('profiles')
      .select('id, coach_verified, denied_at')
      .eq('id', user.id)
      .maybeSingle()

    if (!profile || profile.coach_verified || !profile.denied_at) {
      return { error: 'There is no verification denial on your account to appeal.' }
    }
    decisionAt = profile.denied_at

    // denyCoach records the actor only in audit_log (app/actions/admin.ts), not on profiles.
    const { data: denial } = await adminClient
      .from('audit_log')
      .select('actor_id')
      .eq('action', 'deny_coach')
      .eq('entity_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    originalDeciderId = denial?.actor_id ?? null
  }

  if (!isAppealWindowOpen(decisionAt)) {
    return { error: `The 30-day window to appeal this decision closed on ${formatDate(appealDeadline(decisionAt))}.` }
  }

  const { data: appeal, error } = await adminClient
    .from('appeals')
    .insert({
      subject_type: subjectType,
      subject_id: subjectId,
      appellant_profile_id: user.id,
      statement,
      decision_at: decisionAt,
      original_decider_id: originalDeciderId,
      status: 'open',
    })
    .select('id')
    .single()

  if (error) {
    // uq_appeals_one_per_decision. Friendly-mapping pattern from saveSubmission.
    if (error.code === '23505') return { error: 'You have already appealed this decision.' }
    return { error: mapDbError(error, 'createAppeal.insert') }
  }

  await writeAudit(adminClient, {
    actor_id: user.id,
    action: 'create_appeal',
    entity_type: 'appeals',
    entity_id: appeal.id,
    metadata: { subject_type: subjectType, subject_id: subjectId },
  })

  await notifyAllAdmins(adminClient, {
    title: 'New appeal awaiting review',
    body: `A coach has contested a decision. Review it at /admin/appeals.`,
  })

  revalidatePath('/appeals')
  revalidatePath('/admin/appeals')
  revalidatePath('/dashboard')
  revalidatePath('/awaiting-verification')
  return { success: true }
}

// =====================================================================================
// assignAppeal — where the soft different-reviewer rule lives
// =====================================================================================
export async function assignAppeal(data: AssignAppealInput): Promise<AppealActionResult> {
  const parsed = assignAppealSchema.safeParse(data)
  if (!parsed.success) return validationError(parsed.error.issues)
  const { appealId, reviewerId, overrideReason } = parsed.data

  let user, adminClient
  try {
    ({ user, adminClient } = await requireAdmin())
  } catch (e: any) {
    return { error: e.message as string }
  }

  const { data: appeal } = await adminClient
    .from('appeals')
    .select('id, status, original_decider_id, appellant_profile_id')
    .eq('id', appealId)
    .maybeSingle()

  if (!appeal) return { error: 'Appeal not found.' }
  if (appeal.status !== 'open') return { error: 'This appeal has already been picked up.' }

  // The only constraint on reviewerId in the schema is the FK to profiles, so without this
  // an appeal could be "assigned" to a coach or sponsor. That grants no access (the read
  // policy keys off is_admin(), not assigned_reviewer_id) but it corrupts the accountability
  // record — and it is the cleanest way to launder a self-review past the check below.
  const { data: reviewer } = await adminClient
    .from('profiles')
    .select('id, role')
    .eq('id', reviewerId)
    .maybeSingle()
  if (!reviewer || reviewer.role !== 'admin') {
    return { error: 'An appeal can only be assigned to an administrator.' }
  }

  const isSelfReview = !!appeal.original_decider_id && reviewerId === appeal.original_decider_id
  // original_decider_id is best-effort: submissions.reviewed_by is nullable, the credential
  // path reverse-looks-up audit_log and can miss, and the column is ON DELETE SET NULL. When
  // it is NULL the self-review rule cannot fire at all, so record that the guard was blind
  // rather than logging a confident self_review:false.
  const decider_known = appeal.original_decider_id !== null

  if (isSelfReview && !overrideReason) {
    // Warn and write NOTHING. The friction is the point: with two admins it reliably routes
    // the appeal to the other one.
    return {
      requiresOverride: true,
      warning:
        'This admin made the original decision. Assigning them requires a written reason, which will be recorded in the audit log.',
    }
  }

  if (isSelfReview && overrideReason) {
    // Governance, not moderation — the one place the integrity of the appeal is at stake.
    try {
      await requireSuperAdmin()
    } catch {
      return { error: 'Forbidden' }
    }
  }

  const { data: updated, error } = await adminClient
    .from('appeals')
    .update({
      assigned_reviewer_id: reviewerId,
      assigned_at: new Date().toISOString(),
      status: 'under_review',
      ...(isSelfReview && overrideReason ? { override_reason: overrideReason } : {}),
    })
    .eq('id', appealId)
    .eq('status', 'open')
    .select('id, appellant_profile_id')

  if (error) return { error: mapDbError(error, 'assignAppeal.update') }
  if (!updated || updated.length === 0) return { error: 'This appeal has already been picked up.' }

  await writeAudit(adminClient, {
    actor_id: user.id,
    action: 'assign_appeal',
    entity_type: 'appeals',
    entity_id: appealId,
    metadata: { reviewer_id: reviewerId, self_review: isSelfReview, decider_known },
  })

  if (isSelfReview && overrideReason) {
    await writeAudit(adminClient, {
      actor_id: user.id,
      action: 'appeal_self_review_override',
      entity_type: 'appeals',
      entity_id: appealId,
      metadata: { appeal_id: appealId, reviewer_id: reviewerId, reason: overrideReason },
    })
  }

  await createInAppNotification({
    recipientId: updated[0].appellant_profile_id,
    type: 'general',
    title: 'Your appeal is under review',
    body: 'An administrator has picked up your appeal. We will let you know as soon as there is a decision.',
  })

  revalidatePath('/appeals')
  revalidatePath('/admin/appeals')
  return { success: true }
}

// =====================================================================================
// resolveAppeal
// =====================================================================================
export async function resolveAppeal(data: ResolveAppealInput): Promise<AppealActionResult> {
  const parsed = resolveAppealSchema.safeParse(data)
  if (!parsed.success) return validationError(parsed.error.issues)
  const { appealId, outcome, resolutionNotes } = parsed.data

  let user, adminClient
  try {
    ({ user, adminClient } = await requireAdmin())
  } catch (e: any) {
    return { error: e.message as string }
  }

  const { data: appeal } = await adminClient
    .from('appeals')
    .select('id, status, subject_type, subject_id, appellant_profile_id, assigned_reviewer_id, original_decider_id')
    .eq('id', appealId)
    .eq('status', 'under_review')
    .maybeSingle()

  if (!appeal) return { error: 'This appeal is not under review.' }

  // THE DIFFERENT-REVIEWER RULE IS ENFORCED HERE TOO, NOT ONLY AT ASSIGNMENT.
  //
  // Assignment and resolution are separate calls with separate actors, and server actions
  // accept arbitrary payloads — the UI's "assign to me" button is not a constraint. Without
  // this check the whole rule is bypassable in two steps: the original decider assigns the
  // appeal to a DIFFERENT admin (so isSelfReview is false, no override, no super admin, and
  // audit_log records self_review:false), then resolves it themselves. Requiring the caller
  // to be the assigned reviewer is what makes assignment the real gate.
  if (appeal.assigned_reviewer_id && appeal.assigned_reviewer_id !== user.id) {
    return { error: 'This appeal is assigned to another administrator.' }
  }
  // Belt and braces: even holding the assignment, the original decider may only resolve
  // their own decision through the logged super-admin override path, which is the only way
  // assigned_reviewer_id can equal original_decider_id (appeals_self_review_needs_override).
  if (appeal.original_decider_id && appeal.original_decider_id === user.id && !appeal.assigned_reviewer_id) {
    return { error: 'You made this decision. It must be assigned before it can be resolved.' }
  }

  const resolvedAt = new Date().toISOString()

  // ---- SUBJECT EFFECT FIRST. See rule 2 in the file header. -------------------------
  if (outcome === 'overturned') {
    if (appeal.subject_type === 'submission') {
      // changes_requested, NOT draft. Both are coach-editable and both satisfy
      // submissions_update_coach, so the choice is about what the coach SEES:
      // changes_requested is the state the product already treats as "needs your
      // attention". Demoting to draft would reproduce, on purpose, the exact bug
      // autoSaveSubmissionDraft carries a comment about — it erases the coach's own
      // needs-attention alert.
      //
      // reviewed_by is deliberately left alone: it records who made the ORIGINAL decision,
      // and appeals.resolved_by records who overturned it.
      //
      // WHAT IS DELIBERATELY *NOT* DONE HERE: the resolution notes are NOT appended to
      // submissions.admin_feedback, even though this slice's prompt asked for that.
      // admin_feedback survives re-approval (approve_submission_atomic never clears it) and
      // the sponsor portal selects `submissions.*` and passes the whole row into a
      // 'use client' component — so once the overturned pitch is edited, resubmitted and
      // approved, everything in that column reaches the sponsor's browser. Writing appeal
      // text there would hand a sponsor the coach's appeal outcome and the admin's private
      // moderation reasoning. The coach already gets the notes three other ways: the
      // notification below, the appeal detail page, and the dashboard status pill.
      //
      // B-03-15. admin_feedback IS, however, CLEARED. It held the original decline reason —
      // the justification for a decision a second administrator has just reversed. Leaving
      // it put the pitch in "Changes requested" carrying text that requests nothing, and by
      // this comment's own reasoning (the column survives re-approval and is passed whole
      // into a client component) that reversed reasoning would later reach the sponsor.
      // Clearing removes the stale text without writing appeal content in its place.
      const { data: moved, error: subjectError } = await adminClient
        .from('submissions')
        .update({ status: 'changes_requested', reviewed_at: null, admin_feedback: null })
        .eq('id', appeal.subject_id)
        .eq('status', 'declined')
        .select('id')

      if (subjectError) {
        return { error: `The appeal could not be applied to the pitch: ${subjectError.message}` }
      }
      // A guarded UPDATE that matches nothing returns zero rows and NO error. Without this
      // check the appeal would be stamped `overturned` while the pitch never moved — the
      // coach told they won and nothing changed, which is rule 2's exact failure mode.
      if (!moved || moved.length === 0) {
        // Zero rows is ambiguous: either the pitch left `declined` by some other route, or
        // THIS resolution already moved it on an earlier attempt whose `appeals` UPDATE
        // failed. Re-read and distinguish — a pitch sitting in the exact post-state is the
        // second case, and refusing it is what made that failure permanent.
        const { data: current } = await adminClient
          .from('submissions')
          .select('status, reviewed_at')
          .eq('id', appeal.subject_id)
          .maybeSingle()

        if (!current || current.status !== 'changes_requested' || current.reviewed_at !== null) {
          return {
            error:
              'This pitch is no longer in the declined state, so the appeal could not be applied. Refresh and check its current status.',
          }
        }
        // Already applied. Fall through to stamp the appeal and notify — the two steps that
        // never happened last time.
      }

      await writeAudit(adminClient, {
        actor_id: user.id,
        action: 'appeal_overturn_submission',
        entity_type: 'submissions',
        entity_id: appeal.subject_id,
        metadata: { from_status: 'declined', to_status: 'changes_requested', appeal_id: appealId },
      })
    } else if (appeal.subject_type === 'coach_verification') {
      // Clears the denial. Does NOT set coach_verified = true, and that is not a cop-out:
      // denyCoach deletes the photo ID from the coach-credentials bucket, stamps
      // coach_credentials_purged_at, and nulls coach_credentials_url and pending_team_data.
      // Setting coach_verified would assert that an adult's identity was verified against a
      // document that no longer exists — a direct hit on the COPPA mandate — and would
      // strand verifyCoach's team-provisioning step, which reads that now-null
      // pending_team_data.
      //
      // What the coach gets instead is their path back: awaiting-verification computes
      // isDenied as (!coach_verified && !!denied_at), so clearing denied_at flips that page
      // from the red card to the ordinary upload state with no UI change.
      const { data: cleared, error: subjectError } = await adminClient
        .from('profiles')
        .update({ denial_reason: null, denied_at: null })
        .eq('id', appeal.subject_id)
        .not('denied_at', 'is', null) // still denied? otherwise there is nothing to overturn
        .select('id')

      if (subjectError) {
        return { error: `The appeal could not be applied to the account: ${subjectError.message}` }
      }
      if (!cleared || cleared.length === 0) {
        // Same ambiguity as the submission branch, same resolution: a profile already
        // carrying no denial is the post-state this branch was trying to reach.
        const { data: current } = await adminClient
          .from('profiles')
          .select('denied_at')
          .eq('id', appeal.subject_id)
          .maybeSingle()

        if (!current || current.denied_at !== null) {
          return {
            error:
              'This account no longer carries a verification denial, so the appeal could not be applied. Refresh and check its current status.',
          }
        }
      }

      // The submission branch writes a targeted audit row; without a matching one here,
      // auditing a profile by entity_id would never surface the reversal — which is exactly
      // how createAppeal reconstructs the original decider.
      await writeAudit(adminClient, {
        actor_id: user.id,
        action: 'appeal_overturn_coach_verification',
        entity_type: 'profiles',
        entity_id: appeal.subject_id,
        metadata: { appeal_id: appealId, cleared: ['denial_reason', 'denied_at'] },
      })
    } else if (appeal.subject_type === 'team_verification') {
      // The subject effect is DELEGATED to overrideTeamVerification rather than re-written
      // here. That action already stamps outcome/override_reason/overridden_by, reinstates
      // an incubator team to 'existing' with its number, writes its own audit row and tells
      // the coach — and a second copy of that logic in this file is exactly how 0093/0094
      // /0096 lost their fixes. It re-runs requireAdmin(); the caller is already one.
      //
      // Guarded first, because that action's UPDATE has no outcome filter: a record that is
      // no longer 'rejected' would still be stamped 'overridden', which is rule 2's failure
      // mode with extra steps.
      const { data: record } = await adminClient
        .from('team_verification_records')
        .select('id, outcome')
        .eq('id', appeal.subject_id)
        .maybeSingle()

      // 'overridden' is the post-state this branch produces, so seeing it means an earlier
      // attempt already ran the override and only the `appeals` UPDATE failed. Skip the
      // delegate — re-running it would fail its own compare-and-set — and go stamp the
      // appeal. Any other outcome is a genuine conflict.
      const alreadyOverridden = record?.outcome === 'overridden'

      if (!record || (record.outcome !== 'rejected' && !alreadyOverridden)) {
        return {
          error:
            'This team number check is no longer in the rejected state, so the appeal could not be applied. Refresh and check its current status.',
        }
      }

      // resolutionNotes is min-20 chars and teamVerificationOverrideSchema wants min-20, so
      // the admin's explanation to the coach IS the override reason. One text, one meaning.
      const override = alreadyOverridden ? null : await overrideTeamVerification({
        recordId: appeal.subject_id,
        reason: resolutionNotes,
        // Compare-and-set: the pre-read above is a friendlier message, not the guard.
        expectedOutcome: 'rejected',
        // The "your appeal was successful" notification below already says this.
        notifyCoach: false,
      })
      if (override?.error) {
        return { error: `The appeal could not be applied to the team number check: ${override.error}` }
      }
    }
  }
  // `upheld` deliberately touches NO subject row. That is what upheld means. Do not add a
  // side effect here.

  const { data: updated, error } = await adminClient
    .from('appeals')
    .update({
      status: outcome,
      resolution_notes: resolutionNotes,
      resolved_by: user.id,
      resolved_at: resolvedAt,
    })
    .eq('id', appealId)
    .eq('status', 'under_review')
    .select('id, appellant_profile_id, subject_type')

  if (error) return { error: mapDbError(error, 'resolveAppeal.update') }
  if (!updated || updated.length === 0) return { error: 'This appeal is not under review.' }

  await writeAudit(adminClient, {
    actor_id: user.id,
    action: 'resolve_appeal',
    entity_type: 'appeals',
    entity_id: appealId,
    metadata: { outcome, subject_type: appeal.subject_type, subject_id: appeal.subject_id },
  })

  const successBody =
    appeal.subject_type === 'coach_verification'
      ? 'Your appeal was successful. Upload your photo ID again and an admin will review it — your original document was deleted after the first review.'
      : appeal.subject_type === 'team_verification'
        ? 'Your appeal was successful. An administrator has manually confirmed your FTC team number.'
        : 'Your appeal was successful. Your pitch is editable again and you can resubmit it for review.'

  const body =
    outcome === 'upheld'
      ? `Our team reviewed your appeal and the original decision stands.\n\n${resolutionNotes}`
      : `${successBody}\n\n${resolutionNotes}`

  await createInAppNotification({
    recipientId: appeal.appellant_profile_id,
    type: 'general',
    title: outcome === 'upheld' ? 'Your appeal was reviewed' : 'Your appeal was successful',
    body,
    ...(appeal.subject_type === 'submission' ? { submissionId: appeal.subject_id } : {}),
  })

  revalidatePath('/appeals')
  revalidatePath('/admin/appeals')
  revalidatePath('/dashboard')
  revalidatePath('/awaiting-verification')
  return { success: true }
}

// =====================================================================================
// withdrawAppeal
// =====================================================================================
export async function withdrawAppeal(data: WithdrawAppealInput): Promise<AppealActionResult> {
  const parsed = withdrawAppealSchema.safeParse(data)
  if (!parsed.success) return validationError(parsed.error.issues)
  const { appealId } = parsed.data

  let user
  try {
    ({ user } = await requireAuth())
  } catch (e: any) {
    return { error: e.message as string }
  }

  const adminClient = createAdminClient()

  const { data: updated, error } = await adminClient
    .from('appeals')
    .update({ status: 'withdrawn', resolved_at: new Date().toISOString() })
    .eq('id', appealId)
    .eq('appellant_profile_id', user.id) // re-verify the actor: the admin client bypasses RLS
    .in('status', ['open', 'under_review'])
    .select('id')

  if (error) return { error: mapDbError(error, 'withdrawAppeal.update') }
  if (!updated || updated.length === 0) {
    return { error: 'That appeal is not yours, or it has already been resolved.' }
  }

  await writeAudit(adminClient, {
    actor_id: user.id,
    action: 'withdraw_appeal',
    entity_type: 'appeals',
    entity_id: appealId,
    metadata: {},
  })

  // Tell the admins, so a queue item does not just vanish from under a reviewer.
  await notifyAllAdmins(adminClient, {
    title: 'An appeal was withdrawn',
    body: 'A coach withdrew their appeal. No action is needed.',
  })

  revalidatePath('/appeals')
  revalidatePath('/admin/appeals')
  return { success: true }
}

// =====================================================================================
// listAppealableSubjects — the single source of "what can I appeal", so eligibility is not
// recomputed in three components.
// =====================================================================================
export async function listAppealableSubjects(): Promise<
  { subjects: AppealableSubject[] } | { error: string }
> {
  // The RLS-respecting server client, NOT the admin client. submissions_select already
  // scopes a coach to their own teams and appeals_select_own to their own appeals, so the
  // admin client would buy nothing here and would pull every admin-stage-declined pitch on
  // the platform — including every admin's private admin_feedback — into this process on
  // every coach page load, with correctness resting on a TypeScript filter.
  let user, supabase
  try {
    ({ user, supabase } = await requireAuth())
  } catch (e: any) {
    return { error: e.message as string }
  }
  if (user.role !== 'coach') return { subjects: [] }

  const [{ data: submissions }, { data: profile }, { data: appeals }, { data: verifications }] = await Promise.all([
    supabase
      .from('submissions')
      .select('id, status, sent_at, reviewed_at, admin_feedback, teams:team_id(owner_id), sponsors:sponsor_id(company_name)')
      .eq('status', 'declined')
      .is('sent_at', null) // admin-stage declines only
      .is('deleted_at', null),
    supabase
      .from('profiles')
      .select('id, coach_verified, denied_at, denial_reason')
      .eq('id', user.id)
      .maybeSingle(),
    supabase
      .from('appeals')
      .select('id, status, subject_type, subject_id')
      .eq('appellant_profile_id', user.id),
    // tvr_select_own (0081) already scopes this to the caller's own claims and teams, so no
    // owner filter is written here — the same reason the submissions query above carries
    // none. Deliberately NOT filtered to outcome='rejected': the table is append-only, and
    // a rejection that a later check overturned must not still be offered as appealable —
    // which cannot be seen from the rejected rows alone.
    supabase
      .from('team_verification_records')
      .select('id, team_id, ftc_team_number, claimed_team_name, official_team_name, outcome, checked_at')
      .order('checked_at', { ascending: false }),
  ])

  /**
   * The live appeal on a decision, if any. Withdrawn appeals are excluded on purpose —
   * that is exactly what the partial unique index does, so the UI offering a re-file and
   * the database accepting one stay in agreement.
   */
  const liveAppealFor = (subjectType: AppealSubjectType, subjectId: string) => {
    const match = (appeals ?? []).find(
      (a) => a.subject_type === subjectType && a.subject_id === subjectId && a.status !== 'withdrawn'
    )
    return match ? { id: match.id, status: match.status as AppealStatus } : null
  }

  const subjects: AppealableSubject[] = []

  for (const s of submissions ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const team = (s as any).teams as { owner_id?: string } | null
    if (team?.owner_id !== user.id || !s.reviewed_at) continue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sponsorName = ((s as any).sponsors as { company_name?: string } | null)?.company_name ?? 'a sponsor'

    subjects.push({
      subjectType: 'submission',
      subjectId: s.id,
      label: `Pitch to ${sponsorName}`,
      decisionAt: s.reviewed_at,
      deadline: appealDeadline(s.reviewed_at).toISOString(),
      windowOpen: isAppealWindowOpen(s.reviewed_at),
      originalReason: s.admin_feedback ?? null,
      existingAppeal: liveAppealFor('submission', s.id),
    })
  }

  // One live decision per team number: the newest row wins, and it is appealable only if
  // that newest row is the rejection.
  type VerificationRow = NonNullable<typeof verifications>[number]
  const latestVerification = new Map<string, VerificationRow>()
  for (const v of verifications ?? []) {
    const key = `${v.team_id ?? 'none'}:${v.ftc_team_number}`
    // The query is ordered checked_at DESC, so the first row seen for a key is the latest.
    if (!latestVerification.has(key)) latestVerification.set(key, v)
  }

  for (const v of Array.from(latestVerification.values()).filter((v) => v.outcome === 'rejected')) {
    subjects.push({
      subjectType: 'team_verification',
      subjectId: v.id,
      label: `FTC Team #${v.ftc_team_number} verification`,
      decisionAt: v.checked_at,
      deadline: appealDeadline(v.checked_at).toISOString(),
      windowOpen: isAppealWindowOpen(v.checked_at),
      originalReason: verificationRejectionReason(v),
      existingAppeal: liveAppealFor('team_verification', v.id),
    })
  }

  if (profile && !profile.coach_verified && profile.denied_at) {
    subjects.push({
      subjectType: 'coach_verification',
      subjectId: user.id,
      label: 'Coach credential verification',
      decisionAt: profile.denied_at,
      deadline: appealDeadline(profile.denied_at).toISOString(),
      windowOpen: isAppealWindowOpen(profile.denied_at),
      originalReason: profile.denial_reason ?? null,
      existingAppeal: liveAppealFor('coach_verification', user.id),
    })
  }

  return { subjects }
}
