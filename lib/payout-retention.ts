import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { createInAppNotification } from './notify'
import * as Sentry from '@sentry/nextjs'

type AdminClient = SupabaseClient<Database>

/**
 * Sweep W-9s that are expiring within 60 days and have not yet been notified.
 * Sends an in-app notification to the team owner and stamps `w9_renewal_notified_at`.
 */
export async function sweepExpiringW9s(admin: AdminClient): Promise<{ notified: number; failed: number }> {
  const sixtyDaysFromNow = new Date()
  sixtyDaysFromNow.setDate(sixtyDaysFromNow.getDate() + 60)

  const { data: expiring, error: fetchErr } = await (admin as any)
    .from('team_payout_profiles')
    .select('team_id, teams!inner(team_name, owner_id), w9_expires_at')
    .not('w9_verified_at', 'is', null)
    .lt('w9_expires_at', sixtyDaysFromNow.toISOString())
    .is('w9_renewal_notified_at', null)

  if (fetchErr) {
    console.error('[sweepExpiringW9s] query failed', fetchErr)
    Sentry.captureException(fetchErr)
    return { notified: 0, failed: 0 }
  }

  let notified = 0
  let failed = 0

  for (const row of expiring ?? []) {
    const ownerId = row.teams?.owner_id
    if (!ownerId) continue

    try {
      await createInAppNotification({
        recipientId: ownerId,
        type: 'general',
        title: 'W-9 renewal required soon',
        body: `Your W-9 on file for team ${row.teams.team_name} expires within 60 days. Please upload an updated Form W-9 to avoid payout delays.`,
      })

      const { error: updateErr } = await (admin as any)
        .from('team_payout_profiles')
        .update({ w9_renewal_notified_at: new Date().toISOString() })
        .eq('team_id', row.team_id)

      if (updateErr) {
        console.error(`[sweepExpiringW9s] failed to stamp notification for team ${row.team_id}`, updateErr)
        failed++
      } else {
        notified++
      }
    } catch (e) {
      console.error(`[sweepExpiringW9s] failed to notify coach for team ${row.team_id}`, e)
      Sentry.captureException(e)
      failed++
    }
  }

  return { notified, failed }
}
