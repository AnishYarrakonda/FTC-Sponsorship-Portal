'use server'

import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/actions-utils'
import { env } from '@/lib/env'
export type ActionResponse<T = void> = { ok?: boolean, error?: string, data?: T, message?: string }

const actionError = (error: string): ActionResponse<any> => ({ error })
const actionSuccess = <T>(data?: T, message?: string): ActionResponse<T> => ({ ok: true, data, message })
import * as Sentry from '@sentry/nextjs'
import { writeAudit } from '@/lib/audit'

/**
 * A-03-01. This action had no step 1 at all — `teamId` went from the client straight into
 * an RPC argument. It is also the single most sensitive read in the app: it decrypts and
 * returns a full plaintext EIN, the exact value A-06-01 removed from stored receipts
 * precisely so it would live in one deliberate, audited place. That place is this action,
 * which makes validating its input the whole point rather than a formality.
 */
const getPayoutEinSchema = z.object({
  teamId: z.string().uuid(),
  target: z.enum(['payee', 'fiscal_sponsor']),
})

export async function getPayoutEinAction(
  teamId: string,
  target: 'payee' | 'fiscal_sponsor'
): Promise<{ ein?: string; error?: string }> {
  // 1. VALIDATE
  const parsed = getPayoutEinSchema.safeParse({ teamId, target })
  if (!parsed.success) {
    return { error: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', ') }
  }

  try {
    // 2. AUTH / ROLE
    const { user: profile } = await requireAdmin()
    if (!profile) return { error: 'Unauthorized' }

    const admin = await createAdminClient()
    const { data, error } = await admin.rpc('get_payout_ein' as any, {
      p_team_id: parsed.data.teamId,
      p_key: env.PAYOUT_ENCRYPTION_KEY,
      p_target: parsed.data.target,
    })

    if (error) {
      console.error('[payout] get_payout_ein error', error)
      Sentry.captureException(error)
      return { error: 'Failed to retrieve EIN.' }
    }

    // Audit the reveal
    await writeAudit(admin, {
      actor_id: profile.id,
      action: 'reveal_payout_ein',
      entity_type: 'teams',
      entity_id: parsed.data.teamId,
      metadata: { target: parsed.data.target },
    })

    return { ein: data as string }
  } catch (err) {
    console.error('[payout] getPayoutEinAction unhandled', err)
    Sentry.captureException(err)
    return { error: 'Internal error' }
  }
}
