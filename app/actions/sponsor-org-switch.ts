'use server'

import { z } from 'zod'
import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { requireSponsor } from '@/lib/actions-utils'
import { ACTIVE_SPONSOR_COOKIE, ACTIVE_SPONSOR_COOKIE_OPTIONS } from '@/lib/active-sponsor-org'
import { writeAudit } from '@/lib/audit'

const switchSchema = z.object({ sponsorId: z.string().uuid() })

/**
 * A-12-01. Switch which sponsor organisation the caller is acting as.
 *
 * The membership check here is not decoration and must not be removed as "redundant"
 * because `resolveActiveSponsorId` validates on read. Two independent reasons:
 *
 *  1. It is what turns a bad request into a refusal the user can see, instead of a silent
 *     fallback that looks like the switch just did not work.
 *  2. It writes an audit row when someone tries to select an org they do not belong to.
 *     A cookie set by hand is the cheapest possible probe for "which org ids exist", and
 *     the read-side fallback is deliberately silent — so if nobody records the attempt
 *     here, nothing in the system ever does.
 *
 * The authorization itself still lives on the read side. This action cannot grant access;
 * at worst it stores a preference that `resolveActiveSponsorId` will ignore.
 */
export async function switchActiveSponsorOrg(data: z.input<typeof switchSchema>) {
  // 1. VALIDATE
  const parsed = switchSchema.safeParse(data)
  if (!parsed.success) {
    return { error: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', ') }
  }

  // 2. AUTH
  let user, sponsorIds, adminClient
  try {
    ;({ user, sponsorIds, adminClient } = await requireSponsor())
  } catch (e: any) {
    return { error: e.message }
  }

  // 3. MEMBERSHIP
  if (!sponsorIds.includes(parsed.data.sponsorId)) {
    await writeAudit(adminClient, {
      actor_id: user.id,
      action: 'sponsor_org_switch_rejected',
      entity_type: 'sponsors',
      entity_id: parsed.data.sponsorId,
      metadata: { attempted_sponsor_id: parsed.data.sponsorId, held_sponsor_ids: sponsorIds },
    })
    return { error: 'You do not have access to that organization.' }
  }

  const store = await cookies()
  store.set(ACTIVE_SPONSOR_COOKIE, parsed.data.sponsorId, ACTIVE_SPONSOR_COOKIE_OPTIONS)

  await writeAudit(adminClient, {
    actor_id: user.id,
    action: 'sponsor_org_switched',
    entity_type: 'sponsors',
    entity_id: parsed.data.sponsorId,
    metadata: { sponsor_id: parsed.data.sponsorId },
  })

  // Every sponsor surface is now about a different company.
  for (const path of [
    '/sponsor/dashboard',
    '/sponsor/submissions',
    '/sponsor/approvals',
    '/sponsor/impact',
    '/sponsor/inbox',
    '/sponsor/members',
    '/sponsor/activity',
    '/sponsor/settings',
  ]) {
    revalidatePath(path)
  }

  return { success: true }
}

/**
 * The orgs this person belongs to, for the switcher. Names only — no funding figures, no
 * contact details. A viewer in one org must not learn another org's budget from a dropdown.
 */
export async function listMySponsorOrgs(): Promise<
  { orgs: { id: string; company_name: string }[]; activeId: string } | { error: string }
> {
  let sponsorIds, sponsorId, adminClient
  try {
    ;({ sponsorIds, sponsorId, adminClient } = await requireSponsor())
  } catch (e: any) {
    return { error: e.message }
  }

  // Admin client because `sponsors_select` does not admit a sponsor reading sibling rows,
  // and the projection is two columns rather than a policy change.
  const { data } = await adminClient
    .from('sponsors')
    .select('id, company_name')
    .in('id', sponsorIds)
    .order('company_name')

  return { orgs: (data ?? []) as { id: string; company_name: string }[], activeId: sponsorId }
}
