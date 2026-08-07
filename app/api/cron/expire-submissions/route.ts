import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createInAppNotification } from '@/lib/notify'
import crypto from 'crypto'
import { env } from '@/lib/env'
import * as Sentry from '@sentry/nextjs'

// Vercel cron: runs daily at 02:00 UTC (configure in vercel.json)
// Flips approved submissions whose sponsor has not responded within 14 days → 'expired'.
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  
  const token = authHeader.split(' ')[1]
  const expectedToken = env.CRON_SECRET

  // Prevent timing attacks and empty expectedToken comparison
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

  const supabase = createAdminClient()

  try {
    // Expire only the awaiting-sponsor states (dispatched/delivered/opened) and release
    // each reservation back to the sponsor's cap. Funded ('approved') rows are never
    // touched — the release RPC is guarded to live states only. (Fixes C-2.)
    // Capture who is about to be expired BEFORE the RPC runs — afterwards the rows no
    // longer match the awaiting-sponsor filter and there is no way to find them again.
    // Nobody was ever told their request lapsed: the cron released the money in silence.
    const { data: expiring } = await supabase
      .from('submissions')
      .select('id, sponsor_id, reserved_amount_cents, teams:team_id(owner_id, team_name), sponsors:sponsor_id(company_name)')
      .in('status', ['dispatched', 'delivered', 'opened'])
      .not('expires_at', 'is', null)
      .lt('expires_at', new Date().toISOString())

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: expireResult, error } = await (supabase as any).rpc('expire_overdue_submissions')

    if (error) {
      console.error('[cron] expire-submissions error', error)
      Sentry.captureException(error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const expiredCount = (expireResult as { expired?: number } | null)?.expired ?? 0

    // Clean up long-expired access tokens (30-day grace).
    const { error: cleanupError } = await supabase
      .from('submission_access_tokens')
      .delete()
      .lt('expires_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())

    if (cleanupError) {
      console.error('[cron] cleanup-tokens error', cleanupError)
      Sentry.captureException(cleanupError)
    }

    // Tell the humans. Coach first — they are the one waiting on an answer.
    for (const row of expiring ?? []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const team = row.teams as any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sponsorName = (row.sponsors as any)?.company_name ?? 'the sponsor'
      try {
        if (team?.owner_id) {
          await createInAppNotification({
            recipientId: team.owner_id,
            type: 'general',
            title: `Your pitch to ${sponsorName} expired`,
            body:
              `${sponsorName} did not respond within the 14-day window, so the request has closed and ` +
              `their reserved funding has been released. You can send them a new pitch from your dashboard.`,
            submissionId: row.id,
          })
        }
      } catch (notifyError) {
        // A notification failure must never abort the expiry sweep.
        console.error('[cron] failed to notify coach of expiry', row.id, notifyError)
        Sentry.captureException(notifyError)
      }
    }

    // A durable record that this ran. Previously the ONLY success signal was the
    // console.log below, and Vercel Hobby retains about an hour of logs — so "did the
    // cron run last night?" was literally unanswerable, and a nightly 500 would have
    // gone unnoticed while reservations silently piled up.
    const { error: auditError } = await supabase.from('audit_log').insert({
      actor_id: null,
      action: 'cron_expire_submissions',
      entity_type: 'submissions',
      entity_id: null,
      metadata: { expired: expiredCount, ids: (expiring ?? []).map((r) => r.id) },
    })
    if (auditError) {
      console.error('[cron] failed to write audit row', auditError)
      Sentry.captureException(auditError)
    }

    console.log(`[cron] Expired ${expiredCount} submissions`)
    return NextResponse.json({ expired: expiredCount })
  } catch (err) {
    console.error('[cron] unhandled error', err)
    Sentry.captureException(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
