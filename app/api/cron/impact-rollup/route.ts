import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import crypto from 'crypto'
import { env } from '@/lib/env'
import * as Sentry from '@sentry/nextjs'
import type { CronJobResult } from '@/lib/cron/authorize'
import {
  buildPlatformImpactPayload,
  buildSponsorImpactPayload,
  IMPACT_PAYLOAD_SCHEMA_VERSION,
} from '@/lib/impact-report/build'
import { findForbiddenKeys } from '@/lib/impact-report/projection'
import { writeAudit } from '@/lib/audit'

/**
 * Vercel cron: 04:00 UTC daily (configured in vercel.json), two hours after the expiry
 * sweep so the fulfillment states it reads have settled.
 *
 * One route doing two jobs, because cron slots are a budgeted resource on this project's
 * plan:
 *   - every run: refresh public_platform_stats, then regenerate every OPEN snapshot for
 *     the current year plus the platform snapshot for it;
 *   - on 2 January: regenerate the prior year one final time, then close it.
 *
 * The auth block below is copied verbatim from app/api/cron/expire-submissions/route.ts.
 * It is timing-attack-hardened and easy to weaken by paraphrasing — do not rewrite it.
 */
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const token = authHeader.split(' ')[1]
  const expectedToken = env.CRON_SECRET

  try {
    if (
      !expectedToken ||
      token.length !== expectedToken.length ||
      !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expectedToken))
    ) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await runImpactRollup()
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}

/**
 * The job itself, callable without an HTTP request so the consolidated daily-maintenance
 * dispatcher can run it too. Vercel Hobby honours only 2 cron entries, and this job is
 * one of the three sharing the second slot. Behaviour is unchanged from when this was
 * inline in GET.
 */
export async function runImpactRollup(): Promise<CronJobResult> {
  const supabase = createAdminClient()
  const now = new Date()
  const currentYear = now.getUTCFullYear()
  const isYearEnd = now.getUTCMonth() === 0 && now.getUTCDate() === 2

  let sponsorsGenerated = 0
  let platformGenerated = 0
  let priorYearClosed = 0
  const failures: string[] = []

  /** actor_id is null: the cron has no human actor, and the RPC's trusted-server branch
   *  accepts that rather than borrowing some admin's identity for an automated write. */
  const upsert = async (
    scope: 'sponsor' | 'platform',
    sponsorId: string | null,
    year: number,
    payload: unknown
  ): Promise<boolean> => {
    const leaked = findForbiddenKeys(payload)
    if (leaked.length > 0) {
      // Never store a payload that got past the projection. Loud, and skipped.
      const message = `[impact-rollup] forbidden keys in ${scope} payload: ${leaked.join(', ')}`
      console.error(message)
      Sentry.captureException(new Error(message), { extra: { scope, sponsorId, year } })
      failures.push(`${scope}:${sponsorId ?? 'platform'}`)
      return false
    }

    const { data, error } = await (supabase as any).rpc('upsert_impact_snapshot', {
      p_actor_profile_id: null,
      p_scope: scope,
      p_sponsor_id: sponsorId,
      p_report_year: year,
      p_payload: payload,
      p_schema_version: IMPACT_PAYLOAD_SCHEMA_VERSION,
    })

    if (error || !data || data.ok !== true) {
      // year_closed is the expected, correct outcome for a closed year — not a failure.
      if (data?.error !== 'year_closed') {
        failures.push(`${scope}:${sponsorId ?? 'platform'}:${error?.message ?? data?.error}`)
      }
      return false
    }
    return true
  }

  try {
    await (supabase as any).rpc('refresh_public_platform_stats')

    const regenerateYear = async (year: number) => {
      // Every sponsor with at least one non-cancelled commitment in the year.
      const { data: rows } = await supabase
        .from('funding_fulfillments')
        .select('sponsor_id')
        .neq('status', 'cancelled')
        .gte('pledged_at', `${year}-01-01T00:00:00.000Z`)
        .lt('pledged_at', `${year + 1}-01-01T00:00:00.000Z`)

      const sponsorIds = Array.from(
        new Set((rows ?? []).map((r) => r.sponsor_id as string).filter(Boolean))
      )

      for (const sponsorId of sponsorIds) {
        const payload = await buildSponsorImpactPayload(supabase, sponsorId, year)
        if (await upsert('sponsor', sponsorId, year, payload)) sponsorsGenerated += 1
      }

      const platform = await buildPlatformImpactPayload(supabase, year)
      if (await upsert('platform', null, year, platform)) platformGenerated += 1
    }

    await regenerateYear(currentYear)

    if (isYearEnd) {
      const priorYear = currentYear - 1
      await regenerateYear(priorYear)
      const { data: closed } = await (supabase as any).rpc('close_impact_report_year', {
        p_actor_profile_id: null,
        p_year: priorYear,
      })
      priorYearClosed = (closed?.closed as number) ?? 0
    }
  } catch (e) {
    console.error('[impact-rollup] failed', e)
    Sentry.captureException(e instanceof Error ? e : new Error('[impact-rollup] failed'))
    failures.push(String(e))
  }

  // Vercel Hobby retains about an hour of logs, so without this row "did it run?" is
  // unanswerable — the same reasoning the expiry sweep records.
  await writeAudit(supabase, {
    actor_id: null,
    action: 'cron_impact_rollup',
    entity_type: 'impact_report_snapshots',
    entity_id: null,
    metadata: {
      year: currentYear,
      year_end_close: isYearEnd,
      sponsors_generated: sponsorsGenerated,
      platform_generated: platformGenerated,
      prior_year_closed: priorYearClosed,
      failures,
    },
  })

  return {
    ok: failures.length === 0,
    year: currentYear,
    sponsorsGenerated,
    platformGenerated,
    priorYearClosed,
    failures,
  }
}
