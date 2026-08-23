import 'server-only'
import * as Sentry from '@sentry/nextjs'

/**
 * Write one `audit_log` row, and make a failure visible (A-03-05).
 *
 * Every one of the ~88 audit writes in `app/actions/*` was
 * `await adminClient.from('audit_log').insert({ … })` with the returned `{ error }`
 * discarded. So an audit insert could fail — RLS change, constraint violation, a column
 * renamed out from under a metadata key, the database briefly refusing writes — and the
 * action would still return `{ success: true }`. The mutation happened; the record that
 * it happened did not; nothing anywhere said so.
 *
 * That matters more here than in most codebases: `audit_log` is what
 * `/api/admin/export` dumps for compliance, and it is the only account of who revealed an
 * EIN, who approved a sponsorship, and who deleted an account.
 *
 * **This does not throw.** A failed audit write must not roll back or fail a mutation that
 * has already committed — that would turn a bookkeeping problem into a money problem, and
 * callers would start wrapping audit writes in try/catch that swallow even more. It
 * reports loudly and returns whether it succeeded, so a caller that genuinely must refuse
 * to proceed without an audit trail can check.
 *
 * console.error as well as Sentry: Sentry has no DSN in any Vercel environment today, so a
 * Sentry-only report is a no-op — which is precisely how this class of failure stayed
 * invisible in the first place.
 */
export async function writeAudit(
  // Deliberately structural rather than SupabaseClient<Database>: call sites pass the
  // admin client, `createAdminClient()` inline, and a few `as any`-cast clients, and this
  // helper must accept all of them without forcing a cast at 88 call sites.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // PromiseLike, not Promise: PostgrestFilterBuilder is a thenable that only becomes a
  // real Promise when awaited, so demanding Promise here rejects every real client.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: { from: (table: any) => { insert: (row: any) => PromiseLike<{ error: any }> } },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  row: Record<string, any>
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await client.from('audit_log').insert(row)
    if (error) {
      const message = `[audit] failed to write audit_log row for action "${row?.action ?? 'unknown'}": ${error.message ?? error}`
      console.error(message, { entity_type: row?.entity_type, entity_id: row?.entity_id, error })
      Sentry.captureException(new Error(message))
      return { ok: false, error: error.message ?? String(error) }
    }
    return { ok: true }
  } catch (e) {
    const message = `[audit] threw while writing audit_log row for action "${row?.action ?? 'unknown'}"`
    console.error(message, e)
    Sentry.captureException(e)
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
