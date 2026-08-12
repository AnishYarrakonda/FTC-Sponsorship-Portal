'use server'

import { createHash } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { createInAppNotification, sendHandshakeEmail, sendSubmissionDecisionEmail } from '@/lib/notify'
import { requireSponsorRole } from '@/lib/actions-utils'
import { mapDbError } from '@/lib/errors'
import { runDecisionFollowUp, mapDecisionError, notifyEligibleApprovers } from '@/lib/decision-followup'
import { requiresApproval } from '@/lib/sponsor-roles'
import { z } from 'zod'

const DECISION_EMAIL_WARNING = 'The decision was saved, but the notification email could not be sent.'

const sponsorUpdateSchema = z.object({
  submissionId: z.string().uuid(),
  status: z.enum(['approved', 'declined', 'changes_requested']),
  feedback: z.string().max(2000).optional(),
})

const recordDecisionSchema = z.object({
  token: z.string().min(1),
  decision: z.enum(['decline', 'full', 'partial']),
  amountCents: z.number().int().min(0).optional(),
})

export async function sponsorUpdateSubmissionStatus(
  submissionId: string,
  status: 'approved' | 'declined' | 'changes_requested',
  feedback?: string
) {
  const parsed = sponsorUpdateSchema.safeParse({ submissionId, status, feedback })
  if (!parsed.success) return { error: 'Invalid data provided' }

  let user, sponsorId, adminClient
  try {
    ({ user, sponsorId, adminClient } = await requireSponsorRole('submitter'))
  } catch (e: any) {
    return { error: e.message }
  }

  const normalizedFeedback = feedback?.trim() || undefined

  // Non-money decisions always commit immediately — see the prompt's "Which decisions
  // are gated" table. A decline releases capacity rather than consuming it, so it never
  // needs a second signature.
  if (status !== 'approved') {
    const { data: rpcResult, error: rpcError } = await adminClient.rpc('sponsor_decide_submission_atomic', {
      p_submission_id: submissionId,
      p_sponsor_user_id: user.id,
      p_decision: status,
      p_feedback: normalizedFeedback,
      p_amount_cents: 0,
    })
    if (rpcError) return { error: mapDbError(rpcError, 'sponsorUpdateSubmissionStatus.rpc') }

    const result = rpcResult as { ok: boolean; error?: string }
    if (!result?.ok) return { error: mapDecisionError(result?.error) }

    const followUp = await runDecisionFollowUp(submissionId, status, normalizedFeedback, 0)
    // A unilateral non-money decision is visible after the fact to the rest of the org.
    await notifyEligibleApprovers({
      sponsorId,
      submissionId,
      excludeProfileId: user.id,
      title: status === 'declined' ? 'A pitch was declined' : 'Changes were requested on a pitch',
      body: normalizedFeedback,
    })

    return followUp.emailsOk ? { success: true } : { success: true, warning: DECISION_EMAIL_WARNING }
  }

  // status === 'approved' — the only money-committing decision, and the only one that
  // can require a second signature.
  const { data: sub } = await adminClient
    .from('submissions')
    .select('reserved_amount_cents, requested_amount_cents')
    .eq('id', submissionId)
    .single()
  const { data: sponsor } = await adminClient
    .from('sponsors')
    .select('approval_required_above_cents')
    .eq('id', sponsorId)
    .single()

  const amountCents = sub?.reserved_amount_cents || sub?.requested_amount_cents || 0

  if (requiresApproval(amountCents, sponsor?.approval_required_above_cents ?? null)) {
    const { data: rpcResult, error: rpcError } = await adminClient.rpc('create_sponsor_decision_proposal', {
      p_submission_id: submissionId,
      p_proposed_by: user.id,
      p_amount_cents: 0,
      p_origin: 'portal',
      p_feedback: normalizedFeedback,
    })
    if (rpcError) return { error: mapDbError(rpcError, 'sponsorUpdateSubmissionStatus.proposeRpc') }

    const result = rpcResult as { ok: boolean; error?: string; proposal_id?: string; amount_cents?: number }
    if (!result?.ok) return { error: mapDecisionError(result?.error) }

    const warning = await notifyEligibleApprovers({
      sponsorId,
      submissionId,
      excludeProfileId: user.id,
      title: 'A funding request needs your approval',
      body: normalizedFeedback,
    })

    revalidatePath('/sponsor/approvals')
    return {
      success: true,
      pendingApproval: true,
      proposalId: result.proposal_id,
      amountCents: result.amount_cents ?? amountCents,
      ...(warning.warning ? { warning: warning.warning } : {}),
    }
  }

  // Below threshold (or approvals off for this org) — the existing RPC call, byte-for-byte
  // the code that was there before this slice.
  const { data: rpcResult, error: rpcError } = await adminClient.rpc('sponsor_decide_submission_atomic', {
    p_submission_id: submissionId,
    p_sponsor_user_id: user.id,
    p_decision: status,
    p_feedback: normalizedFeedback,
    p_amount_cents: 0,
  })

  if (rpcError) return { error: mapDbError(rpcError, 'sponsorUpdateSubmissionStatus.rpc') }

  const result = rpcResult as { ok: boolean; error?: string; amount_cents?: number }
  if (!result?.ok) {
    return { error: mapDecisionError(result?.error) }
  }

  const followUp = await runDecisionFollowUp(submissionId, 'approved', normalizedFeedback, result.amount_cents ?? 0)

  return followUp.emailsOk ? { success: true } : { success: true, warning: DECISION_EMAIL_WARNING }
}

