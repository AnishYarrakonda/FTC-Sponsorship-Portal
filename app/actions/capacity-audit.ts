'use server'

import { requireAdmin } from '@/lib/actions-utils'
import { mapDbError } from '@/lib/errors'

export type CapacityDriftRow = {
  sponsor_id: string
  company_name: string
  funding_cap_cents: number
  funding_used_cents: number
  open_reservations_cents: number
  settled_ledger_cents: number
  expected_used_cents: number
  drift_cents: number
}

/**
 * Runs `detect_capacity_drift()` (0084) and returns every sponsor whose row violates the
 * capacity invariant:
 *
 *   funding_used_cents = SUM(open reservations) + SUM(transactions_ledger.amount_cents)
 *
 * Zero rows is the healthy answer.
 *
 * requireAdmin(), not requireSuperAdmin(): a reviewer may LOOK. This action changes
 * nothing — it reports, and a human decides. Auto-repairing drift would erase the
 * evidence of whatever caused it.
 *
 * No notification step: this is a read.
 */
export async function runCapacityAudit(): Promise<
  { rows: CapacityDriftRow[]; sponsorCount: number } | { error: string }
> {
  let user, adminClient
  try {
    const auth = await requireAdmin()
    user = auth.user
    adminClient = auth.adminClient
  } catch (e: any) {
    return { error: e.message }
  }

  // The RPC is service_role-only, so it must go through the admin client.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (adminClient as any).rpc('detect_capacity_drift')
  if (error) return { error: mapDbError(error, 'runCapacityAudit.rpc') }

  const rows = (data ?? []) as CapacityDriftRow[]

  const { count: sponsorCount } = await adminClient
    .from('sponsors')
    .select('id', { count: 'exact', head: true })

  await adminClient.from('audit_log').insert({
    actor_id: user.id,
    action: 'capacity_audit_run',
    entity_type: 'sponsors',
    entity_id: null,
    metadata: { drift_count: rows.length, sponsor_ids: rows.map((r) => r.sponsor_id) },
  })

  return { rows, sponsorCount: sponsorCount ?? 0 }
}
