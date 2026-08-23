'use server'

import { revalidatePath } from 'next/cache'
import { formatMoneyAmount } from '@/lib/format-money'
import { requireSponsorRole } from '@/lib/actions-utils'
import { createInAppNotification } from '@/lib/notify'
import { runDecisionFollowUp, mapDecisionError, notifyEligibleApprovers } from '@/lib/decision-followup'
import { mapDbError } from '@/lib/errors'
import { updateSponsorAsOrgAdmin } from '@/lib/sponsor-org-writes'
import {
  confirmProposalSchema,
  rejectProposalSchema,
  withdrawProposalSchema,
  orgApprovalSettingsSchema,
} from '@/lib/schemas/sponsor-approvals'

import { writeAudit } from '@/lib/audit'
export async function confirmFundingProposal(data: { proposalId: string; note?: string }) {
  const parsed = confirmProposalSchema.safeParse(data)
  if (!parsed.success) {
    return { error: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', ') }
  }

  let user, sponsorId, adminClient
  try {
    ({ user, sponsorId, adminClient } = await requireSponsorRole('approver'))
  } catch (e: any) {
    return { error: e.message }
  }

  // Re-derive the proposal scoped to the caller's own org before any mutation — a
  // proposalId from another organization must not be reachable here.
  const { data: proposal, error: lookupError } = await adminClient
    .from('sponsor_decision_proposals')
    .select('id, submission_id, sponsor_id, amount_cents, proposed_by, status')
    .eq('id', parsed.data.proposalId)
    .eq('sponsor_id', sponsorId)
    .maybeSingle()
  if (lookupError) return { error: mapDbError(lookupError, 'confirmFundingProposal.lookup') }
  if (!proposal) return { error: 'Approval request not found in your organization.' }

  const { data: rpcResult, error: rpcError } = await adminClient.rpc('confirm_sponsor_decision_proposal', {
    p_proposal_id: parsed.data.proposalId,
    p_approver_id: user.id,
    p_note: parsed.data.note?.trim() || undefined,
  })
  if (rpcError) return { error: mapDbError(rpcError, 'confirmFundingProposal.rpc') }

  const result = rpcResult as { ok: boolean; error?: string; amount_cents?: number }
  if (!result?.ok) return { error: mapDecisionError(result?.error) }

  const followUp = await runDecisionFollowUp(proposal.submission_id, 'approved', undefined, result.amount_cents ?? proposal.amount_cents)

  if (proposal.proposed_by) {
    await createInAppNotification({
      recipientId: proposal.proposed_by,
      type: 'general',
      title: 'Your funding proposal was confirmed',
      body: `A second approver confirmed the funding request you sent for $${formatMoneyAmount((result.amount_cents ?? proposal.amount_cents))}.`,
      submissionId: proposal.submission_id,
    })
  }

  revalidatePath('/sponsor/approvals')
  return followUp.emailsOk ? { success: true } : { success: true, warning: 'The decision was saved, but the notification email could not be sent.' }
}

export async function rejectFundingProposal(data: { proposalId: string; note: string }) {
  const parsed = rejectProposalSchema.safeParse(data)
  if (!parsed.success) {
    return { error: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', ') }
  }

  let user, sponsorId, adminClient
  try {
    ({ user, sponsorId, adminClient } = await requireSponsorRole('approver'))
  } catch (e: any) {
    return { error: e.message }
  }

  const { data: proposal, error: lookupError } = await adminClient
    .from('sponsor_decision_proposals')
    .select('id, submission_id, sponsor_id, proposed_by, status')
    .eq('id', parsed.data.proposalId)
    .eq('sponsor_id', sponsorId)
    .maybeSingle()
  if (lookupError) return { error: mapDbError(lookupError, 'rejectFundingProposal.lookup') }
  if (!proposal) return { error: 'Approval request not found in your organization.' }
  if (proposal.status !== 'pending') return { error: 'This approval request has already been resolved.' }

  // The status pre-read above is a TOCTOU window, not a guard: a racing approver can confirm
  // this proposal — committing the money — between the read and this write. The .eq('status')
  // filter catches it, but a guarded UPDATE that matches nothing returns ZERO ROWS AND NO
  // ERROR, so without the rowcount check below we would audit a rejection and tell the
  // proposer their request was rejected while the funding had in fact just been approved.
  const { data: rejected, error: updateError } = await adminClient
    .from('sponsor_decision_proposals')
    .update({
      status: 'rejected',
      decided_by: user.id,
      decided_at: new Date().toISOString(),
      decision_note: parsed.data.note,
    })
    .eq('id', proposal.id)
    .eq('status', 'pending')
    .select('id')
  if (updateError) return { error: mapDbError(updateError, 'rejectFundingProposal.update') }
  if (!rejected || rejected.length === 0) {
    return { error: 'This approval request has already been resolved.' }
  }

  await writeAudit(adminClient, {
    actor_id: user.id,
    action: 'reject_sponsor_funding',
    entity_type: 'sponsor_decision_proposals',
    entity_id: proposal.id,
    metadata: { submission_id: proposal.submission_id, sponsor_id: sponsorId, note: parsed.data.note },
  })

  if (proposal.proposed_by) {
    await createInAppNotification({
      recipientId: proposal.proposed_by,
      type: 'general',
      title: 'Your funding proposal was rejected',
      body: parsed.data.note,
      submissionId: proposal.submission_id,
    })
  }

  revalidatePath('/sponsor/approvals')
  return { success: true }
}

