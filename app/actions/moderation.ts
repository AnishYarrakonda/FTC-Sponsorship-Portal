'use server'

import { dispatchApprovedSubmission } from '@/lib/dispatch'
import { sendSubmissionDecisionEmail, createInAppNotification } from '@/lib/notify'
import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/actions-utils'
import { mapDbError } from '@/lib/errors'
import { z } from 'zod'
import { writeAudit } from '@/lib/audit'

const moderationSchema = z.object({
  submissionId: z.string().uuid(),
  feedback: z.string().max(2000).optional(),
})

export async function approveSubmission(submissionId: string) {
  const parsed = moderationSchema.safeParse({ submissionId })
  if (!parsed.success) return { error: 'Invalid submission ID' }

  let user, adminClient
  try {
    const auth = await requireAdmin()
    user = auth.user
    adminClient = auth.adminClient
  } catch (e: any) {
    return { error: e.message }
  }

  // Atomic RPC: locks sponsor row, debits budget, writes ledger + audit_log,
  // mints access token, and stamps sent_at / expires_at on the submission row.
  // No fallback: budget integrity must not be bypassed, so a failure surfaces
  // to the admin who can retry rather than silently overflowing capacity.
  // P1-21: this passed p_amount_cents: 0, which makes approve_submission_atomic fall
  // back to the team's CURRENT financial_ask_cents (0047:61-62) — a value the coach can
  // still change after submitting. So the amount reserved against the sponsor's cap was
  // not necessarily the amount the admin reviewed and approved.
  //
  // submissions.requested_amount_cents is snapshotted at submit time
  // (app/actions/submission.ts:105) and is what the moderation queue renders, so it is
  // the figure the admin actually saw. Pass it explicitly. Falling back to 0 preserves
  // the old behaviour for legacy rows that never got a snapshot.
  const { data: reviewed, error: reviewedError } = await adminClient
    .from('submissions')
    .select('requested_amount_cents')
    .eq('id', submissionId)
    .single()

  // If this read fails we must NOT fall through to 0: that silently restores exactly the
  // P1-21 behaviour this block exists to remove (the RPC would re-derive the amount from
  // the team's *current* financial_ask_cents). Fail loudly instead.
  if (reviewedError) {
    return { error: mapDbError(reviewedError, 'approveSubmission.readAmount') }
  }

  const { data: rpcResult, error: rpcError } = await adminClient.rpc('approve_submission_atomic', {
    p_submission_id: submissionId,
    p_admin_id: user.id,
    p_amount_cents: reviewed?.requested_amount_cents ?? 0,
  })

  if (rpcError) {
    console.error('approve_submission_atomic failed', rpcError)
    return { error: 'Could not approve submission right now. Please retry. If this keeps happening, contact engineering.' }
  }

  const result = rpcResult as { ok: boolean; error?: string; token?: string; amount_cents?: number }
  if (!result.ok) {
    const messages: Record<string, string> = {
      submission_not_found: 'Submission not found.',
      submission_not_pending: 'This submission is no longer pending review.',
      sponsor_not_found: 'Sponsor not found.',
      insufficient_sponsor_capacity: 'Sponsor does not have enough remaining capacity for this request.',
      invalid_amount:
        "This team's portfolio has no funding ask. The coach needs to add budget line items to their portfolio before this pitch can be dispatched.",
    }
    return { error: messages[result.error ?? ''] ?? result.error }
  }

  const finalToken = result.token

  // Notify coach + dispatch to sponsor with their access token. Both senders
  // never throw; they resolve { success, error? } so we can surface a warning
  // when the approval was saved but a decision-critical email failed.
  const [decisionEmail, dispatchResult] = await Promise.all([
    sendSubmissionDecisionEmail(submissionId, 'approved'),
    dispatchApprovedSubmission(submissionId, finalToken!),
  ])

  let warning: string | undefined
  if (!dispatchResult.success) {
    warning = 'The approval was saved, but the pitch email to the sponsor could not be sent. Please retry the dispatch or contact engineering.'
  } else if (!decisionEmail.success) {
    warning = 'The approval was saved, but the notification email to the coach could not be sent.'
  }

  const { data: sub } = await adminClient
    .from('submissions')
    .select('id, sponsor_id, team_id, teams:team_id(owner_id), sponsors:sponsor_id(company_name)')
    .eq('id', submissionId).single()

  const coachId = (sub?.teams as any)?.owner_id
  const sponsorName = (sub?.sponsors as any)?.company_name ?? 'a sponsor'

  if (coachId) {
    await createInAppNotification({
      skipEmail: true,
      recipientId: coachId,
      type: 'submission_approved',
      title: `Your application to ${sponsorName} was approved`,
      submissionId,
    })
  }

  if (sub?.sponsor_id) {
    const { data: sponsorProfiles } = await adminClient
      .from('profiles')
      .select('id')
      .eq('role', 'sponsor')
      .eq('sponsor_id', sub.sponsor_id)

    await Promise.all(
      (sponsorProfiles || []).map((p) =>
        createInAppNotification({
          recipientId: p.id,
          type: 'general',
          title: 'New submission is ready for your decision',
          body: 'A coach submission has been approved and sent to your inbox for review.',
          submissionId,
        })
      )
    )
  }

  revalidatePath('/moderation')
  revalidatePath('/dashboard')

  return warning ? { success: true, warning } : { success: true }
}

