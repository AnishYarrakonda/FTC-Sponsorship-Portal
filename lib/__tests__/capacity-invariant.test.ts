import { describe, it, expect, vi, beforeEach } from 'vitest'

// Unit coverage of the two code paths that consume detect_capacity_drift(): the admin
// action behind /admin/capacity, and the nightly cron branch. The invariant ITSELF is
// proved against a real database by scripts/verify-capacity-invariant.mjs — this file
// only pins the plumbing around it, above all that a drift finding never takes the
// nightly expiry sweep down with it.

const mocks = vi.hoisted(() => ({
  authMock: vi.fn(),
  rpcMock: vi.fn(),
  insertMock: vi.fn(),
  captureMock: vi.fn(),
  sweepCredentialsMock: vi.fn(),
  sweepPendingDeletionsMock: vi.fn(),
  sweepW9Mock: vi.fn(),
}))

const DRIFT_ROW = {
  sponsor_id: 'sp-1',
  company_name: 'Acme Robotics',
  funding_cap_cents: 1_000_000,
  funding_used_cents: 400_000,
  open_reservations_cents: 250_000,
  settled_ledger_cents: 100_000,
  expected_used_cents: 350_000,
  drift_cents: 50_000,
}

// Chainable stand-in: `from(...)` supports both the .insert() audit writes and the
// .select(..., { head: true }) count used for the "N sponsors checked" figure, and the
// select chains the cron uses to gather rows before each RPC.
function makeClient() {
  const chain: Record<string, unknown> = {
    insert: (...args: unknown[]) => {
      mocks.insertMock(...args)
      return Promise.resolve({ error: null })
    },
    select: () => chain,
    delete: () => chain,
    eq: () => chain,
    in: () => chain,
    is: () => chain,
    not: () => chain,
    lt: () => chain,
    order: () => chain,
    limit: () => chain,
    then: (resolve: (v: unknown) => unknown) => resolve({ data: [], count: 7, error: null }),
  }
  return { from: () => chain, rpc: mocks.rpcMock }
}

vi.mock('@clerk/nextjs/server', () => ({ auth: mocks.authMock }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ single: () => Promise.resolve({ data: { id: 'rev-1', role: 'admin', admin_level: 'reviewer' } }) }),
      }),
    }),
  }),
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => makeClient() }))

