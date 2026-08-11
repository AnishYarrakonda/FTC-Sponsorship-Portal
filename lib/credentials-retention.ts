import 'server-only'
import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'

/**
 * Retention control for uploaded files.
 *
 * A coach photo ID is evidence for exactly one decision — "is this a verified
 * adult?" — and has no purpose after an admin answers it. Two paths used to leak:
 *
 *   1. `verifyCoach` kept the file forever. `denyCoach` deleted it. So APPROVED
 *      coaches, the ones who stay on the platform, were exactly the ones whose
 *      government IDs accumulated without bound.
 *   2. Account deletion removed the `profiles` row but nothing else. Every file the
 *      user had uploaded stayed in storage, orphaned — and unreachable, because the
 *      only pointer to it had just been deleted along with the row.
 *
 * Both are storage-cost problems and both are privacy problems. The second is the
 * worse one: "delete my account" left a photo of the user's driver's licence behind.
 *
 * Everything here is best-effort by design. A failed cleanup must never fail the
 * verification or the account deletion that triggered it — the nightly sweep in
 * `app/api/cron/expire-submissions/route.ts` retries whatever was left behind.
 */

type AdminClient = SupabaseClient<Database>

export const CREDENTIALS_BUCKET = 'coach-credentials'

/**
 * Every bucket whose objects are keyed `{clerkUserId}/…`. Storage RLS is written
 * against that first segment (see `.claude/rules/auth-supabase.md`), which is what
 * makes a prefix delete a complete delete for one user.
 *
 * `visual-pitch-items` and `pitch-media` have no live writer today — they exist in
 * the migrations and may hold rows from earlier builds. Listed so a deletion is
 * actually total rather than total-for-the-buckets-we-happen-to-use-right-now.
 */
export const USER_PARTITIONED_BUCKETS = [
  CREDENTIALS_BUCKET,
  'team-logos',
  'pitch-storage',
  'visual-pitch-items',
  'pitch-media',
  'tax-documents',
] as const

/** Supabase Storage caps `list()` at 100 objects per call. */
const LIST_PAGE_SIZE = 100

/** Stops a malformed pagination response from looping forever. 10k files per user. */
const MAX_LIST_PAGES = 100

/**
 * Destroy one coach's photo ID and record that it happened.
 *
 * Order is deliberate: storage first, pointer second. The reverse can strand the
 * object — once `coach_credentials_url` is NULL nothing knows the path, and the file
 * is unreachable forever. This way a failure between the two steps leaves a row that
 * still matches the sweep's predicate and gets retried tonight.
 */
export async function purgeCoachCredentials(
  admin: AdminClient,
  coachId: string,
  path: string | null | undefined
): Promise<{ purged: boolean; error?: string }> {
  if (path) {
    const { error } = await admin.storage.from(CREDENTIALS_BUCKET).remove([path])
    if (error) {
      console.error('[retention] credential file delete failed', coachId, error)
      Sentry.captureException(
        new Error(`[retention] credential file delete failed for ${coachId}: ${error.message}`)
      )
      // Leave the pointer intact so tonight's sweep can find this row again.
      return { purged: false, error: error.message }
    }
  }

  const { error: updateError } = await admin
    .from('profiles')
    .update({
      coach_credentials_url: null,
      coach_credentials_purged_at: new Date().toISOString(),
    })
    .eq('id', coachId)

  if (updateError) {
    console.error('[retention] credential pointer clear failed', coachId, updateError)
    Sentry.captureException(
      new Error(`[retention] credential pointer clear failed for ${coachId}: ${updateError.message}`)
    )
    return { purged: false, error: updateError.message }
  }

  return { purged: true }
}

/**
 * Delete every object a Clerk user owns, across every bucket.
 *
 * Called on account deletion. Runs BEFORE the `profiles` row is removed so that a
 * failure here is retryable: the webhook returns non-2xx, Svix redelivers, and the
 * second attempt finds the same prefix. Removing the row first would make the files
 * permanently unfindable.
 */
