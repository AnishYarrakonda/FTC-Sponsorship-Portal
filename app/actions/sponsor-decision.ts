'use server'

import { createHash } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { createInAppNotification, sendHandshakeEmail, sendSubmissionDecisionEmail } from '@/lib/notify'
import { requireSponsorRole } from '@/lib/actions-utils'
import { mapDbError } from '@/lib/errors'
import {
  runDecisionFollowUp,
  mapDecisionError,
  notifyEligibleApprovers,
  revokeSubmissionAccessTokens,
} from '@/lib/decision-followup'
import { requiresApproval } from '@/lib/sponsor-roles'
import { z } from 'zod'
import { LIMITS } from '@/lib/schemas/limits'

const DECISION_EMAIL_WARNING = 'The decision was saved, but the notification email could not be sent.'

const sponsorUpdateSchema = z.object({
  submissionId: z.string().uuid(),
  status: z.enum(['approved', 'declined', 'changes_requested']),
  // P3: was a hardcoded 2000. Max lengths live in lib/schemas/limits.ts so the
  // schema and the textarea's maxLength cannot drift apart.
  feedback: z.string().max(LIMITS.feedback).optional(),
  /**
   * B-03-07. A partial offer used to exist only on the emailed bearer link: the in-portal
   * console could fund in full or decline, nothing between. A sponsor with $800 against a
   * $1,200 ask could express that only while still holding a working 14-day email link —
   * and the moderation queue itself surfaces the case where the email never arrived,
   * which is exactly when they fall back to the portal.
   *
   * Both RPCs already accepted p_amount_cents and already treated 0 < amount < reserved
   * as partial. Only this action and the console hardcoded 0.
   */
  amountCents: z.number().int().positive().optional(),
})

const recordDecisionSchema = z.object({
  token: z.string().min(1),
  decision: z.enum(['decline', 'full', 'partial']),
  amountCents: z.number().int().min(0).optional(),
})

