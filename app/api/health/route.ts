import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { env } from '@/lib/env'
import crypto from 'crypto'

function isAuthorizedDeepProbe(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return false
  const token = authHeader.slice('Bearer '.length)
  const expectedToken = env.CRON_SECRET
  if (!expectedToken || token.length !== expectedToken.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expectedToken))
  } catch {
    return false
  }
}

/**
 * A11-03. The public branch used to return `{ ok: true }` unconditionally, so an external
 * uptime monitor reported 100% availability with Supabase paused, the service-role key
 * rotated, or RLS broken — the outages an uptime monitor exists to catch. The deep probe
 * that DID check the database was gated behind CRON_SECRET, which no third-party monitor
 * has, so in practice nothing checked.
 *
 * The public check now tells the truth, without becoming an amplifier: a bot hitting this
 * route 10,000 times must not turn into 10,000 unauthenticated Postgres queries (the same
 * risk A-10-05 raises about the token view). The result is cached in module scope, so a
 * flood costs one query per instance per window. Fluid Compute reuses instances, so the
 * cache is worth having; a cold instance simply does one query.
 */
const DB_CHECK_TTL_MS = 30_000
let cachedDbCheck: { ok: boolean; at: number } | null = null

async function checkDatabase(): Promise<boolean> {
  const now = Date.now()
  if (cachedDbCheck && now - cachedDbCheck.at < DB_CHECK_TTL_MS) {
    return cachedDbCheck.ok
  }

  let ok = false
  try {
    const supabase = createAdminClient()
    const { error } = await supabase.from('profiles').select('id', { head: true, count: 'exact' }).limit(1)
    ok = !error
    if (error) console.error('[health] db check failed', error)
  } catch (error) {
    console.error('[health] db check threw', error)
    ok = false
  }

  // A failure is cached too. Otherwise an outage makes every probe a fresh query against
  // a database that is already struggling.
  cachedDbCheck = { ok, at: now }
  return ok
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const deep = searchParams.get('deep') === 'db'

  if (!deep) {
    const dbOk = await checkDatabase()
    // 503, not 200: a monitor decides on the status code, and a body saying db:"error"
    // under a 200 is indistinguishable from healthy to every uptime service.
    return NextResponse.json(
      { ok: dbOk, service: 'up', db: dbOk ? 'ok' : 'error' },
      { status: dbOk ? 200 : 503 }
    )
  }

  if (!isAuthorizedDeepProbe(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()
    const { error } = await supabase.from('profiles').select('id').limit(1)
    if (error) throw error
    return NextResponse.json({ ok: true, service: 'up', db: 'ok' })
  } catch (error) {
    console.error('[health] deep probe failed', error)
    return NextResponse.json({ ok: false, service: 'up', db: 'error' }, { status: 503 })
  }
}
