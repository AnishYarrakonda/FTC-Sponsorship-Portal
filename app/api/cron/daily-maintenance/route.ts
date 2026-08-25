import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAuthorizedCronRequest, type CronJobResult } from '@/lib/cron/authorize'
import { runRefreshFtcRoster } from '../refresh-ftc-roster/route'
import { runImpactRollup } from '../impact-rollup/route'

/**
 * Consolidated daily cron — audit finding A-09-05.
 *
 * vercel.json declared four cron entries. Vercel Hobby honours TWO; the rest are silently
 * ignored, so three of the four jobs had never run in production. expire-submissions keeps
 * its own 02:00 slot (it releases sponsor capacity and sweeps gov-ID/W-9 retention, so it
 * must not share a budget with anything). The remaining three run here at 04:00.
 *
 * Each job is awaited inside its own try/catch: one failure must not swallow the two
 * behind it, which is exactly what a single un-guarded chain would do. Order is
 * deliberate: impact-rollup aggregates transactions_ledger, so it runs two hours after the
 * 02:00 expiry sweep has settled and after the roster refresh it does not depend on.
 * (The nudge-fulfillments job was removed with the fulfillment layer in 0111.)
 *
 * The individual routes remain live and independently invocable — this only changes what
 * the SCHEDULER calls. On Vercel Pro these can be split back into four entries and this
 * route retired; see .claude/rules/workflows.md.
 *
 * Runtime note: three jobs in one invocation take longer than any one of them did alone,
 * hence the explicit maxDuration. The audit assumed a 10s ceiling; Vercel's default
 * function timeout is now 300s across plans, so 60s is a deliberate cap rather than a
 * platform limit — it fails loudly instead of burning budget if a job starts hanging.
 * If this legitimately needs more, the answer is Vercel Pro plus four separate cron
 * entries, NOT trimming work out of the jobs.
 */
export const maxDuration = 60

type JobOutcome = { job: string; ok: boolean; result?: CronJobResult; error?: string }

async function runJob(job: string, fn: () => Promise<CronJobResult>): Promise<JobOutcome> {
  try {
    const result = await fn()
    if (!result.ok) {
      console.error(`[cron] daily-maintenance: ${job} reported failure`, result)
      Sentry.captureMessage(`daily-maintenance: ${job} reported failure`, {
        level: 'error',
        extra: { result },
      })
    }
    return { job, ok: result.ok, result }
  } catch (err) {
    // A throw here must not prevent the remaining jobs from running.
    console.error(`[cron] daily-maintenance: ${job} threw`, err)
    Sentry.captureException(err, { extra: { job } })
    return { job, ok: false, error: err instanceof Error ? err.message : 'unknown error' }
  }
}

export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const outcomes: JobOutcome[] = []
  outcomes.push(await runJob('refresh-ftc-roster', runRefreshFtcRoster))
  outcomes.push(await runJob('impact-rollup', runImpactRollup))

  const failed = outcomes.filter((o) => !o.ok).map((o) => o.job)

  // One durable audit row for the sweep. Each job also writes its own.
  const supabase = createAdminClient()
  const { error: auditError } = await supabase.from('audit_log').insert({
    actor_id: null,
    action: 'cron_daily_maintenance',
    entity_type: 'cron',
    entity_id: null,
    metadata: { outcomes: outcomes.map((o) => ({ job: o.job, ok: o.ok })), failed },
  })
  if (auditError) {
    console.error('[cron] daily-maintenance failed to write audit row', auditError)
    Sentry.captureException(auditError)
  }

  // 200 even on partial failure: the jobs that succeeded did real work, and the failures
  // are already in Sentry and the audit row. A 500 would tell Vercel to retry all three.
  return NextResponse.json({ ok: failed.length === 0, failed, outcomes })
}
