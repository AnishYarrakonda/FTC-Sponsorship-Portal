import crypto from 'crypto'
import { env } from '@/lib/env'

/**
 * Bearer-token check for Vercel cron routes.
 *
 * Lifted VERBATIM from app/api/cron/expire-submissions/route.ts, which carries the note
 * "timing-attack-hardened and easy to weaken by paraphrasing — do not rewrite it". The
 * length comparison before timingSafeEqual is load-bearing: timingSafeEqual throws on
 * unequal-length buffers, and the try/catch turns any such throw into a plain 401 rather
 * than a 500 that would leak the difference.
 *
 * The four pre-existing cron routes keep their own inline copies untouched; this exists
 * for new routes so the pattern is not retyped from memory.
 */
export function isAuthorizedCronRequest(req: Request): boolean {
  const authHeader = req.headers.get('authorization')

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false
  }

  const token = authHeader.split(' ')[1]
  const expectedToken = env.CRON_SECRET

  try {
    if (
      !expectedToken ||
      token.length !== expectedToken.length ||
      !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expectedToken))
    ) {
      return false
    }
  } catch {
    return false
  }

  return true
}

/** Shape every extracted cron job returns, so the dispatcher can report uniformly. */
export type CronJobResult = Record<string, unknown> & { ok: boolean }