export async function recordSponsorDecision(
  token: string,
  decision: 'decline' | 'full' | 'partial',
  amountCents?: number
) {
  const parsed = recordDecisionSchema.safeParse({ token, decision, amountCents })
  if (!parsed.success) return { ok: false, error: 'Invalid data provided' }

  const adminClient = createAdminClient()
  const tokenHash = createHash('sha256').update(token).digest('hex')

  const { data: context } = await adminClient
    .from('submission_access_tokens')
    .select(
      `submission_id,
       submissions:submission_id (
         id, sponsor_id, status, reserved_amount_cents, requested_amount_cents,
         teams:team_id (owner_id),
         sponsors:sponsor_id (company_name, approval_required_above_cents)
       )`
    )
    .eq('token_hash', tokenHash)
    .single()

  // decision === 'decline' is unchanged: no money moves, so it is never gated (see the
  // "Which decisions are gated" table) — falls through to the existing RPC below.
  if (decision !== 'decline') {
    const submission = context?.submissions as {
      id?: string
      sponsor_id?: string
      reserved_amount_cents?: number | null
      requested_amount_cents?: number | null
      sponsors?: { approval_required_above_cents?: number | null } | null
    } | null
    const threshold = submission?.sponsors?.approval_required_above_cents ?? null
    const reserved = submission?.reserved_amount_cents || submission?.requested_amount_cents || 0
    const partialAmount = decision === 'partial' ? Math.max(0, Math.floor(amountCents ?? 0)) : 0
    const settlingAmount = decision === 'partial' && partialAmount > 0 && partialAmount < reserved ? partialAmount : reserved

    // A mailbox cannot hold the approver role — a control the portal enforces must not be
    // bypassable by forwarding an email. When approvals are on and the amount clears the
    // threshold, the link proposes instead of committing, and the single-use token is NOT
    // burned (create_sponsor_decision_proposal never claims it).
    if (submission?.id && requiresApproval(settlingAmount, threshold)) {
      const { data: rpcResult, error } = await adminClient.rpc('create_sponsor_decision_proposal', {
        p_submission_id: submission.id,
        p_proposed_by: null,
        p_amount_cents: decision === 'partial' ? partialAmount : 0,
        p_origin: 'token',
        p_feedback: undefined,
      })
      if (error) return { ok: false, error: mapDbError(error, 'recordSponsorDecision.proposeRpc') }

      const result = rpcResult as { ok: boolean; error?: string; amount_cents?: number }
      if (!result?.ok) return { ok: false, error: mapDecisionError(result?.error) }

      if (submission.sponsor_id) {
        await notifyEligibleApprovers({
          sponsorId: submission.sponsor_id,
          submissionId: submission.id,
          excludeProfileId: null,
          title: 'A funding request needs your approval',
        }).catch(() => undefined)
      }

      return { ok: true, pendingApproval: true, amountCents: result.amount_cents }
    }
  }

  const partialAmount = decision === 'partial' ? Math.max(0, Math.floor(amountCents ?? 0)) : 0
  const { data: rpcResult, error } = await adminClient.rpc('record_sponsor_decision_atomic', {
    p_token_hash: tokenHash,
    p_decision: decision,
    p_partial_amount_cents: partialAmount,
  })

  if (error) {
    return { ok: false, error: mapDbError(error, 'recordSponsorDecision.rpc') }
  }

  const result = rpcResult as { ok: boolean; error?: string; amount_cents?: number }
  if (!result?.ok) {
    return { ok: false, error: mapDecisionError(result?.error) }
  }

  const submissionId = context?.submission_id
  const recipientId = (context?.submissions as { teams?: { owner_id?: string } } | null)?.teams?.owner_id
  const sponsorName = (context?.submissions as { sponsors?: { company_name?: string } } | null)?.sponsors?.company_name ?? 'your sponsor'

  if (recipientId && submissionId) {
    const statusType = decision === 'decline' ? 'submission_declined' : 'submission_approved'
    const statusTitle = decision === 'decline'
      ? `${sponsorName} declined your submission`
      : `${sponsorName} approved your submission`

    await createInAppNotification({
      skipEmail: true,
      recipientId,
      type: statusType,
      title: statusTitle,
      submissionId,
    })
  }

  // Senders never throw — collect results so a failed decision-critical email
  // surfaces as a warning while the recorded decision still returns ok.
  let emailsOk = true
  if (submissionId && decision !== 'decline') {
    const approvedAmount = result.amount_cents ?? partialAmount
    const [handshake, decisionEmail] = await Promise.all([
      sendHandshakeEmail(submissionId, approvedAmount),
      sendSubmissionDecisionEmail(submissionId, 'approved'),
    ])
    emailsOk = handshake.success && decisionEmail.success
  } else if (submissionId) {
    emailsOk = (await sendSubmissionDecisionEmail(submissionId, 'declined')).success
  }

  revalidatePath('/dashboard')
  revalidatePath('/sponsor/inbox')
  return emailsOk ? { ok: true } : { ok: true, warning: DECISION_EMAIL_WARNING }
}
