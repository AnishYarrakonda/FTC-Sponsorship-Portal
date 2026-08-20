'use server'

/**
 * Admin-moderated sponsor <-> coach Q&A on a live pitch.
 *
 * EVERY WRITE IN THIS FILE USES THE ADMIN CLIENT, WHICH BYPASSES RLS. submission_messages
 * has three SELECT policies and deliberately no INSERT/UPDATE/DELETE policy at all, so
 * there is no client write path — which means every action here must RE-VERIFY OWNERSHIP
 * itself, from the resolved profile or token, before it writes. That is the same discipline
 * the RPCs follow when they are handed a p_*_id (_CONTEXT.md §1).
 *
 * Two rules that are not obvious from the code:
 *
 *  1. NO MESSAGE BODY EVER GOES INTO audit_log. audit_log is admin-readable forever and
 *     this is a COPPA surface. Metadata carries submission_id and nothing else. The single
 *     exception is reportSubmissionMessage's reason, which is the reporter's own words.
 *
 *  2. Coach messages never auto-send. They sit at status='pending' until an admin releases
 *     them — the same gate app/actions/moderation.ts applies to pitches. A thread is a
 *     beautiful place to accidentally rebuild dispatch; this is what stops it.
 *
 * The database enforces liveness, thread-opening and the per-thread cap independently
 * (trg_guard_submission_message, 0085). The friendly errors below exist so users see prose
 * instead of a trigger's exception text — they are not the security boundary.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import {
  postMessageSchema,
  postMessageByTokenSchema,
  releaseMessageSchema,
  rejectMessageSchema,
  reportMessageSchema,
  type PostMessageInput,
  type PostMessageByTokenInput,
  type ReleaseMessageInput,
  type RejectMessageInput,
  type ReportMessageInput,
  type MessageActionResult,
} from '@/lib/schemas/message'
import {
  requireAuth,
  requireAdmin,
  requireSponsorRole,
  requireVerifiedCoach,
  getClientIp,
} from '@/lib/actions-utils'
import { checkThrottle } from '@/lib/throttle'
import { createInAppNotification, sendThreadMessageEmail } from '@/lib/notify'
import { isAwaitingSponsor } from '@/lib/submission-status'
import { mapDbError } from '@/lib/errors'
import { revalidatePath } from 'next/cache'
import { createHash } from 'crypto'

type AdminClient = ReturnType<typeof createAdminClient>

const RATE_LIMITED = 'You have sent a lot of messages recently — please try again later.'

function validationError(issues: { message: string }[]): MessageActionResult {
  return { error: 'Validation failed: ' + issues.map((i) => i.message).join(', ') }
}

/**
 * The liveness check the composer surfaces. Mirrors rules 3 of the DB trigger so the user
 * gets prose; the trigger is what actually guarantees it.
 */
function livenessError(submission: {
  status: string
  expires_at: string | null
  deleted_at: string | null
}): string | null {
  if (submission.deleted_at) return 'This pitch is no longer available.'
  if (!isAwaitingSponsor(submission.status)) {
    return 'This pitch is no longer awaiting a sponsor decision, so the conversation is read-only.'
  }
  if (submission.expires_at && new Date(submission.expires_at) <= new Date()) {
    return 'The 14-day window for this pitch has closed, so the conversation is read-only.'
  }
  return null
}

/** Revalidate every surface a thread renders on. */
function revalidateThread(submissionId: string) {
  revalidatePath(`/submissions/${submissionId}`)
  revalidatePath(`/sponsor/submissions/${submissionId}`)
  revalidatePath('/moderation')
  revalidatePath('/dashboard')
}

async function notifyAllAdmins(
  adminClient: AdminClient,
  args: { title: string; body: string; submissionId?: string }
) {
  const { data: admins } = await adminClient
    .from('profiles')
    .select('id')
    .eq('role', 'admin')

  await Promise.all(
    (admins ?? []).map((a) =>
      createInAppNotification({
        recipientId: a.id,
        type: 'general',
        title: args.title,
        body: args.body,
        submissionId: args.submissionId,
      })
    )
  )
}

