'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { submissionSchema, type SubmissionInput } from '@/lib/schemas/submission'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAuth, requireVerifiedCoach } from '@/lib/actions-utils'
import { createInAppNotification } from '@/lib/notify'
import { mapDbError } from '@/lib/errors'
import { writeAudit } from '@/lib/audit'
import { isAwaitingSponsor } from '@/lib/submission-status'
import { revokeSubmissionAccessTokens } from '@/lib/decision-followup'
import { sponsorRecipientProfiles } from '@/lib/sponsor-recipients'
import { LIMITS } from '@/lib/schemas/limits'

const DUPLICATE_SUBMISSION_MESSAGE = 'You already have an active pitch to this sponsor.'

const withdrawSchema = z.object({
  submissionId: z.string().uuid(),
  reason: z.string().trim().max(LIMITS.feedback).optional(),
})

const EDITABLE_SUBMISSION_STATUSES = ['draft', 'declined', 'changes_requested'] as const

async function getCoachTeamId() {
  let user, supabase
  try {
    const auth = await requireAuth()
    user = auth.user
    supabase = auth.supabase
  } catch {
    return { error: 'Not authenticated' as const }
  }

  const { data: team } = await supabase
    .from('teams')
    .select('id, financial_ask_cents')
    .eq('owner_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!team) return { error: 'Team not found. Complete onboarding first.' as const }
  return { supabase, user, teamId: team.id, financialAsk: team.financial_ask_cents ?? 0 }
}

export async function saveSubmission(
  data: SubmissionInput,
  status: 'draft' | 'pending' = 'draft',
  submissionId?: string
) {
  if (status === 'pending') {
    const result = submissionSchema.safeParse(data)
    if (!result.success) return { error: 'Please complete all required fields before submitting' }
    // Submitting to sponsors requires verified-coach status.
    try {
      await requireVerifiedCoach()
    } catch (e: any) {
      return { error: e.message, code: e.code }
    }
  }

  const ctx = await getCoachTeamId()
  if ('error' in ctx) return { error: ctx.error }
  const { supabase, user, teamId, financialAsk } = ctx

  // Approval reserves the portfolio ask against the sponsor's cap, so a $0 ask
  // can never be dispatched — catch it here where the coach can actually fix it.
  if (status === 'pending' && financialAsk <= 0) {
    return {
      error:
        'Your portfolio has no funding ask yet. Add budget line items in Portfolio → Goals & Funding Ask, then submit your pitch.',
    }
  }

  // Spec: max 3 pending submissions per rolling 7-day window
  if (status === 'pending') {
    const { count } = await supabase
      .from('submissions')
      .select('id', { count: 'exact', head: true })
      .eq('team_id', teamId)
      .eq('status', 'pending')
      .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())

    if ((count ?? 0) >= 3) {
      return { error: 'rate_limited', message: 'You may submit at most 3 proposals per 7-day window. Please wait for existing submissions to be reviewed.' }
    }
  }

  if (status === 'pending') {
    // Reads the coach-safe view, not the sponsors base table: 0063 removed the coach
    // branch from `sponsors_select` so a coach now reads zero rows from `sponsors`
    // (P0-4 — the base table exposes contact_email and the admin's private `notes`).
    // The view applies the same active/capacity/geo predicate, so a sponsor missing
    // from it is genuinely one this coach may not pitch.
    const { data: sponsor } = await supabase
      .from('v_sponsors_public')
      .select('status')
      .eq('id', data.sponsorId)
      .single()

    if (!sponsor || sponsor.status !== 'active') {
      return { error: 'This sponsor is not currently accepting new submissions.' }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload: any = {
    team_id: teamId,
    sponsor_id: data.sponsorId,
    custom_pitch_alignment: data.customPitchAlignment ?? null,
    specific_needs_statement: data.specificNeedsStatement ?? null,
    local_connection_notes: data.localConnectionNotes ?? null,
    status,
    submitted_at: status === 'pending' ? new Date().toISOString() : null,
    requested_amount_cents: financialAsk
  }

  if (submissionId) {
    const { data: existing } = await supabase
      .from('submissions')
      .select('id, status, team_id')
      .eq('id', submissionId)
      .eq('team_id', teamId)
      .single()

    if (!existing) return { error: 'Submission not found' }
    if (!EDITABLE_SUBMISSION_STATUSES.includes(existing.status as typeof EDITABLE_SUBMISSION_STATUSES[number])) {
      return { error: 'This submission can no longer be edited.' }
    }

    const { error } = await supabase
      .from('submissions')
      .update(payload)
      .eq('id', submissionId)

    if (error) return { error: mapDbError(error, 'saveSubmission.update') }
  } else {
    // Fast path: friendly rejection when an active submission already exists
    // for this team/sponsor combo.
    const { data: existingTarget } = await supabase
      .from('submissions')
      .select('id, status')
      .eq('team_id', teamId)
      .eq('sponsor_id', data.sponsorId)
      .not('status', 'in', '("declined","expired","bounced")')
      .maybeSingle()

    if (existingTarget) {
      return { error: DUPLICATE_SUBMISSION_MESSAGE }
    }

    // The pre-check above races with concurrent inserts; the partial unique
    // index on active (team_id, sponsor_id) is the real guard. Map its 23505
    // to the same friendly message instead of leaking a constraint error.
    const { data: inserted, error } = await supabase
      .from('submissions')
      .insert(payload)
      .select('id')
      .single()

    if (error) {
      if (error.code === '23505') return { error: DUPLICATE_SUBMISSION_MESSAGE }
      return { error: mapDbError(error, 'saveSubmission.insert') }
    }
    submissionId = inserted.id
  }

  // Audit log for draft→pending transition (material state change)
  if (status === 'pending') {
    const admin = createAdminClient()
    await writeAudit(admin, {
      actor_id: user.id,
      action: 'submit_submission',
      entity_type: 'submissions',
      entity_id: submissionId ?? null,
      metadata: { sponsor_id: data.sponsorId },
    })

    // Notify every admin (inbox + email) that a pitch is awaiting moderation.
    const { data: admins } = await admin.from('profiles').select('id').eq('role', 'admin')
    if (admins?.length) {
      await Promise.all(
        admins.map((a) =>
          createInAppNotification({
            recipientId: a.id,
            type: 'general',
            title: 'New submission awaiting review',
            body: 'A coach has submitted a pitch for review. Open the moderation queue to approve, decline, or request changes.',
            submissionId: submissionId ?? undefined,
          })
        )
      )
    }

    redirect('/dashboard')
  }
  return { success: true }
}

/**
 * B-03-12. Retract a pitch the sponsor has not decided on yet.
 *
 * Before this there was no exit from `dispatched` other than a sponsor decision or the
 * 14-day expiry cron: a coach who sent the wrong amount, the wrong sponsor, or text that
 * breaches the no-student-information rule could not pull it back, and the sponsor's
 * reserved capacity stayed locked for the full fortnight.
 *
 * Routed through `release_submission_reservation`, the same RPC the expiry cron and the
 * bounce handler use, so capacity comes back through code that is already pinned by
 * scripts/verify-capacity-invariant.mjs. The RPC itself re-checks that the submission is in
 * an awaiting-sponsor state, so a race against a sponsor deciding at the same moment loses
 * cleanly with `not_releasable` rather than double-releasing.
 */
export async function withdrawSubmission(
  submissionId: string,
  reason?: string
): Promise<{ success?: boolean; error?: string }> {
  const parsed = withdrawSchema.safeParse({ submissionId, reason })
  if (!parsed.success) {
    return { error: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', ') }
  }

  let user, supabase
  try {
    ({ user, supabase } = await requireVerifiedCoach())
  } catch (e: any) {
    return { error: e.message }
  }

  // Ownership through the team, read under RLS — a coach must not be able to withdraw
  // another team's pitch by guessing an id.
  const { data: submission } = await supabase
    .from('submissions')
    .select('id, status, sponsor_id, reserved_amount_cents, teams:team_id(owner_id, team_name)')
    .eq('id', parsed.data.submissionId)
    .maybeSingle()

  if (!submission || (submission.teams as { owner_id?: string } | null)?.owner_id !== user.id) {
    return { error: 'Pitch not found.' }
  }
  if (!isAwaitingSponsor(submission.status)) {
    return { error: 'This pitch is not awaiting a sponsor decision, so it cannot be withdrawn.' }
  }

  const adminClient = createAdminClient()
  const { data: rpcResult, error: rpcError } = await adminClient.rpc('release_submission_reservation', {
    p_submission_id: parsed.data.submissionId,
    p_new_status: 'withdrawn',
    p_reason: parsed.data.reason ?? 'withdrawn_by_coach',
  })
  if (rpcError) return { error: mapDbError(rpcError, 'withdrawSubmission.rpc') }

  const result = rpcResult as { ok: boolean; error?: string; released_cents?: number }
  if (!result?.ok) {
    if (result?.error === 'not_releasable') {
      return { error: 'The sponsor has already responded to this pitch, so it can no longer be withdrawn.' }
    }
    return { error: 'This pitch could not be withdrawn. Refresh and check its current status.' }
  }

  // B-03-11 applies here too: the emailed bearer link must not keep rendering the full
  // portfolio for a pitch that has been pulled.
  await revokeSubmissionAccessTokens(adminClient, parsed.data.submissionId, 'withdrawn_by_coach')

  await writeAudit(adminClient, {
    actor_id: user.id,
    action: 'submission_withdrawn_by_coach',
    entity_type: 'submissions',
    entity_id: parsed.data.submissionId,
    metadata: {
      sponsor_id: submission.sponsor_id,
      released_cents: result.released_cents ?? 0,
      reason: parsed.data.reason ?? null,
    },
  })

  /**
   * Tell the sponsor. The direction on this finding was explicit that a withdrawal must not
   * leave a sponsor with a pitch that silently vanished from their inbox — they may already
   * have been reading it.
   */
  if (submission.sponsor_id) {
    const teamName = (submission.teams as { team_name?: string } | null)?.team_name ?? 'A team'
    const recipients = await sponsorRecipientProfiles(adminClient, submission.sponsor_id)
    for (const recipient of recipients) {
      await createInAppNotification({
        recipientId: recipient.id,
        type: 'general',
        title: `${teamName} withdrew their pitch`,
        body: `${teamName} has withdrawn their sponsorship request before a decision was made. No action is needed, and the amount they had reserved against your cap has been released.`,
      })
    }
  }

  revalidatePath('/dashboard')
  revalidatePath(`/submissions/${parsed.data.submissionId}`)
  revalidatePath('/sponsor/inbox')
  revalidatePath('/sponsor/dashboard')
  return { success: true }
}

export async function autoSaveSubmissionDraft(
  data: Partial<SubmissionInput>,
  submissionId?: string
): Promise<{ id?: string; error?: string }> {
  const ctx = await getCoachTeamId()
  if ('error' in ctx) return { error: ctx.error }
  const { supabase, teamId, financialAsk } = ctx

  if (!data.sponsorId) {
    return { error: 'Sponsor ID is required to autosave' }
  }

  // NOTE: `status` is deliberately NOT part of the shared payload.
  // It used to be hard-coded to 'draft' here, so merely autosaving an edit to a
  // `changes_requested` or `declined` pitch silently demoted it back to `draft` and
  // erased the coach's own needs-attention alert — the one signal telling them the admin
  // had asked for something. Autosave persists content; it must never change state.
  const payload = {
    team_id: teamId,
    sponsor_id: data.sponsorId,
    custom_pitch_alignment: data.customPitchAlignment ?? null,
    specific_needs_statement: data.specificNeedsStatement ?? null,
    local_connection_notes: data.localConnectionNotes ?? null,
    requested_amount_cents: financialAsk
  }

  if (submissionId) {
    const { data: existing } = await supabase
      .from('submissions')
      .select('status, team_id')
      .eq('id', submissionId)
      .eq('team_id', teamId)
      .single()

    if (!existing) return { error: 'Submission not found' }
    if (!EDITABLE_SUBMISSION_STATUSES.includes(existing.status as typeof EDITABLE_SUBMISSION_STATUSES[number])) {
      return { error: 'Cannot auto-save a non-draft submission' }
    }

    const { error } = await supabase.from('submissions').update(payload).eq('id', submissionId)
    if (error) return { error: mapDbError(error, 'autoSaveSubmissionDraft.update') }
    return { id: submissionId }
  }

  // Attempt to update by team_id and sponsor_id if no ID is passed, to avoid duplicates
  const { data: existingTarget } = await supabase
    .from('submissions')
    .select('id, status')
    .eq('team_id', teamId)
    .eq('sponsor_id', data.sponsorId)
    .not('status', 'in', '("declined","expired","bounced")')
    .maybeSingle()

  if (existingTarget) {
    // If it's not a draft, we shouldn't overwrite it with auto-save
    if (!EDITABLE_SUBMISSION_STATUSES.includes(existingTarget.status as any)) {
      return { error: 'An active submission for this sponsor is already in progress and locked.' }
    }
    const { error } = await supabase.from('submissions').update(payload).eq('id', existingTarget.id)
    if (error) return { error: mapDbError(error, 'autoSaveSubmissionDraft.updateExisting') }
    return { id: existingTarget.id }
  }

  // A brand-new row genuinely starts as a draft; only the UPDATE paths above must
  // leave the existing status alone.
  const { data: inserted, error } = await supabase
    .from('submissions')
    .insert({ ...payload, status: 'draft' as const })
    .select('id')
    .single()

  if (error) {
    // Concurrent autosave can race the pre-check; the partial unique index on
    // active (team_id, sponsor_id) reports 23505 — map it to the friendly message.
    if (error.code === '23505') return { error: DUPLICATE_SUBMISSION_MESSAGE }
    return { error: mapDbError(error, 'autoSaveSubmissionDraft.insert') }
  }
  return { id: inserted.id }
}

