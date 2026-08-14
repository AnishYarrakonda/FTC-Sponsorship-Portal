import type { createAdminClient } from '@/lib/supabase/admin'
import * as Sentry from '@sentry/nextjs'

/**
 * Postgres-backed throttle (see 0055_coach_denial_and_throttle.sql). Callable
 * only via the admin client (EXECUTE is restricted to service_role). Returns
 * true when the caller is within the limit. Fails OPEN (with a Sentry report)
 * so a throttle outage never takes a public surface down.
 *
 * This lives here rather than in app/actions/sponsor.ts (its original home) because a
 * `'use server'` module may only export async server actions — so a shared helper is
 * unreachable from there. Behaviour is unchanged apart from the parameterised log context.
 */
export async function checkThrottle(
  adminClient: ReturnType<typeof createAdminClient>,
  key: string,
  limit: number,
  window: string,
  context = 'throttle'
): Promise<boolean> {
  try {
    const { data, error } = await adminClient.rpc('check_throttle', {
      p_key: key,
      p_limit: limit,
      p_window: window,
    })
    if (error) {
      console.error(`[${context}] check_throttle failed`, error)
      Sentry.captureException(new Error(`[${context}] check_throttle failed: ${error.message}`), {
        extra: { key, limit, window },
      })
      return true
    }
    return data !== false
  } catch (err) {
    console.error(`[${context}] check_throttle threw`, err)
    Sentry.captureException(err)
    return true
  }
}
