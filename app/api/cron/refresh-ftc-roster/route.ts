import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { refreshStaleRosterEntries } from '@/lib/ftc-roster'
import crypto from 'crypto'
import { env } from '@/lib/env'
import * as Sentry from '@sentry/nextjs'
import type { CronJobResult } from '@/lib/cron/authorize'

// Vercel cron: runs nightly at 03:00 UTC (configure in vercel.json). Re-verifies the
// oldest-synced rows in ftc_teams_cache against the official FIRST Events API so a row
// cached once does not stay stale forever.
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
  } catch (e) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await runRefreshFtcRoster()
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}

/**
 * The job itself, callable without an HTTP request so the consolidated daily-maintenance
 * dispatcher can run it too. Vercel Hobby honours only 2 cron entries, and this job is
 * one of the three that share the second slot. Behaviour is unchanged from when this was
 * inline in GET.
 */
export async function runRefreshFtcRoster(): Promise<CronJobResult> {
  const supabase = createAdminClient()

  try {
    const { refreshed, failed } = await refreshStaleRosterEntries(200)

    const { error: auditError } = await supabase.from('audit_log').insert({
      actor_id: null,
      action: 'cron_refresh_ftc_roster',
      entity_type: 'ftc_teams_cache',
      entity_id: null,
      metadata: { refreshed, failed },
    })
    if (auditError) {
      console.error('[cron] refresh-ftc-roster failed to write audit row', auditError)
      Sentry.captureException(auditError)
    }

    console.log(`[cron] refresh-ftc-roster: refreshed ${refreshed}, failed ${failed}`)
    return { ok: true, refreshed, failed }
  } catch (err) {
    console.error('[cron] refresh-ftc-roster unhandled error', err)
    Sentry.captureException(err)
    return { ok: false, error: 'Internal server error' }
  }
}
