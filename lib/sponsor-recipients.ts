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
