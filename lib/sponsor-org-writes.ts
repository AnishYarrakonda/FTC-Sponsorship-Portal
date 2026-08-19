import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'

/**
 * The ONLY `sponsors` columns a sponsor org admin may ever change on their own row.
 *
 * `sponsors` has no column-level write guard in the database (there is no equivalent of
 * `guard_submission_writable_columns`), and one cannot usefully be added: RLS already
 * restricts UPDATE on `sponsors` to `is_super_admin()`, so the org-admin path necessarily
 * runs through the admin client -- which bypasses RLS -- and any trigger would have to
 * exempt the same service-role context that every server action shares.
 *
 * That left a hand-written object literal in updateOrgApprovalSettings as the only thing
 * standing between a sponsor org admin and `funding_cap_cents`. This module replaces that
 * literal with a list, enforced twice:
 *
 *   - at COMPILE time, because the patch type is keyed off this tuple; and
 *   - at RUN time, because the payload is filtered against it before it reaches PostgREST.
 *
 * Widening what an org admin can write now takes an edit to THIS line, in a file whose
 * whole purpose is that decision -- not an extra key quietly added to an object literal.
 */
export const ORG_ADMIN_WRITABLE_SPONSOR_COLUMNS = ['approval_required_above_cents'] as const

export type OrgAdminWritableSponsorColumn = (typeof ORG_ADMIN_WRITABLE_SPONSOR_COLUMNS)[number]

export type OrgAdminSponsorPatch = Partial<
  Pick<Database['public']['Tables']['sponsors']['Update'], OrgAdminWritableSponsorColumn>
>

/**
 * Update a sponsor row on behalf of an ORG ADMIN. Never use this for admin/super-admin
 * provisioning -- those legitimately write funding caps and status, and should keep using
 * the admin client directly so the privileged write stays visible at its call site.
 */
export async function updateSponsorAsOrgAdmin(
  adminClient: SupabaseClient<Database>,
  sponsorId: string,
  patch: OrgAdminSponsorPatch
) {
  const allowed = ORG_ADMIN_WRITABLE_SPONSOR_COLUMNS as readonly string[]
  const safe = Object.fromEntries(
    Object.entries(patch).filter(([column]) => allowed.includes(column))
  ) as OrgAdminSponsorPatch

  if (Object.keys(safe).length === 0) {
    return { error: { message: 'No writable fields supplied.' } }
  }

  // The raw PostgrestError is returned unchanged so the caller's mapDbError() keeps the
  // `code` it needs for Sentry; callers must not surface `message` to the user directly.
  const { error } = await adminClient.from('sponsors').update(safe).eq('id', sponsorId)
  return { error }
}
