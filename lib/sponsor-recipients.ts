import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'

type AdminClient = SupabaseClient<Database>

/**
 * Every profile that can act for a sponsor company: the legacy `profiles.sponsor_id`
 * holders UNIONed with `sponsor_members` (0082).
 *
 * Sponsor identity moved off the single `profiles.sponsor_id` column in 0082 — that column
 * is only ever stamped on the ORIGINAL account holder, so an invited teammate has it NULL
 * forever. A profiles-only read therefore notifies NOBODY for a sponsor whose seats were all
 * filled by invitation, and it fails silently: an empty recipient list looks exactly like a
 * successful send.
 *
 * This is the notification-side twin of `sponsor_ids_for_profile()` / `current_sponsor_ids()`
 * on the RLS side. The same omission in SQL is what migration 0094 had to fix. It lives here,
 * rather than being copied a fourth time, because three separate hand-rolled copies is how
 * the fourth one gets it wrong.
 */
export async function sponsorRecipientIds(
  adminClient: AdminClient,
  sponsorId: string
): Promise<string[]> {
  const [legacy, members] = await Promise.all([
    adminClient.from('profiles').select('id').eq('role', 'sponsor').eq('sponsor_id', sponsorId),
    adminClient.from('sponsor_members').select('profile_id').eq('sponsor_id', sponsorId),
  ])

  const ids = new Set<string>()
  for (const r of legacy.data ?? []) ids.add(r.id as string)
  for (const r of members.data ?? []) ids.add(r.profile_id as string)
  return Array.from(ids)
}

/**
 * The same set as `sponsorRecipientIds`, but carrying the fields an EMAIL needs.
 *
 * A-05-01: the fulfillment-nudge cron hand-rolled `profiles WHERE role='sponsor' AND
 * sponsor_id = …` because it needed `email` and `full_name`, which the ids-only helper
 * above does not return. That hand-roll is the exact omission this module exists to
 * prevent — an org whose seats were all filled by invitation got no nudges at all, and an
 * empty recipient list is indistinguishable from a successful send.
 *
 * Legacy owners and members are unioned by profile id, so someone who is both is
 * returned once.
 */
export async function sponsorRecipientProfiles(
  adminClient: AdminClient,
  sponsorId: string
): Promise<{ id: string; email: string | null; full_name: string | null }[]> {
  const ids = await sponsorRecipientIds(adminClient, sponsorId)
  if (ids.length === 0) return []

  const { data } = await adminClient
    .from('profiles')
    .select('id, email, full_name')
    .in('id', ids)

  return (data ?? []) as { id: string; email: string | null; full_name: string | null }[]
}

/**
 * Legacy owners of a sponsor org who hold NO `sponsor_members` row.
 *
 * A-05-03: `notifyEligibleApprovers` filtered strictly on member rank, and only fell back
 * to the legacy owner when the org had zero member rows at all. So the moment ONE person
 * was invited — even a viewer — the original account holder stopped receiving every
 * proposal notification, while still being the person with full authority over the org.
 *
 * `LEGACY_MEMBER_ROLE` is `org_admin`, and `requireSponsorRole` already resolves an owner
 * that way (`membership?.role ?? LEGACY_MEMBER_ROLE`). The "no member row" condition
 * matters: when an owner DOES have a member row, that row is their effective rank and it
 * must win here too, or a deliberate demotion would be silently ignored.
 */
export async function legacyOwnerIdsWithoutMembership(
  adminClient: AdminClient,
  sponsorId: string
): Promise<string[]> {
  const [legacy, members] = await Promise.all([
    adminClient.from('profiles').select('id').eq('role', 'sponsor').eq('sponsor_id', sponsorId),
    adminClient.from('sponsor_members').select('profile_id').eq('sponsor_id', sponsorId),
  ])

  const withMembership = new Set((members.data ?? []).map((r) => r.profile_id as string))
  return (legacy.data ?? [])
    .map((r) => r.id as string)
    .filter((id) => !withMembership.has(id))
}
