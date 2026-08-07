/**
 * Budget-line mapping for the sponsor pitch email.
 *
 * Lives in its own module, not in lib/dispatch.ts, because that module constructs the
 * Resend client at import time (`new Resend(env.RESEND_API_KEY)`) — importing it from a
 * unit test throws "Missing API key". A pure function should not be reachable only
 * through an SDK constructor.
 */

/** Shape actually stored in teams.budget_items by app/actions/team.ts:17-26. */
type StoredBudgetItem = { label?: string; qty?: number; unit_cost_cents?: number; total_cents?: number }

/**
 * Translate stored snake_case budget rows into the camelCase shape SubmissionEmail
 * renders. Exported for the unit test — this bug is invisible to `tsc` because the
 * previous code used a type assertion, so a test is the only regression net.
 */
export function mapBudgetItems(
  raw: unknown
): { label: string; qty: number; unitCostCents: number; totalCents: number }[] {
  if (!Array.isArray(raw)) return []
  return (raw as StoredBudgetItem[]).map((i) => ({
    label: i?.label ?? '',
    qty: Number(i?.qty ?? 0),
    unitCostCents: Number(i?.unit_cost_cents ?? 0),
    totalCents: Number(i?.total_cents ?? 0),
  }))
}
