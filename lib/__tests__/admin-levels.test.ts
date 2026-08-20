import { describe, it, expect, vi, beforeEach } from 'vitest'

// The security boundary this whole slice exists to create: a reviewer works the queue,
// a super admin holds the money dial. Every assertion below is about which of those two
// an action admits — and, for the funding-cap write, that a rejected reviewer performs
// ZERO writes rather than being caught somewhere further down.

const mocks = vi.hoisted(() => ({
  authMock: vi.fn(),
  createAdminClientMock: vi.fn(),
  updateMock: vi.fn(),
  insertMock: vi.fn(),
  notifyMock: vi.fn(),
}))

// A recording stand-in for the service-role client. Every builder method returns `this`
// so a chain like .update().eq().eq().select().maybeSingle() resolves, and the two
// mutating entry points are the mocks we assert on.
function makeAdminClient(overrides: Record<string, unknown> = {}) {
  const chain: Record<string, unknown> = {
    update: (...args: unknown[]) => {
      mocks.updateMock(...args)
      return chain
    },
    insert: (...args: unknown[]) => {
      mocks.insertMock(...args)
      return Promise.resolve({ error: null })
    },
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => chain,
    single: () => Promise.resolve({ data: null, error: null }),
    maybeSingle: () => Promise.resolve({ data: { id: 'p1' }, error: null }),
    ...overrides,
  }
  return { from: () => chain, rpc: vi.fn().mockResolvedValue({ data: { ok: true }, error: null }), storage: { from: () => ({ remove: vi.fn() }) } }
}

vi.mock('@clerk/nextjs/server', () => ({
  auth: mocks.authMock,
  clerkClient: async () => ({ users: { updateUserMetadata: vi.fn() } }),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: currentProfile }) }) }),
    }),
  }),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => mocks.createAdminClientMock(),
}))

vi.mock('@/lib/notify', () => ({
  createInAppNotification: mocks.notifyMock,
  sendCoachVerificationEmail: vi.fn().mockResolvedValue({ success: true }),
  sendCoachDenialEmail: vi.fn().mockResolvedValue({ success: true }),
  sendSponsorApplicationConfirmation: vi.fn().mockResolvedValue({ success: true }),
  sendSubmissionDecisionEmail: vi.fn().mockResolvedValue({ success: true }),
  sendHandshakeEmail: vi.fn().mockResolvedValue({ success: true }),
}))

