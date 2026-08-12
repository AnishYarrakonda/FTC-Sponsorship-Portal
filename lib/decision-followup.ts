import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createInAppNotification, sendHandshakeEmail, sendSubmissionDecisionEmail } from '@/lib/notify'

/**
 * Shared by sponsor-decision.ts and sponsor-approvals.ts. Lives here rather than in
 * either 'use server' action file because every export of a 'use server' file must be an
 * async server action — the same constraint that keeps mapBudgetItems in
 * lib/dispatch-budget.ts instead of app/actions/submission.ts. Extend this map; do not
 * create a second one.
 */
export function mapDecisionError(code: string | undefined): string {
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
    proposal_pending: 'A funding request for this pitch is already awaiting approval.',
    proposal_not_found: 'Approval request not found.',
    proposal_not_pending: 'This approval request has already been resolved.',
    proposal_expired: 'This approval request expired before it was confirmed.',
    self_approval: 'A different person must confirm this request — the proposer cannot approve their own request.',
    forbidden: 'You do not have permission to do that.',
    reservation_expiring: 'This request expires too soon for a new approval window.',
  }
  return messages[code ?? ''] ?? 'Unable to record decision.'
}

/**
 * The post-decision fan-out shared by every path that settles a sponsor decision: the
 * coach notification, the handshake + decision emails, and the four dashboard
 * revalidations. Originally lived inline in sponsorUpdateSubmissionStatus
 * (app/actions/sponsor-decision.ts); extracted here so confirmFundingProposal
 * (app/actions/sponsor-approvals.ts) can call the identical fan-out rather than
 * duplicating it — duplicating it is how the handshake email (the one that tells a
 * coach money is coming) drifts between the two paths.
 *
 * Not in app/actions/ — every export in a 'use server' file must be an async server
 * action, which is why lib/dispatch-budget.ts exists as a separate module already.
 */
export async function runDecisionFollowUp(
  submissionId: string,
  status: 'approved' | 'declined' | 'changes_requested',
  feedback: string | undefined,
  amountCents: number
): Promise<{ emailsOk: boolean }> {
  const adminClient = createAdminClient()

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
      body: feedback,
      submissionId,
    })
  }

  // Senders never throw — collect results so a failed decision-critical email surfaces
  // as a warning while the saved decision still returns success.
  let emailsOk = true
  if (status === 'approved') {
    const [handshake, decision] = await Promise.all([
      sendHandshakeEmail(submissionId, amountCents),
      sendSubmissionDecisionEmail(submissionId, 'approved', feedback),
    ])
    emailsOk = handshake.success && decision.success
  } else if (status === 'declined') {
    emailsOk = (await sendSubmissionDecisionEmail(submissionId, 'declined', feedback)).success
  } else {
    emailsOk = (await sendSubmissionDecisionEmail(submissionId, 'changes_requested', feedback)).success
  }

  revalidatePath('/sponsor/dashboard')
  revalidatePath(`/sponsor/submissions/${submissionId}`)
  revalidatePath('/sponsor/inbox')
  revalidatePath('/dashboard')

  return { emailsOk }
}

/**
 * Notify everyone in the org who can act on a proposal (approver + org_admin ranks),
 * excluding the person who caused the notification (the proposer, the withdrawer, ...).
 * Resolved through the admin client — a cross-row read RLS would not permit from the
 * caller's own context (_CONTEXT.md §8.9). Shared by sponsorUpdateSubmissionStatus
 * (app/actions/sponsor-decision.ts, the propose branch) and
 * app/actions/sponsor-approvals.ts (withdraw).
 *
 * Degenerate cases are handled rather than silently producing zero recipients: if the
 * exclusion leaves nobody, fall back to notifying every org_admin regardless of the
 * exclusion (an unconfirmable proposal is worse than notifying the proposer), and record
 * it in audit_log. If the org has no membership rows at all (the legacy
 * profiles.sponsor_id-only shape), fall back to that pointer holder.
 */
export async function notifyEligibleApprovers({
  sponsorId,
  submissionId,
  excludeProfileId,
  title,
  body,
}: {
  sponsorId: string
  submissionId: string
  excludeProfileId: string | null
  title: string
  body?: string
}): Promise<{ warning?: string }> {
  const adminClient = createAdminClient()

  const { data: rows } = await adminClient
    .from('sponsor_members')
    .select('profile_id, role')
    .eq('sponsor_id', sponsorId)
    .in('role', ['approver', 'org_admin'])

  let recipients = (rows ?? [])
    .map((r) => r.profile_id)
    .filter((id): id is string => !!id && id !== excludeProfileId)

  if (recipients.length === 0) {
    const fallback = (rows ?? []).map((r) => r.profile_id).filter((id): id is string => !!id)
    if (fallback.length === 0) {
      const { data: legacyOwner } = await adminClient
        .from('profiles')
        .select('id')
        .eq('sponsor_id', sponsorId)
        .eq('role', 'sponsor')
        .maybeSingle()
      recipients = legacyOwner?.id ? [legacyOwner.id] : []
    } else {
      recipients = fallback
      await adminClient.from('audit_log').insert({
        actor_id: excludeProfileId,
        action: 'proposal_no_eligible_approver',
        entity_type: 'sponsor_decision_proposals',
        entity_id: submissionId,
        metadata: { sponsor_id: sponsorId },
      })
    }
  }

  let anyFailed = false
  for (const recipientId of recipients) {
    const result = await createInAppNotification({ recipientId, type: 'general', title, body, submissionId })
    if (!result.success) anyFailed = true
  }

  return anyFailed ? { warning: 'Some teammates could not be notified by email.' } : {}
}