/**
 * P0-11 recovery path. An approval that committed but whose sponsor email failed left
 * the pitch in a permanently unrecoverable state: capacity consumed, coach told it was
 * approved, sponsor never contacted, re-approval impossible (approve_submission_atomic
 * asserts status='pending'), and no retry action in existence.
 *
 * Mints a fresh access token via remint_submission_access_token (0070) — the original
 * plaintext is unrecoverable, only its hash is stored — revoking any previous unused
 * one, then re-runs the gated dispatch. Reserves nothing and moves no money: the
 * reservation from the original approval is still live and is deliberately left alone.
 */
export async function redispatchSubmission(submissionId: string) {
  const parsed = moderationSchema.safeParse({ submissionId })
  if (!parsed.success) return { error: 'Invalid submission ID' }

  let user, adminClient
  try {
    const auth = await requireAdmin()
    user = auth.user
    adminClient = auth.adminClient
  } catch (e: any) {
    return { error: e.message }
  }

  // A pitch renders LIVE portfolio data at dispatch time, not a snapshot taken at
  // approval. `updateTeam` has no post-dispatch lock, so if the coach edited the
  // portfolio after the admin approved it, a resend would carry content no admin ever
  // reviewed straight to the sponsor — defeating the Admin-Gatekept Outreach mandate.
  //
  // Checked BEFORE the remint on purpose: remint_submission_access_token revokes the
  // previous unused token, so refusing afterwards would destroy a working link.
  const { data: sub, error: subError } = await adminClient
    .from('submissions')
    .select('sent_at, team_id')
    .eq('id', submissionId)
    .maybeSingle()

  if (subError) {
    return { error: mapDbError(subError as { code?: string; message?: string }, 'redispatchSubmission.preread') }
  }
  if (!sub) return { error: 'Submission not found.' }

  if (sub.sent_at && sub.team_id) {
    const { data: team, error: teamError } = await adminClient
      .from('teams')
      .select('updated_at')
      .eq('id', sub.team_id)
      .maybeSingle()

    if (teamError) {
      return { error: mapDbError(teamError as { code?: string; message?: string }, 'redispatchSubmission.teamread') }
    }
    if (team?.updated_at && new Date(team.updated_at) > new Date(sub.sent_at)) {
      return {
        error:
          'This team edited its portfolio after the pitch was approved, so resending would show the ' +
          'sponsor content no admin has reviewed. Review the current portfolio first; if it should go ' +
          'out, decline this pitch and have the coach resubmit it for approval.',
      }
    }
  }

  const { data: rpcData, error: rpcError } = await adminClient.rpc(
    'remint_submission_access_token',
    { p_submission_id: submissionId, p_admin_id: user.id }
  )

  if (rpcError) return { error: mapDbError(rpcError as { code?: string; message?: string }, 'redispatchSubmission.rpc') }

  const result = rpcData as { ok: boolean; error?: string; token?: string; current_status?: string }
  if (!result.ok) {
    const messages: Record<string, string> = {
      submission_not_found: 'Submission not found.',
      forbidden: 'You do not have permission to do that.',
      submission_expired: 'This pitch has expired — its reservation was already released, so it cannot be resent.',
      not_redispatchable: `This pitch is "${result.current_status}" and can no longer be sent to the sponsor.`,
    }
    return { error: messages[result.error ?? ''] ?? 'Could not resend this pitch.' }
  }

  const dispatchResult = await dispatchApprovedSubmission(submissionId, result.token!)

  await writeAudit(adminClient, {
    actor_id: user.id,
    action: 'redispatch_submission',
    entity_type: 'submissions',
    entity_id: submissionId,
    metadata: { success: dispatchResult.success, error: dispatchResult.error ?? null },
  })

  if (!dispatchResult.success) {
    return {
      error:
        'The pitch still could not be sent to the sponsor. A new access link was minted, so it is safe ' +
        'to try again. If this keeps happening, contact engineering.',
    }
  }

  revalidatePath('/moderation')
  return { success: true }
}