vi.mock('@/lib/notify', () => ({ createInAppNotification: vi.fn().mockResolvedValue({ success: true }) }))
vi.mock('@/lib/credentials-retention', () => ({
  sweepUnpurgedCredentials: mocks.sweepCredentialsMock,
  // A-06-02 added a second sweep to this cron. Omitting it here made the module export
  // undefined, which the route then called — a 500 that looked like a drift-check
  // regression rather than a missing mock.
  sweepPendingStorageDeletions: mocks.sweepPendingDeletionsMock,
}))
vi.mock('@/lib/payout-retention', () => ({ sweepExpiringW9s: mocks.sweepW9Mock }))
vi.mock('@sentry/nextjs', () => ({ captureException: mocks.captureMock }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/env', () => ({ env: { CRON_SECRET: 'test-cron-secret-value' } }))

vi.mock('@/lib/dev-bypass', () => ({
  isDevAuthBypass: () => false,
  MOCK_ADMIN_PROFILE: {},
  createMockSupabaseClient: () => ({}),
}))
vi.mock('@/lib/dev-preview', () => ({
  SPONSOR_PREVIEW: false,
  mockProfile: {},
  createMockSupabaseClient: () => ({}),
}))
vi.mock('@/lib/dev-coach-preview', () => ({
  COACH_PREVIEW: false,
  mockCoachProfile: {},
  createMockCoachClient: () => ({}),
}))

import { runCapacityAudit } from '@/app/actions/capacity-audit'
import { GET as cronRoute } from '@/app/api/cron/expire-submissions/route'

function cronRequest() {
  return new Request('https://example.test/api/cron/expire-submissions', {
    headers: { authorization: 'Bearer test-cron-secret-value' },
  })
}

/** The cron calls three RPCs in order: expire, expire proposals, detect drift. */
function cronRpcs({ drift }: { drift: unknown }) {
  return (name: string) => {
    if (name === 'expire_overdue_submissions') return Promise.resolve({ data: { expired: 2 }, error: null })
    if (name === 'expire_stale_decision_proposals') return Promise.resolve({ data: { expired: 0 }, error: null })
    if (name === 'detect_capacity_drift') {
      return drift instanceof Error
        ? Promise.resolve({ data: null, error: { message: drift.message } })
        : Promise.resolve({ data: drift, error: null })
    }
    return Promise.resolve({ data: null, error: null })
  }
}

function auditActions() {
  return mocks.insertMock.mock.calls.map((call) => (call[0] as { action: string }).action)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.authMock.mockResolvedValue({ userId: 'user_test' })
  mocks.insertMock.mockReset()
  mocks.captureMock.mockReset()
  mocks.sweepCredentialsMock.mockResolvedValue({ purged: 0, failed: 0 })
  mocks.sweepW9Mock.mockResolvedValue({ notified: 0, failed: 0 })
  mocks.sweepPendingDeletionsMock.mockResolvedValue({ scanned: 0, deleted: 0, failed: 0, skippedStillLive: 0 })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

describe('runCapacityAudit', () => {
  it('writes exactly one capacity_audit_run row carrying the drift count and sponsor ids', async () => {
    mocks.rpcMock.mockResolvedValue({ data: [DRIFT_ROW], error: null })

    const result = await runCapacityAudit()

    expect(result).toEqual({ rows: [DRIFT_ROW], sponsorCount: 7 })
    expect(mocks.insertMock).toHaveBeenCalledTimes(1)
    expect(mocks.insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'capacity_audit_run',
        metadata: { drift_count: 1, sponsor_ids: ['sp-1'] },
      })
    )
  })

  it('records a clean audit (drift_count 0) when the invariant holds', async () => {
    mocks.rpcMock.mockResolvedValue({ data: [], error: null })

    const result = await runCapacityAudit()

    expect(result).toEqual({ rows: [], sponsorCount: 7 })
    expect(mocks.insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { drift_count: 0, sponsor_ids: [] } })
    )
  })

  it('is readable by a reviewer — it changes nothing', async () => {
    mocks.rpcMock.mockResolvedValue({ data: [], error: null })
    const result = await runCapacityAudit()
    expect('error' in result).toBe(false)
  })
})

describe('cron drift check', () => {
  it('writes capacity_drift_detected and reports to Sentry when the RPC returns rows', async () => {
    mocks.rpcMock.mockImplementation(cronRpcs({ drift: [DRIFT_ROW] }))

    const response = await cronRoute(cronRequest())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ expired: 2, proposalsExpired: 0, drift: 1 })
    expect(auditActions()).toContain('capacity_drift_detected')
    expect(mocks.captureMock).toHaveBeenCalled()
  })

  it('writes no drift row and does not alarm when the invariant holds', async () => {
    mocks.rpcMock.mockImplementation(cronRpcs({ drift: [] }))

    const response = await cronRoute(cronRequest())

    expect(await response.json()).toEqual({ expired: 2, proposalsExpired: 0, drift: 0 })
    expect(auditActions()).not.toContain('capacity_drift_detected')
    expect(mocks.captureMock).not.toHaveBeenCalled()
  })

  it('still returns 200 with the expiry result when the drift RPC itself fails', async () => {
    mocks.rpcMock.mockImplementation(cronRpcs({ drift: new Error('relation does not exist') }))

    const response = await cronRoute(cronRequest())

    // The sweep already succeeded; a broken detector must never turn that into a 500.
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ expired: 2, proposalsExpired: 0, drift: 0 })
    expect(auditActions()).toContain('cron_expire_submissions')
    expect(auditActions()).not.toContain('capacity_drift_detected')
    expect(mocks.captureMock).toHaveBeenCalled()
  })
})