export async function withdrawFundingProposal(data: { proposalId: string }) {
  const parsed = withdrawProposalSchema.safeParse(data)
  if (!parsed.success) {
    return { error: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', ') }
  }

  let user, sponsorId, adminClient, memberRole
  try {
    ({ user, sponsorId, adminClient, memberRole } = await requireSponsorRole('submitter'))
  } catch (e: any) {
    return { error: e.message }
  }

  const { data: proposal, error: lookupError } = await adminClient
    .from('sponsor_decision_proposals')
    .select('id, submission_id, sponsor_id, proposed_by, status')
    .eq('id', parsed.data.proposalId)
    .eq('sponsor_id', sponsorId)
    .maybeSingle()
  if (lookupError) return { error: mapDbError(lookupError, 'withdrawFundingProposal.lookup') }
  if (!proposal) return { error: 'Approval request not found in your organization.' }
  if (proposal.status !== 'pending') return { error: 'This approval request has already been resolved.' }

  if (proposal.proposed_by !== user.id && memberRole !== 'org_admin') {
    return { error: 'Only the person who proposed this request, or an admin, can withdraw it.' }
  }

  // Same race as rejectFundingProposal: zero rows matched is not an error in PostgREST.
  const { data: withdrawn, error: updateError } = await adminClient
    .from('sponsor_decision_proposals')
    .update({ status: 'withdrawn', decided_by: user.id, decided_at: new Date().toISOString() })
    .eq('id', proposal.id)
    .eq('status', 'pending')
    .select('id')
  if (updateError) return { error: mapDbError(updateError, 'withdrawFundingProposal.update') }
  if (!withdrawn || withdrawn.length === 0) {
    return { error: 'This approval request has already been resolved.' }
  }

  await writeAudit(adminClient, {
    actor_id: user.id,
    action: 'withdraw_sponsor_funding',
    entity_type: 'sponsor_decision_proposals',
    entity_id: proposal.id,
    metadata: { submission_id: proposal.submission_id, sponsor_id: sponsorId },
  })

  await notifyEligibleApprovers({
    sponsorId,
    submissionId: proposal.submission_id,
    excludeProfileId: user.id,
    title: 'A funding proposal was withdrawn',
    body: 'The teammate who proposed this funding decision withdrew it before it was confirmed.',
  })

  revalidatePath('/sponsor/approvals')
  return { success: true }
}

export async function updateOrgApprovalSettings(data: { approvalRequiredAboveCents: number | null }) {
  const parsed = orgApprovalSettingsSchema.safeParse(data)
  if (!parsed.success) {
    return { error: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', ') }
  }

  let user, sponsorId, adminClient
  try {
    ({ user, sponsorId, adminClient } = await requireSponsorRole('org_admin'))
  } catch (e: any) {
    return { error: e.message }
  }

  const { approvalRequiredAboveCents } = parsed.data

  if (approvalRequiredAboveCents !== null) {
    const { count } = await adminClient
      .from('sponsor_members')
      .select('id', { count: 'exact', head: true })
      .eq('sponsor_id', sponsorId)
      .in('role', ['approver', 'org_admin'])
    if ((count ?? 0) < 2) {
      return {
        error: 'Add a second teammate with the Approver role before turning on approvals — otherwise nobody could confirm a request.',
      }
    }
  }

  const { data: before } = await adminClient
    .from('sponsors')
    .select('approval_required_above_cents')
    .eq('id', sponsorId)
    .single()

  // Column allowlist, not a bare object literal -- see lib/sponsor-org-writes.ts. An org
  // admin reaches `sponsors` only through the RLS-bypassing admin client, so this is the
  // control that keeps funding_cap_cents out of reach.
  const { error: updateError } = await updateSponsorAsOrgAdmin(adminClient, sponsorId, {
    approval_required_above_cents: approvalRequiredAboveCents,
  })
  if (updateError) return { error: mapDbError(updateError, 'updateOrgApprovalSettings.update') }

  await writeAudit(adminClient, {
    actor_id: user.id,
    action: 'update_org_approval_settings',
    entity_type: 'sponsors',
    entity_id: sponsorId,
    metadata: { from: before?.approval_required_above_cents ?? null, to: approvalRequiredAboveCents },
  })

  const { data: members } = await adminClient
    .from('sponsor_members')
    .select('profile_id')
    .eq('sponsor_id', sponsorId)
  const title =
    approvalRequiredAboveCents === null
      ? 'Two-step approval was turned off'
      : `Two-step approval is now on above $${formatMoneyAmount(approvalRequiredAboveCents)}`
  for (const m of members ?? []) {
    if (!m.profile_id || m.profile_id === user.id) continue
    await createInAppNotification({ recipientId: m.profile_id, type: 'general', title })
  }

  revalidatePath('/sponsor/settings')
  return { success: true }
}

export async function listFundingProposals() {
  let sponsorId, adminClient
  try {
    ({ sponsorId, adminClient } = await requireSponsorRole('viewer'))
  } catch (e: any) {
    return { error: e.message }
  }

  const { data: proposals, error } = await adminClient
    .from('sponsor_decision_proposals')
    .select(
      `id, submission_id, sponsor_id, amount_cents, feedback, status, origin,
       proposed_by, proposed_at, decided_by, decided_at, decision_note, closed_reason,
       settled_amount_cents, expires_at,
       submissions:submission_id (id, teams:team_id (team_name, ftc_team_number)),
       proposer:proposed_by (full_name, email),
       approver:decided_by (full_name, email)`
    )
    .eq('sponsor_id', sponsorId)
    .order('proposed_at', { ascending: false })
  if (error) return { error: mapDbError(error, 'listFundingProposals') }

  return { success: true, proposals: proposals ?? [] }
}