export async function declineSubmission(submissionId: string, feedback: string) {
  const parsed = moderationSchema.safeParse({ submissionId, feedback })
  if (!parsed.success) return { error: 'Invalid data' }

  let user, adminClient
  try {
    const auth = await requireAdmin()
    user = auth.user
    adminClient = auth.adminClient
  } catch (e: any) {
    return { error: e.message }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rpcData, error: rpcError } = await (adminClient as any).rpc('admin_terminal_decision_atomic', {
    p_submission_id: submissionId,
    p_admin_id: user.id,
    p_new_status: 'declined',
    p_feedback: feedback,
  })

  if (rpcError) return { error: mapDbError(rpcError as { code?: string; message?: string }, 'declineSubmission.rpc') }

  const rpcResult = rpcData as { ok: boolean; error?: string }
  if (!rpcResult.ok) {
    const messages: Record<string, string> = {
      submission_not_found: 'Submission not found.',
      submission_not_pending: 'This submission is no longer pending review.',
    }
    return { error: messages[rpcResult.error ?? ''] ?? 'Could not decline submission.' }
  }

  const declineEmail = await sendSubmissionDecisionEmail(submissionId, 'declined', feedback)

  const { data: sub } = await adminClient
    .from('submissions')
    .select('team_id, teams:team_id(owner_id), sponsors:sponsor_id(company_name)')
    .eq('id', submissionId).single()

  const coachId = (sub?.teams as any)?.owner_id
  const sponsorName = (sub?.sponsors as any)?.company_name ?? 'a sponsor'

  if (coachId) {
    await createInAppNotification({
      skipEmail: true,
      recipientId: coachId,
      type: 'submission_declined',
      title: `Your application to ${sponsorName} was declined`,
      body: feedback,
      submissionId,
    })
  }

  revalidatePath('/moderation')
  revalidatePath('/dashboard')

  return declineEmail.success
    ? { success: true }
    : { success: true, warning: 'The decision was saved, but the notification email to the coach could not be sent.' }
}

export async function requestEdit(submissionId: string, feedback: string) {
  const parsed = moderationSchema.safeParse({ submissionId, feedback })
  if (!parsed.success) return { error: 'Invalid data' }

  let user, adminClient
  try {
    const auth = await requireAdmin()
    user = auth.user
    adminClient = auth.adminClient
  } catch (e: any) {
    return { error: e.message }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rpcData, error: rpcError } = await (adminClient as any).rpc('admin_terminal_decision_atomic', {
    p_submission_id: submissionId,
    p_admin_id: user.id,
    p_new_status: 'changes_requested',
    p_feedback: feedback,
  })

  if (rpcError) return { error: mapDbError(rpcError as { code?: string; message?: string }, 'requestEdit.rpc') }

  const rpcResult = rpcData as { ok: boolean; error?: string }
  if (!rpcResult.ok) {
    const messages: Record<string, string> = {
      submission_not_found: 'Submission not found.',
      submission_not_pending: 'This submission is no longer pending review.',
    }
    return { error: messages[rpcResult.error ?? ''] ?? 'Could not request edits.' }
  }

  const requestEditEmail = await sendSubmissionDecisionEmail(submissionId, 'changes_requested', feedback)

  const { data: sub } = await adminClient
    .from('submissions')
    .select('team_id, teams:team_id(owner_id), sponsors:sponsor_id(company_name)')
    .eq('id', submissionId).single()

  const coachId = (sub?.teams as any)?.owner_id
  const sponsorName = (sub?.sponsors as any)?.company_name ?? 'a sponsor'

  if (coachId) {
    await createInAppNotification({
      skipEmail: true,
      recipientId: coachId,
      type: 'submission_changes_requested',
      title: `Changes requested for your application to ${sponsorName}`,
      body: feedback,
      submissionId,
    })
  }

  revalidatePath('/moderation')
  revalidatePath('/dashboard')

  return requestEditEmail.success
    ? { success: true }
    : { success: true, warning: 'The decision was saved, but the notification email to the coach could not be sent.' }
}