export async function sponsorUpdateSubmissionStatus(
  submissionId: string,
  status: 'approved' | 'declined' | 'changes_requested',
  feedback?: string,
  amountCents?: number
) {
  const parsed = sponsorUpdateSchema.safeParse({ submissionId, status, feedback, amountCents })
  if (!parsed.success) return { error: 'Invalid data provided' }

  // A partial amount is only meaningful on the money-committing decision. Accepting one
  // on a decline would silently do nothing, which is worse than refusing it.
  if (amountCents !== undefined && status !== 'approved') {
    return { error: 'An amount can only be offered when approving a sponsorship.' }
  }

  let user, sponsorId, sponsorIds, adminClient
  try {
    ({ user, sponsorId, sponsorIds, adminClient } = await requireSponsorRole('submitter'))
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
    .select('sponsor_id, reserved_amount_cents, requested_amount_cents')
    .eq('id', submissionId)
    .single()

  /**
   * The threshold that decides whether this commitment needs a second signature must come
   * from the org that is actually FUNDING the pitch, not from whichever org happens to be
   * the caller's primary seat. Reading it from `sponsorId` was only correct because one
   * org per profile is enforced in the invite action and the Clerk webhook -- application
   * code, not a schema constraint. The moment a profile holds two memberships, org A's
   * approval policy would gate a commitment made on behalf of org B.
   */
  const decisionSponsorId = sub?.sponsor_id ?? sponsorId
  if (!sponsorIds.includes(decisionSponsorId)) {
    return { error: 'You do not have permission to do that.' }
  }

  const { data: sponsor } = await adminClient
    .from('sponsors')
    .select('approval_required_above_cents')
    .eq('id', decisionSponsorId)
    .single()

  const fullAmountCents = sub?.reserved_amount_cents || sub?.requested_amount_cents || 0

  /**
   * B-03-07. A partial offer above the full ask is not a partial offer — refuse it here
   * rather than letting the RPC's `p_amount_cents < v_reserved` test quietly reinterpret
   * it as "fund in full", which would commit MORE money than the sponsor chose.
   */
  const requestedPartial = parsed.data.amountCents
  if (requestedPartial !== undefined && fullAmountCents > 0 && requestedPartial > fullAmountCents) {
    return { error: 'A partial offer cannot exceed the full request.' }
  }

  const partialAmountCents =
    requestedPartial !== undefined && requestedPartial < fullAmountCents ? requestedPartial : 0

  // The threshold has to be judged against what is actually being committed. Gating a
  // $200 partial on the approval rule for a $5,000 ask would send trivial commitments to
  // approvers for no reason.
  const committedAmountCents = partialAmountCents > 0 ? partialAmountCents : fullAmountCents

  if (requiresApproval(committedAmountCents, sponsor?.approval_required_above_cents ?? null)) {
    const { data: rpcResult, error: rpcError } = await adminClient.rpc('create_sponsor_decision_proposal', {
      p_submission_id: submissionId,
      p_proposed_by: user.id,
      // B-03-07: the partial has to survive the approval round-trip, or an approver would
      // countersign the full amount the submitter never offered.
      p_amount_cents: partialAmountCents,
      p_origin: 'portal',
      p_feedback: normalizedFeedback,
    })
    if (rpcError) return { error: mapDbError(rpcError, 'sponsorUpdateSubmissionStatus.proposeRpc') }

    const result = rpcResult as { ok: boolean; error?: string; proposal_id?: string; amount_cents?: number }
    if (!result?.ok) return { error: mapDecisionError(result?.error) }

    // Same reason as the threshold above: the approvers who must countersign belong to the
    // funding org, not to the caller's primary seat.
    const warning = await notifyEligibleApprovers({
      sponsorId: decisionSponsorId,
      submissionId,
      excludeProfileId: user.id,
      title: 'A funding request needs your approval',
      body: normalizedFeedback,
    })

    /**
     * A-03-03, corrected. The finding claimed the two SETTLE branches return success
     * without revalidating; they do not — both call runDecisionFollowUp, which issues
     * four revalidatePath calls. The real gap is the inverse: this PROPOSAL branch
     * revalidated only /sponsor/approvals, while creating a pending proposal also changes
     * what /sponsor/inbox and /sponsor/dashboard must render (the pitch moves out of
     * "awaiting your decision" into "awaiting approval").
     */
    revalidatePath('/sponsor/approvals')
    revalidatePath('/sponsor/inbox')
    revalidatePath('/sponsor/dashboard')
    revalidatePath(`/sponsor/submissions/${submissionId}`)
    return {
      success: true,
      pendingApproval: true,
      proposalId: result.proposal_id,
      amountCents: result.amount_cents ?? committedAmountCents,
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
    p_amount_cents: partialAmountCents,
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
      `submission_id, used_at, revoked_at, expires_at,
       submissions:submission_id (
         id, sponsor_id, status, reserved_amount_cents, requested_amount_cents,
         teams:team_id (owner_id),
         sponsors:sponsor_id (company_name, approval_required_above_cents)
       )`
    )
    .eq('token_hash', tokenHash)
    .single()

  /**
   * Token lifecycle, checked HERE and not only in the RPC.
   *
   * `record_sponsor_decision_atomic` validates used_at / revoked_at / expires_at itself,
   * so for most of this action's history the absence of a check here was harmless. Prompt
   * 09 then inserted the approval branch BELOW, in front of that RPC — and
   * `create_sponsor_decision_proposal` only runs its entitlement check when
   * `p_origin = 'portal'` (0083), doing no token validation at all on the `token` path.
   *
   * The result was that a revoked or expired link — a superseded token from the 0070
   * re-mint, or an old forwarded email — could still originate a pending funding proposal
   * and cause the org's approvers to be emailed asking them to confirm it. No money moves
   * without a real approver clicking confirm, but a withdrawn credential must not be able
   * to start a funding action at all; that is the entire point of revoking it.
   *
   * The sibling token path already got this right — see the same three checks in
   * `postSponsorQuestionByToken` (app/actions/messages.ts).
   */
  if (!context) return { ok: false, error: 'This link is no longer valid.' }
  if (context.revoked_at) return { ok: false, error: 'This link has been revoked.' }
  if (context.used_at) return { ok: false, error: 'A decision has already been recorded for this pitch.' }
  if (context.expires_at && new Date(context.expires_at) < new Date()) {
    return { ok: false, error: 'This link has expired. Contact the team for a new one.' }
  }

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

  /**
   * B-03-11. The RPC sets `used_at` on the token it consumed, but a submission can hold
   * more than one token — 0070 re-mints on resend — and `used_at` is not what
   * `/sponsor-view/[token]` gates on. Revoke every outstanding token for this submission,
   * matching the portal path in runDecisionFollowUp.
   */
  if (submissionId) {
    await revokeSubmissionAccessTokens(adminClient, submissionId, `token_decision_${decision}`)
  }

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
    // A-05-04. Same duplicate as runDecisionFollowUp had, on the emailed-token path.
    // The handshake is the canonical approval email; see the note there.
    const approvedAmount = result.amount_cents ?? partialAmount
    emailsOk = (await sendHandshakeEmail(submissionId, approvedAmount)).success
  } else if (submissionId) {
    emailsOk = (await sendSubmissionDecisionEmail(submissionId, 'declined')).success
  }

  revalidatePath('/dashboard')
  revalidatePath('/sponsor/inbox')
  return emailsOk ? { ok: true } : { ok: true, warning: DECISION_EMAIL_WARNING }
}
