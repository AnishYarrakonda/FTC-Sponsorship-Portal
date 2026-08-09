import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  purgeCoachCredentials,
  purgeUserStorage,
  CREDENTIALS_BUCKET,
  USER_PARTITIONED_BUCKETS,
} from '@/lib/credentials-retention'

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

type StorageCall = { op: string; bucket: string; arg: unknown }

/**
 * Minimal stand-in for the service-role client. Records the ORDER of operations,
 * because ordering is the property these tests exist to protect.
 */
function makeClient(opts: {
  removeError?: string
  updateError?: string
  listPages?: Record<string, { name: string }[][]>
}) {
  const calls: StorageCall[] = []
  const updates: Record<string, unknown>[] = []

  const client = {
    storage: {
      from(bucket: string) {
        return {
          async remove(paths: string[]) {
            calls.push({ op: 'remove', bucket, arg: paths })
            return opts.removeError
              ? { data: null, error: { message: opts.removeError } }
              : { data: [], error: null }
          },
          async list(prefix: string, range?: { limit: number; offset: number }) {
            calls.push({ op: 'list', bucket, arg: prefix })
            const pages = opts.listPages?.[bucket] ?? []
            const index = range ? range.offset / range.limit : 0
            return { data: pages[index] ?? [], error: null }
          },
        }
      },
    },
    from() {
      return {
        update(payload: Record<string, unknown>) {
          calls.push({ op: 'update', bucket: 'profiles', arg: payload })
          updates.push(payload)
          return {
            async eq() {
              return opts.updateError ? { error: { message: opts.updateError } } : { error: null }
            },
          }
        },
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any

  return { client, calls, updates }
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

/**
 * Retention of coach photo IDs.
 *
 * `verifyCoach` kept the document forever while `denyCoach` deleted it, so approved
 * coaches — the ones who stay — were exactly the ones whose government IDs accumulated.
 * These lock the two properties that are easy to break during a later tidy-up.
 */
describe('purgeCoachCredentials', () => {
  it('deletes the stored object BEFORE clearing the pointer to it', async () => {
    const { client, calls } = makeClient({})

    await purgeCoachCredentials(client, 'coach-1', 'user_abc/credentials_1.jpg')

    const removeAt = calls.findIndex((c) => c.op === 'remove')
    const updateAt = calls.findIndex((c) => c.op === 'update')

    expect(removeAt).toBeGreaterThanOrEqual(0)
    expect(updateAt).toBeGreaterThanOrEqual(0)
    // Reversing these strands the file: once coach_credentials_url is NULL, nothing
    // knows the object's path and it can never be found again.
    expect(removeAt).toBeLessThan(updateAt)
    expect(calls[removeAt].bucket).toBe(CREDENTIALS_BUCKET)
  })

  it('leaves the pointer intact when the storage delete fails, so the sweep can retry', async () => {
    const { client, calls } = makeClient({ removeError: 'storage unavailable' })

    const result = await purgeCoachCredentials(client, 'coach-1', 'user_abc/credentials_1.jpg')

    expect(result.purged).toBe(false)
    expect(result.error).toBe('storage unavailable')
    // The row must still match the nightly sweep's predicate
    // (coach_verified = true AND coach_credentials_url IS NOT NULL).
    expect(calls.some((c) => c.op === 'update')).toBe(false)
  })

  it('stamps the retention marker on success', async () => {
    const { client, updates } = makeClient({})

    const result = await purgeCoachCredentials(client, 'coach-1', 'user_abc/credentials_1.jpg')

    expect(result.purged).toBe(true)
    expect(updates[0].coach_credentials_url).toBeNull()
    // Distinguishes "reviewed then destroyed" from "never uploaded" — without it the
    // admin queue shows a verified coach as having ignored the signup step.
    expect(typeof updates[0].coach_credentials_purged_at).toBe('string')
  })

  it('still records the purge when there is no file to remove', async () => {
    const { client, calls } = makeClient({})

    const result = await purgeCoachCredentials(client, 'coach-1', null)

    expect(result.purged).toBe(true)
    expect(calls.some((c) => c.op === 'remove')).toBe(false)
  })

  it('reports failure when the pointer update fails', async () => {
    const { client } = makeClient({ updateError: 'row locked' })

    const result = await purgeCoachCredentials(client, 'coach-1', 'user_abc/credentials_1.jpg')

    expect(result.purged).toBe(false)
    expect(result.error).toBe('row locked')
  })
})

/**
 * Account deletion used to remove the `profiles` row and nothing else, leaving every
 * uploaded file orphaned — including the photo ID, and including for users who had
 * explicitly asked to be deleted.
 */
describe('purgeUserStorage', () => {
  it('sweeps every user-partitioned bucket', async () => {
    const { client, calls } = makeClient({})

    await purgeUserStorage(client, 'user_abc')

    const listed = calls.filter((c) => c.op === 'list').map((c) => c.bucket)
    expect(listed).toEqual([...USER_PARTITIONED_BUCKETS])
  })

  it('removes objects under the user prefix, keyed by full path', async () => {
    const { client, calls } = makeClient({
      listPages: { [CREDENTIALS_BUCKET]: [[{ name: 'credentials_1.jpg' }]] },
    })

    const { removed } = await purgeUserStorage(client, 'user_abc')

    expect(removed).toBe(1)
    const removal = calls.find((c) => c.op === 'remove')
    // `list()` returns names relative to the prefix; storage needs the full key.
    expect(removal?.arg).toEqual(['user_abc/credentials_1.jpg'])
  })

  it('pages until a short page, so a user with >100 files is fully cleaned', async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ name: `f${i}.jpg` }))
    const { client } = makeClient({
      listPages: { 'pitch-storage': [full, [{ name: 'last.jpg' }]] },
    })

    const { removed } = await purgeUserStorage(client, 'user_abc')

    expect(removed).toBe(101)
  })

  it('reports the failing bucket instead of silently continuing', async () => {
    const { client } = makeClient({
      removeError: 'permission denied',
      listPages: { [CREDENTIALS_BUCKET]: [[{ name: 'credentials_1.jpg' }]] },
    })

    const { failedBuckets } = await purgeUserStorage(client, 'user_abc')

    // The webhook turns a non-empty list into a 500 so Svix redelivers — a swallowed
    // failure here would mean "account deleted" while the ID stayed on disk.
    expect(failedBuckets).toContain(CREDENTIALS_BUCKET)
  })
})