export async function purgeUserStorage(
  admin: AdminClient,
  clerkUserId: string
): Promise<{ removed: number; failedBuckets: string[] }> {
  let removed = 0
  const failedBuckets: string[] = []

  for (const bucket of USER_PARTITIONED_BUCKETS) {
    try {
      const paths: string[] = []

      for (let page = 0; page < MAX_LIST_PAGES; page++) {
        const { data, error } = await admin.storage
          .from(bucket)
          .list(clerkUserId, { limit: LIST_PAGE_SIZE, offset: page * LIST_PAGE_SIZE })

        if (error) throw new Error(error.message)
        if (!data?.length) break

        // `list()` returns names relative to the prefix; storage needs the full key.
        paths.push(...data.map((o) => `${clerkUserId}/${o.name}`))
        if (data.length < LIST_PAGE_SIZE) break
      }

      if (paths.length === 0) continue

      const { error: removeError } = await admin.storage.from(bucket).remove(paths)
      if (removeError) throw new Error(removeError.message)

      removed += paths.length
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      console.error(`[retention] storage purge failed for ${bucket}/${clerkUserId}`, message)
      Sentry.captureException(
        new Error(`[retention] storage purge failed for ${bucket}/${clerkUserId}: ${message}`)
      )
      failedBuckets.push(bucket)
    }
  }

  return { removed, failedBuckets }
}

/**
 * Catch-up pass for credentials that should already be gone: a coach verified before
 * this retention rule existed, or one whose delete failed mid-flight.
 *
 * Backed by `idx_profiles_credentials_pending_purge` (0074), a partial index over
 * exactly this predicate. The steady state is zero rows, so this is one index probe
 * that normally returns nothing.
 */
export async function sweepUnpurgedCredentials(
  admin: AdminClient,
  limit = 200
): Promise<{ scanned: number; purged: number; failed: number }> {
  const { data: rows, error } = await admin
    .from('profiles')
    .select('id, coach_credentials_url')
    .eq('coach_verified', true)
    .not('coach_credentials_url', 'is', null)
    .limit(limit)

  if (error) {
    console.error('[retention] sweep query failed', error)
    Sentry.captureException(new Error(`[retention] sweep query failed: ${error.message}`))
    return { scanned: 0, purged: 0, failed: 0 }
  }

  let purged = 0
  let failed = 0

  for (const row of rows ?? []) {
    const result = await purgeCoachCredentials(admin, row.id, row.coach_credentials_url)
    if (result.purged) purged++
    else failed++
  }

  return { scanned: rows?.length ?? 0, purged, failed }
}

/**
 * Destroy a team's W-9 and record that it happened.
 * 
 * Like purgeCoachCredentials, this does storage first, then updates the pointer.
 * This is only called when an admin explicitly deletes it or during account deletion,
 * because W-9s are kept as business records otherwise.
 */
export async function purgeTeamW9(
  admin: AdminClient,
  teamId: string,
  path: string | null | undefined
): Promise<{ purged: boolean; error?: string }> {
  if (path) {
    const { error } = await admin.storage.from('tax-documents').remove([path])
    if (error) {
      console.error(`[retention] W-9 file delete failed for team ${teamId}`, error)
      Sentry.captureException(
        new Error(`[retention] W-9 file delete failed for team ${teamId}: ${error.message}`)
      )
      // Leave the pointer intact so tonight's sweep or retry can find this row again.
      return { purged: false, error: error.message }
    }
  }

  const { error: updateError } = await admin
    .from('team_payout_profiles')
    .update({
      w9_document_path: null,
      w9_purged_at: new Date().toISOString(),
    })
    .eq('team_id', teamId)

  if (updateError) {
    console.error(`[retention] W-9 pointer clear failed for team ${teamId}`, updateError)
    Sentry.captureException(
      new Error(`[retention] W-9 pointer clear failed for team ${teamId}: ${updateError.message}`)
    )
    return { purged: false, error: updateError.message }
  }

  return { purged: true }
}
