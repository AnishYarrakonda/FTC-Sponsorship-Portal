'use server'

import { z } from 'zod'
import { requireSponsorRole } from '@/lib/actions-utils'
import { mapDbError } from '@/lib/errors'

/**
 * A-12-05. Read-only, self-serve activity log for a sponsor organisation.
 *
 * Everything that decides WHAT is visible lives in the database, in
 * `sponsor_audit_log()` (migration 0109): the org scoping via `current_sponsor_ids()`, the
 * action allowlist, the metadata allowlist, and the rule that an actor is named only when
 * they belong to one of the caller's own orgs. This action does not filter, project or
 * redact anything — if it did, the guarantee would depend on two places agreeing.
 *
 * Called through the SERVER client, not the admin client, on purpose. The function is
 * SECURITY DEFINER and derives its entire scope from the caller's JWT, so it must run as
 * the caller. Routing it through the admin client would make `current_profile_id()` NULL
 * and the guard would (correctly) refuse — but the reason it must not be "fixed" by
 * passing an id is that a caller-supplied id is exactly the shape A-02-02 exploited.
 */

const listSchema = z.object({
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional(),
})

export interface SponsorAuditEntry {
  id: string
  created_at: string
  action: string
  actor_label: string
  amount_cents: number | null
  entity_type: string | null
  entity_id: string | null
}

export async function listSponsorAuditLog(
  data: z.input<typeof listSchema> = {}
): Promise<{ entries: SponsorAuditEntry[] } | { error: string }> {
  // 1. VALIDATE
  const parsed = listSchema.safeParse(data)
  if (!parsed.success) {
    return { error: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', ') }
  }

  // 2. AUTH / ROLE. The rank is ALSO checked in SQL; this is the UX-facing half so the
  //    page can render a clear message instead of a raised exception.
  let supabase
  try {
    ;({ supabase } = await requireSponsorRole('org_admin'))
  } catch (e: any) {
    return { error: e.message }
  }

  // 3. READ
  const { data: rows, error } = await supabase.rpc('sponsor_audit_log', {
    p_limit: parsed.data.limit ?? 100,
    p_offset: parsed.data.offset ?? 0,
  })

  if (error) return { error: mapDbError(error, 'listSponsorAuditLog.rpc') }

  return { entries: (rows ?? []) as unknown as SponsorAuditEntry[] }
}
