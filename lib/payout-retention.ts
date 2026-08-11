import { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './supabase/types'
import { sendW9UploadAlert } from './notify'
import * as Sentry from '@sentry/nextjs'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function purgeTeamW9(admin: any, teamId: string, path: string) {
  // 1. Delete from storage
  const { error: storageErr } = await admin.storage.from('tax-documents').remove([path])
  if (storageErr) {
    console.error(`[purge] Failed to remove ${path} from storage`, storageErr)
    Sentry.captureException(storageErr)
    // We continue. Sometimes the file is already gone, but we still need to clear the DB pointer.
  }

  // 2. Clear pointer in DB
  const { error: dbErr } = await admin
    .from('team_payout_profiles')
    .update({ 
      w9_document_path: null, 
      w9_purged_at: new Date().toISOString() 
    })
    .eq('team_id', teamId)
    
  if (dbErr) {
    console.error(`[purge] Failed to clear DB pointer for team ${teamId}`, dbErr)
    Sentry.captureException(dbErr)
    throw dbErr
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function sweepExpiringW9s(admin: any) {
  // We want to alert coaches whose W-9 will expire in 30 days or less.
  // We only alert them ONCE per cycle by setting w9_renewal_notified_at.
  const thirtyDaysFromNow = new Date()
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30)

  const { data: expiring, error: fetchErr } = await admin
    .from('team_payout_profiles')
    .select('team_id, teams!inner(team_name, owner_id), w9_expires_at')
    .lte('w9_expires_at', thirtyDaysFromNow.toISOString())
    .is('w9_renewal_notified_at', null)

  if (fetchErr) {
    console.error('[sweep] failed to fetch expiring W-9s:', fetchErr)
    return { notified: 0, failed: 0 }
  }

  let notified = 0
  let failed = 0

  if (!expiring || expiring.length === 0) return { notified, failed }

  for (const row of expiring) {
    try {
      const { data: owner } = await (admin as any)
        .from('profiles')
        .select('id, full_name, email')
        .eq('id', row.teams.owner_id)
        .single()

      if (owner && owner.email) {
        await sendW9UploadAlert(row.teams.team_name, owner.full_name || 'Coach', owner.email)
      }

      await (admin as any)
        .from('team_payout_profiles')
        .update({ w9_renewal_notified_at: new Date().toISOString() })
        .eq('team_id', row.team_id)
        
      notified++
    } catch (e) {
      console.error(`[sweep] failed to process expiring W-9 for team ${row.team_id}`, e)
      failed++
    }
  }
  
  return { notified, failed }
}
