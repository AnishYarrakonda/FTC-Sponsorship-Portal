'use server'

import { createHash } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { createInAppNotification, sendHandshakeEmail, sendSubmissionDecisionEmail } from '@/lib/notify'
import { requireSponsor } from '@/lib/actions-utils'
import { mapDbError } from '@/lib/errors'
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

function mapDecisionError(code: string | undefined) {
  const messages: Record<string, string> = {
    invalid_token: 'Invalid or expired decision link.',
    token_expired: 'This decision link has expired.',
    token_used: 'A decision has already been recorded for this link.',
    insufficient_capacity: 'Not enough sponsor budget remains for this amount.',
    unauthorized: 'Unauthorized sponsor account.',
    submission_not_found: 'Submission not found.',
    invalid_status: 'This submission can no longer be updated.',
    amount_required: 'A valid funding amount is required.',
    already_decided: 'A sponsor decision has already been recorded for this submission.',
  }
  return messages[code ?? ''] ?? 'Unable to record decision.'
}

export async function sponsorUpdateSubmissionStatus(
  submissionId: string,
  status: 'approved' | 'declined' | 'changes_requested',
  feedback?: string
) {
  const parsed = sponsorUpdateSchema.safeParse({ submissionId, status, feedback })
  if (!parsed.success) return { error: 'Invalid data provided' }

  let user, adminClient
  try {
    const auth = await requireSponsor()
    user = auth.user
    adminClient = auth.adminClient
  } catch (e: any) {
    return { error: e.message }
  }

  const normalizedFeedback = feedback?.trim() || undefined
  const amountCents = 0

  const { data: rpcResult, error: rpcError } = await adminClient.rpc('sponsor_decide_submission_atomic', {
    p_submission_id: submissionId,
    p_sponsor_user_id: user.id,
    p_decision: status,
    p_feedback: normalizedFeedback,
    p_amount_cents: amountCents,
  })

  if (rpcError) return { error: mapDbError(rpcError, 'sponsorUpdateSubmissionStatus.rpc') }

  const result = rpcResult as { ok: boolean; error?: string; amount_cents?: number }
  if (!result?.ok) {
    return { error: mapDecisionError(result?.error) }
  }

  const { data: submission } = await adminClient
    .from('submissions')
    .select('id, teams:team_id(owner_id), sponsors:sponsor_id(company_name)')
    .eq('id', submissionId)
    .single()

  const recipientId = (submission?.teams as { owner_id?: string } | null)?.owner_id
  const sponsorName = (submission?.sponsors as { company_name?: string } | null)?.company_name ?? 'your sponsor'

  if (recipientId) {
    await createInAppNotification({
      skipEmail: true,
      recipientId,
      type: status === 'approved' ? 'submission_approved' : status === 'declined' ? 'submission_declined' : 'submission_changes_requested',
      title: status === 'approved' ? `${sponsorName} approved your submission` : status === 'declined' ? `${sponsorName} declined your submission` : `${sponsorName} requested changes`,
      body: normalizedFeedback,
      submissionId,
    })
  }

  // Senders never throw — collect results so a failed decision-critical email
  // surfaces as a warning while the saved decision still returns success.
  let emailsOk = true
  if (status === 'approved') {
    const approvedAmount = result.amount_cents ?? amountCents
    const [handshake, decision] = await Promise.all([
      sendHandshakeEmail(submissionId, approvedAmount),
      sendSubmissionDecisionEmail(submissionId, 'approved', normalizedFeedback),
    ])
    emailsOk = handshake.success && decision.success
  } else if (status === 'declined') {
    emailsOk = (await sendSubmissionDecisionEmail(submissionId, 'declined', normalizedFeedback)).success
  } else {
    emailsOk = (await sendSubmissionDecisionEmail(submissionId, 'changes_requested', normalizedFeedback)).success
  }

  revalidatePath('/sponsor/dashboard')
  revalidatePath(`/sponsor/submissions/${submissionId}`)
  revalidatePath('/sponsor/inbox')
  revalidatePath('/dashboard')

  return emailsOk ? { success: true } : { success: true, warning: DECISION_EMAIL_WARNING }
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
    .select('submission_id, submissions:submission_id(id, teams:team_id(owner_id), sponsors:sponsor_id(company_name))')
    .eq('token_hash', tokenHash)
    .single()

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

