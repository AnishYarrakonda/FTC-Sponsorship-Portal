import 'server-only'
import * as Sentry from '@sentry/nextjs'
import { writeAudit } from '@/lib/audit'
import { createInAppNotification } from '@/lib/notify'

/**
 * What has to happen when someone stops being a member of a sponsor organization.
 *
 * Two paths reach this: `removeSponsorMember` (an org admin clicking Remove) and the
 * Clerk `organizationMembership.deleted` webhook (an IdP deprovisioning through SCIM, or
 * a removal made in the Clerk dashboard). They used to do different things, and the
 * webhook — the path an enterprise actually uses — did the least.
 *
 * Everything here is best-effort and never throws. A failure must not turn a handled
 * webhook into a 500: Svix would redeliver a membership deletion that has already
 * happened in Clerk, forever. (Same lesson as A-01-02.)
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any

/**
 * A-12-02. Withdraw the pending funding proposals authored by a departing member.
 *
 * `sponsor_decision_proposals.proposed_by` pointed at them and nothing cleaned it up, so
 * an enterprise offboarding a manager mid-quarter left in-flight approvals sitting
 * `pending`, attributed to someone who no longer exists in the org and with no UI to
 * reassign them. They would sit there until the expiry sweep eventually closed them.
 *
 * Withdrawn rather than reassigned or auto-confirmed: a proposal is a person's
 * recommendation to commit money, and there is no honest way to transfer authorship or to
 * confirm it on their behalf. Withdrawal is reversible — any remaining submitter can
 * propose again — and it releases the approvers from a decision they can no longer ask
 * anyone about.
 */
export async function withdrawProposalsForDepartedMember(
  adminClient: AdminClient,
  sponsorId: string,
  profileId: string,
  actorId: string | null
): Promise<{ withdrawn: number }> {
  try {
    const { data: withdrawn, error } = await adminClient
      .from('sponsor_decision_proposals')
      .update({
        status: 'withdrawn',
        decided_by: actorId,
        decided_at: new Date().toISOString(),
        closed_reason: 'proposer_offboarded',
      })
      .eq('sponsor_id', sponsorId)
      .eq('proposed_by', profileId)
      .eq('status', 'pending')
      .select('id, submission_id')

    if (error) {
      console.error('[offboarding] failed to withdraw proposals', sponsorId, profileId, error)
      Sentry.captureException(new Error(`[offboarding] withdraw failed: ${error.message}`))
      return { withdrawn: 0 }
    }

    const rows = (withdrawn ?? []) as { id: string; submission_id: string }[]
    for (const row of rows) {
      await writeAudit(adminClient, {
        actor_id: actorId,
        action: 'withdraw_sponsor_funding_offboarded',
        entity_type: 'sponsor_decision_proposals',
        entity_id: row.id,
        metadata: { sponsor_id: sponsorId, proposed_by: profileId, submission_id: row.submission_id },
      })
    }

    return { withdrawn: rows.length }
  } catch (e) {
    console.error('[offboarding] withdrawProposalsForDepartedMember threw', e)
    Sentry.captureException(e)
    return { withdrawn: 0 }
  }
}

/**
 * A-12-03. Never let an organization end up with no admin.
 *
 * `removeSponsorMember` refuses to remove the last `org_admin`. The webhook had no such
 * check at all — so an IdP deprovisioning the last admin through SCIM left the
 * organization headless: nobody could invite, approve, or change settings, and the only
 * route back was a platform admin editing the database.
 *
 * The webhook cannot simply refuse. The membership is already gone in Clerk, which is the
 * source of truth for it, and returning non-2xx would just make Svix redeliver forever
 * against a state that will never change. So the org is repaired instead of blocked:
 * promote the longest-tenured remaining member.
 *
 * Longest-tenured, not highest-ranked, on purpose — an `approver` is not automatically
 * the right person to run the org, and seniority in the org is the only signal available
 * here that is not a guess about the company's internal structure. Admins are told either
 * way, because a promotion nobody asked for is something a human needs to review.
 */
export async function backfillOrgAdminIfHeadless(
  adminClient: AdminClient,
  sponsorId: string
): Promise<{ promoted: string | null; headless: boolean }> {
  try {
    const { count: adminCount } = await adminClient
      .from('sponsor_members')
      .select('id', { count: 'exact', head: true })
      .eq('sponsor_id', sponsorId)
      .eq('role', 'org_admin')

    if ((adminCount ?? 0) > 0) return { promoted: null, headless: false }

    const { data: candidates } = await adminClient
      .from('sponsor_members')
      .select('id, profile_id, role, created_at')
      .eq('sponsor_id', sponsorId)
      .order('created_at', { ascending: true })
      .limit(1)

    const heir = (candidates ?? [])[0] as
      | { id: string; profile_id: string; role: string }
      | undefined

    if (!heir) {
      // Nobody left at all. A-01-01's webhook branch handles deactivating an org with no
      // members; this reports the state so the caller can act and so the audit trail
      // records that the org went headless rather than merely admin-less.
      await writeAudit(adminClient, {
        actor_id: null,
        action: 'sponsor_org_left_without_members',
        entity_type: 'sponsors',
        entity_id: sponsorId,
        metadata: { reason: 'last member removed' },
      })
      return { promoted: null, headless: true }
    }

    const { error } = await adminClient
      .from('sponsor_members')
      .update({ role: 'org_admin' })
      .eq('id', heir.id)

    if (error) {
      console.error('[offboarding] failed to promote heir', sponsorId, error)
      Sentry.captureException(new Error(`[offboarding] promote failed: ${error.message}`))
      return { promoted: null, headless: true }
    }

    await writeAudit(adminClient, {
      actor_id: null,
      action: 'sponsor_org_admin_backfilled',
      entity_type: 'sponsor_members',
      entity_id: heir.id,
      metadata: { sponsor_id: sponsorId, promoted_profile_id: heir.profile_id, previous_role: heir.role },
    })

    await createInAppNotification({
      recipientId: heir.profile_id,
      type: 'general',
      title: 'You are now an organization admin',
      body:
        'Your organization was left without an admin when its last admin was removed, so you have been ' +
        'promoted automatically as the longest-standing member. You can now invite teammates and change ' +
        'organization settings. Contact support if this should be someone else.',
    })

    return { promoted: heir.profile_id, headless: false }
  } catch (e) {
    console.error('[offboarding] backfillOrgAdminIfHeadless threw', e)
    Sentry.captureException(e)
    return { promoted: null, headless: true }
  }
}