// lib/dispatch.ts constructs a Resend client at import time, and app/actions/moderation.ts
// pulls it in transitively.
vi.mock('@/lib/dispatch', () => ({
  dispatchApprovedSubmission: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

// Preview/bypass modules must resolve to "off" or the guards short-circuit to a mock admin.
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

import { requireAdmin, requireSuperAdmin } from '@/lib/actions-utils'
import { adminUpdateSponsor, adminCreateSponsor, deleteSponsor, adminToggleSponsorStatus } from '@/app/actions/sponsor'
import { approveSponsorApplication, rejectSponsorApplication, verifyCoach, setAdminLevel } from '@/app/actions/admin'
import { GET as exportRoute } from '@/app/api/admin/export/route'
import { approveSubmission } from '@/app/actions/moderation'

// The profiles row requireAuth() resolves for the "signed-in" caller.
let currentProfile: Record<string, unknown> | null = null

const REVIEWER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SUPER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const REVIEWER = { id: REVIEWER_ID, role: 'admin', admin_level: 'reviewer', full_name: 'Rev' }
const SUPER = { id: SUPER_ID, role: 'admin', admin_level: 'super_admin', full_name: 'Sup' }
const COACH = { id: 'c-1', role: 'coach', admin_level: null }
const SPONSOR = { id: 's-1', role: 'sponsor', admin_level: null, sponsor_id: 'sp-1' }

function signIn(profile: Record<string, unknown> | null) {
  currentProfile = profile
  mocks.authMock.mockResolvedValue({ userId: profile ? 'user_test' : null })
}

const VALID_SPONSOR_INPUT = {
  companyName: 'Acme Robotics',
  contactName: 'Jane Doe',
  contactEmail: 'jane@acme.com',
  contactTitle: '',
  industry: '',
  website: '',
  fundingCapCents: 500_000,
  status: 'active' as const,
  notes: '',
  website2: '',
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.updateMock.mockReset()
  mocks.insertMock.mockReset()
  mocks.notifyMock.mockReset().mockResolvedValue({ success: true })
  mocks.createAdminClientMock.mockReset().mockImplementation(() => makeAdminClient())
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('requireSuperAdmin', () => {
  it('throws Forbidden for a reviewer', async () => {
    signIn(REVIEWER)
    await expect(requireSuperAdmin()).rejects.toThrow('Forbidden')
  })

  it('throws Forbidden for a coach and for a sponsor', async () => {
    signIn(COACH)
    await expect(requireSuperAdmin()).rejects.toThrow('Forbidden')
    signIn(SPONSOR)
    await expect(requireSuperAdmin()).rejects.toThrow('Forbidden')
  })

  it('resolves for a super admin', async () => {
    signIn(SUPER)
    const result = await requireSuperAdmin()
    expect(result.user.id).toBe(SUPER_ID)
  })
})

describe('requireAdmin still admits a reviewer', () => {
  it('resolves — reviewers must not lose the queue', async () => {
    signIn(REVIEWER)
    const result = await requireAdmin()
    expect(result.user.id).toBe(REVIEWER_ID)
  })
})

describe('a reviewer cannot edit a funding cap', () => {
  it('adminUpdateSponsor returns Forbidden and performs zero writes', async () => {
    signIn(REVIEWER)
    const result = await adminUpdateSponsor('sponsor-uuid', VALID_SPONSOR_INPUT)

    expect(result).toEqual({ error: 'Forbidden' })
    expect(mocks.updateMock).not.toHaveBeenCalled()
    expect(mocks.insertMock).not.toHaveBeenCalled()
    // The service-role client is never even constructed for a rejected caller.
    expect(mocks.createAdminClientMock).not.toHaveBeenCalled()
  })

  it('a super admin gets through to the write', async () => {
    signIn(SUPER)
    await adminUpdateSponsor('sponsor-uuid', VALID_SPONSOR_INPUT)
    expect(mocks.updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ funding_cap_cents: 500_000 })
    )
  })
})

describe('the rest of the super-admin surface rejects a reviewer', () => {
  beforeEach(() => signIn(REVIEWER))

  it('adminCreateSponsor', async () => {
    expect(await adminCreateSponsor(VALID_SPONSOR_INPUT)).toEqual({ error: 'Forbidden' })
  })

  it('deleteSponsor', async () => {
    expect(await deleteSponsor('11111111-1111-4111-8111-111111111111')).toEqual({ error: 'Forbidden' })
  })

  it('adminToggleSponsorStatus', async () => {
    expect(await adminToggleSponsorStatus('sponsor-uuid', 'active')).toEqual({ error: 'Forbidden' })
  })

  it('approveSponsorApplication', async () => {
    expect(await approveSponsorApplication('11111111-1111-4111-8111-111111111111')).toEqual({
      error: 'Forbidden',
    })
  })

  it('rejectSponsorApplication', async () => {
    expect(await rejectSponsorApplication('11111111-1111-4111-8111-111111111111')).toEqual({
      error: 'Forbidden',
    })
  })

  it('GET /api/admin/export returns JSON 403, never a redirect', async () => {
    const response = await exportRoute()
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Forbidden' })
  })
})

describe('a reviewer keeps the queue', () => {
  beforeEach(() => signIn(REVIEWER))

  it('verifyCoach is not blocked by the guard', async () => {
    const result = await verifyCoach('11111111-1111-4111-8111-111111111111', true)
    expect(result).not.toEqual({ error: 'Forbidden' })
  })

  it('approveSubmission is not blocked by the guard', async () => {
    const result = await approveSubmission('11111111-1111-4111-8111-111111111111')
    expect(result).not.toEqual({ error: 'Forbidden' })
  })
})

describe('setAdminLevel', () => {
  it('refuses self-demotion with a message that names the way out', async () => {
    signIn(SUPER)
    const result = await setAdminLevel({ profileId: SUPER_ID, level: 'reviewer' })
    expect(result).toEqual({ error: 'You cannot demote yourself. Ask another super admin.' })
    expect(mocks.updateMock).not.toHaveBeenCalled()
  })

  it('allows a super admin to re-affirm their own super_admin level', async () => {
    signIn(SUPER)
    mocks.createAdminClientMock.mockImplementation(() =>
      makeAdminClient({
        maybeSingle: () =>
          Promise.resolve({ data: { id: SUPER_ID, role: 'admin', admin_level: 'super_admin' }, error: null }),
      })
    )
    const result = await setAdminLevel({ profileId: SUPER_ID, level: 'super_admin' })
    // Rejected as a no-op, not as self-demotion.
    expect(result.error).toContain('already a super admin')
  })

  it('maps the floor trigger 23514 to the "at least one super admin" message', async () => {
    signIn(SUPER)
    let call = 0
    mocks.createAdminClientMock.mockImplementation(() =>
      makeAdminClient({
        maybeSingle: () => {
          call += 1
          // 1st call: the target lookup. 2nd: the update's .select().maybeSingle().
          return call === 1
            ? Promise.resolve({ data: { id: 'other', role: 'admin', admin_level: 'super_admin' }, error: null })
            : Promise.resolve({ data: null, error: { code: '23514', message: 'refusing to leave the platform with zero super admins' } })
        },
      })
    )

    const result = await setAdminLevel({ profileId: '22222222-2222-4222-8222-222222222222', level: 'reviewer' })
    expect(result).toEqual({ error: 'There must always be at least one super admin.' })
  })

  it('rejects a target that is not an admin', async () => {
    signIn(SUPER)
    mocks.createAdminClientMock.mockImplementation(() =>
      makeAdminClient({
        maybeSingle: () => Promise.resolve({ data: { id: 'c-9', role: 'coach', admin_level: null }, error: null }),
      })
    )
    const result = await setAdminLevel({ profileId: '33333333-3333-4333-8333-333333333333', level: 'super_admin' })
    expect(result).toEqual({ error: 'That account is not an admin.' })
    expect(mocks.updateMock).not.toHaveBeenCalled()
  })

  it('rejects a reviewer outright', async () => {
    signIn(REVIEWER)
    const result = await setAdminLevel({ profileId: '44444444-4444-4444-8444-444444444444', level: 'super_admin' })
    expect(result).toEqual({ error: 'Forbidden' })
  })
})
