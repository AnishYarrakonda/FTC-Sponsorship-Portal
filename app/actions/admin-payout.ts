'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/actions-utils'
import { env } from '@/lib/env'
export type ActionResponse<T = void> = { ok?: boolean, error?: string, data?: T, message?: string }

const actionError = (error: string): ActionResponse<any> => ({ error })
const actionSuccess = <T>(data?: T, message?: string): ActionResponse<T> => ({ ok: true, data, message })
import * as Sentry from '@sentry/nextjs'

export async function getPayoutEinAction(
  teamId: string,
  target: 'payee' | 'fiscal_sponsor'
): Promise<{ ein?: string; error?: string }> {
  try {
    const { user: profile } = await requireAdmin()
    if (!profile) return { error: 'Unauthorized' }

    const admin = await createAdminClient()
    const { data, error } = await admin.rpc('get_payout_ein' as any, {
      p_team_id: teamId,
      p_key: env.PAYOUT_ENCRYPTION_KEY,
      p_target: target,
    })

    if (error) {
      console.error('[payout] get_payout_ein error', error)
      Sentry.captureException(error)
      return { error: 'Failed to retrieve EIN.' }
    }

    // Audit the reveal
    await admin.from('audit_log').insert({
      actor_id: profile.id,
      action: 'reveal_payout_ein',
      entity_type: 'teams',
      entity_id: teamId,
      metadata: { target },
    })

    return { ein: data as string }
  } catch (err) {
    console.error('[payout] getPayoutEinAction unhandled', err)
    Sentry.captureException(err)
    return { error: 'Internal error' }
  }
}