// =====================================================================================
// Sponsor -> coach (portal). Posts immediately.
//
// The sponsor already holds an admin-approved pitch and is the party initiating contact,
// so their question is neither new outreach nor a student-PII risk. That is the entire
// justification for the asymmetry; see 0085's header.
// =====================================================================================
export async function postSponsorQuestion(data: PostMessageInput): Promise<MessageActionResult> {
  const parsed = postMessageSchema.safeParse(data)
  if (!parsed.success) return validationError(parsed.error.issues)
  const { submissionId, body } = parsed.data

  // requireSponsorRole('submitter'), not requireSponsor(). 0083 defines `viewer` as
  // explicitly read-only ("cannot act on any of them"), and a message that reaches a coach
  // carrying the company's name is an act. Asking a question is strictly less consequential
  // than declining, which is the submitter floor — so submitter is the right bar. Legacy
  // single-user sponsors are unaffected: LEGACY_MEMBER_ROLE is org_admin.
  let user, sponsorIds, adminClient
  try {
    ({ user, sponsorIds, adminClient } = await requireSponsorRole('submitter'))
  } catch (e: any) {
    return { error: e.message as string, code: e.code as string | undefined }
  }

  const { data: submission } = await adminClient
    .from('submissions')
    .select('id, sponsor_id, status, expires_at, deleted_at, teams:team_id(owner_id)')
    .eq('id', submissionId)
    .maybeSingle()

  // sponsorIds, not a single sponsorId: an org teammate may be acting in an org that is
  // not their profiles.sponsor_id. This must stay in step with sponsor_owns_submission(),
  // which resolves through current_sponsor_ids() for the same reason.
  if (!submission || !sponsorIds.includes(submission.sponsor_id)) {
    return { error: 'Proposal not found.' }
  }
  const stale = livenessError(submission)
  if (stale) return { error: stale }

  if (!(await checkThrottle(adminClient, `qa:sponsor:${user.id}`, 20, '1 hour', 'qa'))) {
    return { error: RATE_LIMITED }
  }

  const { data: sponsor } = await adminClient
    .from('sponsors')
    .select('contact_name, company_name')
    .eq('id', submission.sponsor_id)
    .maybeSingle()

  const { data: message, error } = await adminClient
    .from('submission_messages')
    .insert({
      submission_id: submissionId,
      author_profile_id: user.id,
      author_role: 'sponsor',
      author_label: user.full_name ?? sponsor?.contact_name ?? sponsor?.company_name ?? 'Sponsor',
      body,
      status: 'released',
      released_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) return { error: mapDbError(error, 'postSponsorQuestion.insert') }

  await adminClient.from('audit_log').insert({
    actor_id: user.id,
    action: 'post_sponsor_question',
    entity_type: 'submission_messages',
    entity_id: message.id,
    metadata: { submission_id: submissionId },
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const coachId = (submission as any).teams?.owner_id as string | undefined
  if (coachId) {
    // Title only, NO body. createInAppNotification mirrors to email, and a body here would
    // carry the sponsor's message text into the coach's inbox before the thread was opened.
    await createInAppNotification({
      recipientId: coachId,
      type: 'general',
      title: `${sponsor?.company_name ?? 'A sponsor'} asked a question about your pitch`,
      submissionId,
    })
  }

  revalidateThread(submissionId)
  return { success: true }
}

// =====================================================================================
// Coach -> sponsor. Enters the moderation queue; never auto-sends.
// =====================================================================================
export async function postCoachReply(data: PostMessageInput): Promise<MessageActionResult> {
  const parsed = postMessageSchema.safeParse(data)
  if (!parsed.success) return validationError(parsed.error.issues)
  const { submissionId, body } = parsed.data

  let user
  try {
    ({ user } = await requireVerifiedCoach())
  } catch (e: any) {
    // NEEDS_VERIFICATION lets the caller render the verification CTA instead of a raw error.
    return { error: e.message as string, code: e.code as string | undefined }
  }

  const adminClient = createAdminClient()

  const { data: submission } = await adminClient
    .from('submissions')
    .select('id, status, expires_at, deleted_at, teams:team_id(owner_id, team_name)')
    .eq('id', submissionId)
    .maybeSingle()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const team = (submission as any)?.teams as { owner_id?: string; team_name?: string } | null
  if (!submission || team?.owner_id !== user.id) {
    return { error: 'Proposal not found.' }
  }
  const stale = livenessError(submission)
  if (stale) return { error: stale }

  // A coach can never open a thread. Enforced in the trigger too — this is for the wording.
  const { count: sponsorMessages } = await adminClient
    .from('submission_messages')
    .select('id', { count: 'exact', head: true })
    .eq('submission_id', submissionId)
    .eq('author_role', 'sponsor')

  if (!sponsorMessages) {
    return { error: 'You can only reply after the sponsor has asked a question.' }
  }

  if (!(await checkThrottle(adminClient, `qa:coach:${user.id}`, 10, '1 hour', 'qa'))) {
    return { error: RATE_LIMITED }
  }

  const { data: message, error } = await adminClient
    .from('submission_messages')
    .insert({
      submission_id: submissionId,
      author_profile_id: user.id,
      author_role: 'coach',
      author_label: user.full_name ?? 'Coach',
      body,
      status: 'pending',
    })
    .select('id')
    .single()

  if (error) return { error: mapDbError(error, 'postCoachReply.insert') }

  await adminClient.from('audit_log').insert({
    actor_id: user.id,
    action: 'post_coach_reply',
    entity_type: 'submission_messages',
    entity_id: message.id,
    metadata: { submission_id: submissionId },
  })

  await notifyAllAdmins(adminClient, {
    title: 'Coach reply awaiting release',
    body: `${team?.team_name ?? 'A team'} replied to a sponsor question. Review it at /moderation before it is sent.`,
    submissionId,
  })

  revalidateThread(submissionId)
  // `pending` lets the UI say "sent for review", not "sent".
  return { success: true, pending: true }
}

// =====================================================================================
// Admin release / reject.
//
// requireAdmin, not requireSuperAdmin: releasing a message is moderation, not governance
// (0084's reviewer/super-admin split).
// =====================================================================================
export async function releaseCoachReply(data: ReleaseMessageInput): Promise<MessageActionResult> {
  const parsed = releaseMessageSchema.safeParse(data)
  if (!parsed.success) return validationError(parsed.error.issues)
  const { messageId } = parsed.data

  let user, adminClient
  try {
    ({ user, adminClient } = await requireAdmin())
  } catch (e: any) {
    return { error: e.message as string }
  }

  // Guarded update — the optimistic pattern markNotificationRead uses. Two admins clicking
  // Release on the same row means the second one gets zero rows back, not a double send.
  const { data: updated, error } = await adminClient
    .from('submission_messages')
    .update({
      status: 'released',
      released_by: user.id,
      released_at: new Date().toISOString(),
    })
    .eq('id', messageId)
    .eq('status', 'pending')
    .eq('author_role', 'coach')
    .select('id, submission_id')

  if (error) return { error: mapDbError(error, 'releaseCoachReply.update') }
  if (!updated || updated.length === 0) {
    return { error: 'This message was already handled.' }
  }

  const submissionId = updated[0].submission_id

  await adminClient.from('audit_log').insert({
    actor_id: user.id,
    action: 'release_coach_reply',
    entity_type: 'submission_messages',
    entity_id: messageId,
    metadata: { submission_id: submissionId },
  })

  const { data: submission } = await adminClient
    .from('submissions')
    .select('sponsor_id')
    .eq('id', submissionId)
    .maybeSingle()

  if (submission?.sponsor_id) {
    // Portal sponsors, mirroring the fan-out in app/actions/moderation.ts:113-131 — but
    // UNIONed with sponsor_members, the way current_sponsor_ids() resolves sponsors since
    // 0082. A profiles-only read misses every org teammate who was invited into the org and
    // never had profiles.sponsor_id stamped, which is most of them under the 0082 model.
    // skipEmail because sendThreadMessageEmail below is the richer template.
    const [{ data: legacyProfiles }, { data: members }] = await Promise.all([
      adminClient.from('profiles').select('id').eq('role', 'sponsor').eq('sponsor_id', submission.sponsor_id),
      adminClient.from('sponsor_members').select('profile_id').eq('sponsor_id', submission.sponsor_id),
    ])

    const recipientIds = Array.from(
      new Set([
        ...(legacyProfiles ?? []).map((p) => p.id),
        ...(members ?? []).map((m) => m.profile_id),
      ])
    )

    await Promise.all(
      recipientIds.map((id) =>
        createInAppNotification({
          recipientId: id,
          type: 'general',
          skipEmail: true,
          title: 'A coach replied to your question',
          body: 'Open the proposal to read the reply before you decide.',
          submissionId,
        })
      )
    )
  }

  // Always, for everyone. A token-only sponsor has no profiles row, so createInAppNotification
  // is impossible for them and this email is their only channel.
  await sendThreadMessageEmail(messageId)

  revalidateThread(submissionId)
  return { success: true }
}

export async function rejectCoachReply(data: RejectMessageInput): Promise<MessageActionResult> {
  const parsed = rejectMessageSchema.safeParse(data)
  if (!parsed.success) return validationError(parsed.error.issues)
  const { messageId, reason } = parsed.data

  let user, adminClient
  try {
    ({ user, adminClient } = await requireAdmin())
  } catch (e: any) {
    return { error: e.message as string }
  }

  const { data: updated, error } = await adminClient
    .from('submission_messages')
    .update({
      status: 'rejected',
      rejected_reason: reason,
      // released_by / released_at double as the reviewer stamp on a rejection; see the
      // decision note in 0085. rejected_reason is what disambiguates the two outcomes.
      released_by: user.id,
      released_at: new Date().toISOString(),
    })
    .eq('id', messageId)
    .eq('status', 'pending')
    .eq('author_role', 'coach')
    .select('id, submission_id, author_profile_id')

  if (error) return { error: mapDbError(error, 'rejectCoachReply.update') }
  if (!updated || updated.length === 0) {
    return { error: 'This message was already handled.' }
  }

  const { submission_id: submissionId, author_profile_id: coachId } = updated[0]

  await adminClient.from('audit_log').insert({
    actor_id: user.id,
    action: 'reject_coach_reply',
    entity_type: 'submission_messages',
    entity_id: messageId,
    metadata: { submission_id: submissionId },
  })

  if (coachId) {
    await createInAppNotification({
      recipientId: coachId,
      type: 'general',
      title: 'Your reply was not sent to the sponsor',
      body: `Our team reviewed your reply and did not release it. Reason: ${reason}\n\nYou can rewrite it and send it again.`,
      submissionId,
    })
  }

  revalidateThread(submissionId)
  return { success: true }
}

// =====================================================================================
// Report a sponsor message.
//
// The sponsor->coach direction is the one that is NOT pre-moderated, and the realistic
// failure there is a sponsor *asking* for student details. Only a coach can report, because
// only that direction is unreviewed.
// =====================================================================================
export async function reportSubmissionMessage(data: ReportMessageInput): Promise<MessageActionResult> {
  const parsed = reportMessageSchema.safeParse(data)
  if (!parsed.success) return validationError(parsed.error.issues)
  const { messageId, reason } = parsed.data

  let user
  try {
    ({ user } = await requireAuth())
  } catch (e: any) {
    return { error: e.message as string }
  }

  const adminClient = createAdminClient()

  const { data: message } = await adminClient
    .from('submission_messages')
    .select('id, submission_id, author_role, flagged_at')
    .eq('id', messageId)
    .maybeSingle()

  if (!message) return { error: 'Message not found.' }

  const { data: submission } = await adminClient
    .from('submissions')
    .select('id, teams:team_id(owner_id, team_name)')
    .eq('id', message.submission_id)
    .maybeSingle()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const team = (submission as any)?.teams as { owner_id?: string; team_name?: string } | null

  // Ownership is checked BEFORE the author_role check, and both failures return the same
  // string. Split the other way round, the differing errors would tell any authenticated
  // caller holding a message id what role wrote it.
  if (!submission || team?.owner_id !== user.id || message.author_role !== 'sponsor') {
    return { error: 'Message not found.' }
  }

  if (message.flagged_at) return { success: true }

  // Status is deliberately unchanged: the message already reached the coach, and hiding it
  // retroactively would be theatre. Flagging is what routes it to a human.
  const { error } = await adminClient
    .from('submission_messages')
    .update({ flagged_at: new Date().toISOString(), flagged_by: user.id })
    .eq('id', messageId)

  if (error) return { error: mapDbError(error, 'reportSubmissionMessage.update') }

  // The one place a reason is stored — the REPORTER's words, not a student's.
  await adminClient.from('audit_log').insert({
    actor_id: user.id,
    action: 'report_submission_message',
    entity_type: 'submission_messages',
    entity_id: messageId,
    metadata: { submission_id: message.submission_id, reason },
  })

  await notifyAllAdmins(adminClient, {
    title: 'A sponsor message was reported',
    body: `${team?.team_name ?? 'A coach'} reported a sponsor message. Review it at /moderation.`,
    submissionId: message.submission_id,
  })

  revalidateThread(message.submission_id)
  return { success: true }
}

// =====================================================================================
// Sponsor -> coach via the tokenized /sponsor-view path. NO AUTH GUARD.
//
// The token IS the credential. That is not a new trust level: it is exactly the trust
// record_sponsor_decision_atomic already places in it to move money (0071:50-62). Posting a
// question is strictly less consequential than approving funding, so gating it harder than
// the funding decision would be incoherent.
//
// THE TOKEN MUST NOT BE CONSUMED. 0071 exists entirely because the decision RPC used to
// burn the token before validating. A sponsor who asks a question must still be able to fund
// afterwards, so used_at is never written here.
// =====================================================================================
export async function postSponsorQuestionByToken(data: PostMessageByTokenInput): Promise<MessageActionResult> {
  const parsed = postMessageByTokenSchema.safeParse(data)
  if (!parsed.success) return validationError(parsed.error.issues)
  const { token, body } = parsed.data

  const adminClient = createAdminClient()
  const tokenHash = createHash('sha256').update(token).digest('hex')

  const { data: accessToken } = await adminClient
    .from('submission_access_tokens')
    .select('id, submission_id, used_at, revoked_at, expires_at')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (
    !accessToken ||
    accessToken.used_at ||
    accessToken.revoked_at ||
    new Date(accessToken.expires_at) <= new Date()
  ) {
    return { error: 'This link is no longer active.' }
  }

  const { data: submission } = await adminClient
    .from('submissions')
    .select('id, sponsor_id, status, expires_at, deleted_at, teams:team_id(owner_id)')
    .eq('id', accessToken.submission_id)
    .maybeSingle()

  if (!submission) return { error: 'Proposal not found.' }
  const stale = livenessError(submission)
  if (stale) return { error: stale }

  const ip = await getClientIp()
  if (!(await checkThrottle(adminClient, `qa:token:${accessToken.id}`, 10, '1 hour', 'qa'))) {
    return { error: RATE_LIMITED }
  }
  if (!(await checkThrottle(adminClient, `qa:ip:${ip}`, 20, '1 hour', 'qa'))) {
    return { error: RATE_LIMITED }
  }

  const { data: sponsor } = await adminClient
    .from('sponsors')
    .select('contact_name, company_name')
    .eq('id', submission.sponsor_id)
    .maybeSingle()

  const { data: message, error } = await adminClient
    .from('submission_messages')
    .insert({
      submission_id: submission.id,
      author_profile_id: null,
      author_token_id: accessToken.id,
      author_role: 'sponsor',
      author_label: sponsor?.contact_name ?? sponsor?.company_name ?? 'Sponsor',
      body,
      status: 'released',
      released_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) return { error: mapDbError(error, 'postSponsorQuestionByToken.insert') }

  // actor_id null is the token-path convention record_sponsor_decision_atomic uses (0071:126).
  await adminClient.from('audit_log').insert({
    actor_id: null,
    action: 'post_sponsor_question_by_token',
    entity_type: 'submission_messages',
    entity_id: message.id,
    metadata: { submission_id: submission.id },
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const coachId = (submission as any).teams?.owner_id as string | undefined
  if (coachId) {
    await createInAppNotification({
      recipientId: coachId,
      type: 'general',
      title: `${sponsor?.company_name ?? 'A sponsor'} asked a question about your pitch`,
      submissionId: submission.id,
    })
  }

  revalidateThread(submission.id)
  revalidatePath(`/sponsor-view/${token}`)
  return { success: true }
}
