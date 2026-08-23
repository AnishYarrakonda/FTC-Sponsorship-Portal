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

// ─── Superseded-file deletion queue (A-06-02) ────────────────────────────────────

/**
 * Why this exists at all.
 *
 * The purge paths above are careful: storage first, pointer second, so a failure leaves
 * a row the nightly sweep finds again. The *supersede* paths are not, and cannot be —
 * when a coach uploads a replacement ID, the pointer must move to the new file, and the
 * old path is then referenced by nothing. `remove([old]).catch(console.error)` was the
 * whole cleanup. One transient storage error and a government ID is retained forever,
 * invisible to `sweepUnpurgedCredentials` (which only walks live pointers) and to every
 * compliance report.
 *
 * So the path is written down before it stops being reachable, and retried until the
 * object is confirmed gone.
 */

export type StorageDeletionReason = 'superseded_credentials' | 'superseded_w9'

/**
 * Record a superseded object, then try to delete it immediately.
 *
 * Call this AFTER the pointer update has succeeded — never before. Enqueueing first
 * would mean a failed pointer update leaves a queued deletion for the file that is
 * still live, and the sweep would destroy the current document. (The sweep re-checks
 * live pointers anyway, but the ordering is the primary guard; the re-check is the
 * backstop.)
 *
 * Best-effort by design, like everything else here: it must never fail the upload that
 * triggered it. The difference from before is that failure is now durable and retried
 * rather than a line in a log nobody reads.
 */
export async function enqueueStorageDeletion(
  admin: AdminClient,
  bucket: string,
  path: string,
  reason: StorageDeletionReason
): Promise<{ deleted: boolean }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const table = (admin as any).from('pending_storage_deletions')

  const { error: enqueueError } = await table.upsert(
    { bucket, path, reason, attempts: 0 },
    { onConflict: 'bucket,path', ignoreDuplicates: true }
  )
  if (enqueueError) {
    console.error('[retention] failed to enqueue superseded object', bucket, path, enqueueError)
    Sentry.captureException(
      new Error(`[retention] enqueue failed for ${bucket}/${path}: ${enqueueError.message}`)
    )
    // Fall through and still attempt the delete — a queue miss is not a reason to also
    // skip the cleanup.
  }

  const { error: removeError } = await admin.storage.from(bucket).remove([path])
  if (removeError) {
    console.error('[retention] superseded object delete failed, queued for retry', bucket, path, removeError)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from('pending_storage_deletions')
      .update({ attempts: 1, last_attempt_at: new Date().toISOString(), last_error: removeError.message })
      .eq('bucket', bucket)
      .eq('path', path)
    return { deleted: false }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from('pending_storage_deletions')
    .update({ deleted_at: new Date().toISOString(), attempts: 1, last_attempt_at: new Date().toISOString(), last_error: null })
    .eq('bucket', bucket)
    .eq('path', path)

  return { deleted: true }
}

/**
 * Retry every object whose delete has not yet been confirmed.
 *
 * Runs in the nightly cron alongside `sweepUnpurgedCredentials`. Before removing
 * anything it re-checks that no live pointer still references the path — the ordering in
 * `enqueueStorageDeletion` should make that impossible, but this is a queue that deletes
 * government IDs, and a stale row here is not recoverable.
 */
export async function sweepPendingStorageDeletions(
  admin: AdminClient,
  limit = 200
): Promise<{ scanned: number; deleted: number; failed: number; skippedStillLive: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows, error } = await (admin as any)
    .from('pending_storage_deletions')
    .select('id, bucket, path, attempts')
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) {
    console.error('[retention] pending deletion sweep query failed', error)
    Sentry.captureException(new Error(`[retention] pending deletion sweep failed: ${error.message}`))
    return { scanned: 0, deleted: 0, failed: 0, skippedStillLive: 0 }
  }

  let deleted = 0
  let failed = 0
  let skippedStillLive = 0

  for (const row of (rows ?? []) as { id: string; bucket: string; path: string; attempts: number }[]) {
    if (await isPathStillLive(admin, row.bucket, row.path)) {
      skippedStillLive++
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin as any)
        .from('pending_storage_deletions')
        .update({ last_attempt_at: new Date().toISOString(), last_error: 'skipped: path is still the live pointer' })
        .eq('id', row.id)
      continue
    }

    const { error: removeError } = await admin.storage.from(row.bucket).remove([row.path])
    const now = new Date().toISOString()

    if (removeError) {
      failed++
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin as any)
        .from('pending_storage_deletions')
        .update({ attempts: row.attempts + 1, last_attempt_at: now, last_error: removeError.message })
        .eq('id', row.id)
      continue
    }

    deleted++
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from('pending_storage_deletions')
      .update({ deleted_at: now, attempts: row.attempts + 1, last_attempt_at: now, last_error: null })
      .eq('id', row.id)
  }

  return { scanned: rows?.length ?? 0, deleted, failed, skippedStillLive }
}

/**
 * Is this path still referenced by a live pointer? If so it is NOT a superseded object
 * and must not be deleted, whatever the queue says.
 */
async function isPathStillLive(admin: AdminClient, bucket: string, path: string): Promise<boolean> {
  if (bucket === CREDENTIALS_BUCKET) {
    const { data } = await admin
      .from('profiles')
      .select('id')
      .eq('coach_credentials_url', path)
      .limit(1)
    return (data?.length ?? 0) > 0
  }

  if (bucket === 'tax-documents') {
    const { data } = await admin
      .from('team_payout_profiles')
      .select('team_id')
      .eq('w9_document_path', path)
      .limit(1)
    return (data?.length ?? 0) > 0
  }

  return false
}
