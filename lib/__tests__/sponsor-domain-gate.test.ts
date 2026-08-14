import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// ── Mocks ─────────────────────────────────────────────────────────────────────
//
// One admin-client stub serves both halves of this file: the pure gate tests
// (email_domain_rules lookups) and the live-path tests that drive
// createSponsorApplication end to end. Same `vi.hoisted` idiom as the
// sponsor-application.test.ts this file replaces.

const mocks = vi.hoisted(() => ({
  captureMock: vi.fn(),
  rpcMock: vi.fn(),
  profileUpsertMock: vi.fn(),
  appInsertMock: vi.fn(),
  appUpdateEqMock: vi.fn(),
  auditInsertMock: vi.fn(),
  getClientIpMock: vi.fn(),
  checkBotIdMock: vi.fn(),
  notifyConfirmationMock: vi.fn(),
  notifyAlertMock: vi.fn(),
  inAppMock: vi.fn(),
  updateUserMetadataMock: vi.fn(),
  authMock: vi.fn(),
  state: {
    rule: null as { domain: string; rule: string; category: string } | null,
    ruleError: null as { message: string } | null,
    existingProfile: null as { id: string; role: string } | null,
    existingApp: null as { id: string; status: string } | null,
  },
}))

/** A PostgREST-ish chainable that is also directly awaitable. */
function chain(result: unknown) {
  const obj: Record<string, unknown> = {}
  Object.assign(obj, {
    select: () => obj,
    eq: () => obj,
    order: () => obj,
    maybeSingle: () => Promise.resolve(result),
    single: () => Promise.resolve(result),
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(result).then(res, rej),
  })
  return obj
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: mocks.rpcMock,
    from: (table: string) => {
      switch (table) {
        case 'email_domain_rules':
          return { select: () => chain({ data: mocks.state.rule, error: mocks.state.ruleError }) }
        case 'profiles':
          return {
            // `.select('id')` is the admin-fan-out query (a list); everything else is the
            // caller's own profile lookup.
            select: (cols: string) =>
              cols === 'id'
                ? chain({ data: [{ id: 'admin-1' }], error: null })
                : chain({ data: mocks.state.existingProfile, error: null }),
            upsert: mocks.profileUpsertMock,
          }
        case 'sponsor_applications':
          return {
            select: () => chain({ data: mocks.state.existingApp, error: null }),
            insert: mocks.appInsertMock,
            update: () => ({ eq: mocks.appUpdateEqMock }),
          }
        case 'audit_log':
          return { insert: mocks.auditInsertMock }
        default:
          return { select: () => chain({ data: null, error: null }) }
      }
    },
  }),
}))

vi.mock('@sentry/nextjs', () => ({ captureException: mocks.captureMock }))
vi.mock('botid/server', () => ({ checkBotId: mocks.checkBotIdMock }))
vi.mock('@/lib/actions-utils', () => ({ getClientIp: mocks.getClientIpMock }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

vi.mock('@clerk/nextjs/server', () => ({
  auth: mocks.authMock,
  clerkClient: async () => ({
    users: {
      getUser: async () => ({
        primaryEmailAddress: { emailAddress: SESSION_EMAIL },
        emailAddresses: [{ emailAddress: SESSION_EMAIL }],
      }),
      updateUserMetadata: mocks.updateUserMetadataMock,
    },
  }),
}))

vi.mock('@/lib/notify', () => ({
  sendCredentialUploadAlert: vi.fn(),
  sendCoachSignupWelcomeEmail: vi.fn(),
  sendWelcomeInAppNotification: vi.fn(),
  sendSponsorApplicationConfirmation: mocks.notifyConfirmationMock,
  sendSponsorApplicationAlert: mocks.notifyAlertMock,
  createInAppNotification: mocks.inAppMock,
}))

let SESSION_EMAIL = 'jane@acme.com'

import { checkSponsorEmailDomain } from '@/lib/sponsor-domain-gate'
import { createSponsorApplication } from '@/app/actions/auth'
import { SUPPORT_EMAIL } from '@/lib/site-config'

const RPC_ALLOWED = { data: true, error: null }
const RPC_BLOCKED = { data: false, error: null }

const VALID_SPONSOR_SIGNUP = {
  fullName: 'Jane Doe',
  email: 'jane@acme.com',
  password: 'Sup3rSecretPass',
  confirmPassword: 'Sup3rSecretPass',
  companyName: 'Acme Robotics',
  industry: 'Manufacturing',
  website: 'https://www.acme.com/about',
  phoneNumber: '2145550131',
  companyAddress: '123 Corporate Blvd, Ste 100',
  proposedCapCents: 500_000,
  sponsorshipReason: 'We want to fund local FTC teams.',
  fundingFrequency: 'Annual' as const,
  industryFocus: ['Engineering'],
  geographicFocus: 'Texas',
  mentorshipOffered: false,
  coppaAcknowledged: true,
  tosAccepted: true,
  ageConfirmed: true,
}

beforeEach(() => {
  SESSION_EMAIL = 'jane@acme.com'
  mocks.state.rule = null
  mocks.state.ruleError = null
  mocks.state.existingProfile = null
  mocks.state.existingApp = null

  mocks.captureMock.mockReset()
  mocks.rpcMock.mockReset().mockResolvedValue(RPC_ALLOWED)
  mocks.profileUpsertMock.mockReset().mockResolvedValue({ error: null })
  mocks.appInsertMock.mockReset().mockResolvedValue({ error: null })
  mocks.appUpdateEqMock.mockReset().mockResolvedValue({ error: null })
  mocks.auditInsertMock.mockReset().mockResolvedValue({ error: null })
  mocks.getClientIpMock.mockReset().mockResolvedValue('1.2.3.4')
  mocks.checkBotIdMock.mockReset().mockResolvedValue({ isBot: false, isHuman: true })
  mocks.notifyConfirmationMock.mockReset().mockResolvedValue({ success: true })
  mocks.notifyAlertMock.mockReset().mockResolvedValue({ success: true })
  mocks.inAppMock.mockReset().mockResolvedValue({ success: true })
  mocks.updateUserMetadataMock.mockReset().mockResolvedValue({})
  mocks.authMock.mockReset().mockResolvedValue({ userId: 'user_sponsor_1' })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

// ─────────────────────────────────────────────────────────────────────────────
// checkSponsorEmailDomain
// ─────────────────────────────────────────────────────────────────────────────

describe('checkSponsorEmailDomain', () => {
  it('refuses a blocked consumer domain with actionable support copy', async () => {
    mocks.state.rule = { domain: 'gmail.com', rule: 'block', category: 'consumer' }
    const verdict = await checkSponsorEmailDomain('jane@gmail.com')
    expect(verdict.allowed).toBe(false)
    expect(verdict.reason).toBe('consumer')
    expect(verdict.allowed === false && verdict.message).toContain(SUPPORT_EMAIL)
  })

  it('labels a blocked disposable domain as disposable', async () => {
    mocks.state.rule = { domain: 'mailinator.com', rule: 'block', category: 'disposable' }
    const verdict = await checkSponsorEmailDomain('jane@mailinator.com')
    expect(verdict).toMatchObject({ allowed: false, reason: 'disposable' })
  })

  it('lets an allow rule win over a block for the same domain', async () => {
    mocks.state.rule = { domain: 'gmail.com', rule: 'allow', category: 'manual' }
    expect(await checkSponsorEmailDomain('jane@gmail.com')).toEqual({
      allowed: true,
      reason: 'allowlisted',
    })
  })

  it('treats an unlisted domain as corporate', async () => {
    expect(await checkSponsorEmailDomain('jane@acme.com')).toEqual({
      allowed: true,
      reason: 'corporate',
    })
  })

  it('FAILS OPEN with exactly one Sentry report when the rules query errors', async () => {
    mocks.state.ruleError = { message: 'relation does not exist' }
    expect(await checkSponsorEmailDomain('jane@gmail.com')).toEqual({
      allowed: true,
      reason: 'corporate',
    })
    expect(mocks.captureMock).toHaveBeenCalledTimes(1)
  })

  it('normalizes case and +tags before the lookup', async () => {
    mocks.state.rule = { domain: 'gmail.com', rule: 'block', category: 'consumer' }
    const verdict = await checkSponsorEmailDomain('  Jane+ftc@GMAIL.com ')
    expect(verdict.allowed).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The LIVE public path. These assertions replace the ones that used to live in
// sponsor-application.test.ts against submitSponsorApplication — dead code that no page
// ever called. createSponsorApplication is the action /sponsors/apply actually submits to.
// ─────────────────────────────────────────────────────────────────────────────

describe('createSponsorApplication — BotID', () => {
  it('refuses a request classified as a bot, before any database work', async () => {
    mocks.checkBotIdMock.mockResolvedValue({ isBot: true, isHuman: false })
    const result = await createSponsorApplication(VALID_SPONSOR_SIGNUP)
    expect(result?.error).toContain('could not verify this request')
    expect(mocks.rpcMock).not.toHaveBeenCalled()
    expect(mocks.appInsertMock).not.toHaveBeenCalled()
  })

  it('FAILS OPEN when checkBotId itself throws', async () => {
    mocks.checkBotIdMock.mockRejectedValue(new Error('botid unreachable'))
    const result = await createSponsorApplication(VALID_SPONSOR_SIGNUP)
    expect(result).toBeUndefined()
    expect(mocks.appInsertMock).toHaveBeenCalledTimes(1)
    expect(mocks.captureMock).toHaveBeenCalled()
  })
})

describe('createSponsorApplication — throttling', () => {
  it('rejects when a throttle bucket is exhausted', async () => {
    mocks.rpcMock.mockResolvedValueOnce(RPC_BLOCKED).mockResolvedValueOnce(RPC_ALLOWED)
    const result = await createSponsorApplication(VALID_SPONSOR_SIGNUP)
    expect(result).toEqual({ error: 'Too many applications — please try again later.' })
    expect(mocks.appInsertMock).not.toHaveBeenCalled()
  })

  it('keys the buckets on the IP and the Clerk session email', async () => {
    await createSponsorApplication(VALID_SPONSOR_SIGNUP)
    expect(mocks.rpcMock).toHaveBeenCalledWith('check_throttle', {
      p_key: 'sponsor-apply:1.2.3.4',
      p_limit: 3,
      p_window: '1 hour',
    })
    expect(mocks.rpcMock).toHaveBeenCalledWith('check_throttle', {
      p_key: 'sponsor-apply-email:jane@acme.com',
      p_limit: 2,
      p_window: '1 day',
    })
  })

  it('FAILS OPEN when the throttle RPC itself errors (availability over strictness)', async () => {
    mocks.rpcMock.mockResolvedValue({ data: null, error: { message: 'function missing' } })
    const result = await createSponsorApplication(VALID_SPONSOR_SIGNUP)
    expect(result).toBeUndefined()
    expect(mocks.appInsertMock).toHaveBeenCalledTimes(1)
    expect(mocks.captureMock).toHaveBeenCalled()
  })
})

describe('createSponsorApplication — domain gating', () => {
  it('refuses a blocked domain and writes no application row', async () => {
    SESSION_EMAIL = 'jane@gmail.com'
    mocks.state.rule = { domain: 'gmail.com', rule: 'block', category: 'consumer' }

    const result = await createSponsorApplication({ ...VALID_SPONSOR_SIGNUP, email: 'jane@gmail.com' })

    expect(result?.error).toContain(SUPPORT_EMAIL)
    expect(mocks.appInsertMock).not.toHaveBeenCalled()
    // The throttle must not burn a bucket for a refused applicant.
    expect(mocks.rpcMock).not.toHaveBeenCalled()
  })

  it('audits the rejection with the domain only — never the full address', async () => {
    SESSION_EMAIL = 'jane@gmail.com'
    mocks.state.rule = { domain: 'gmail.com', rule: 'block', category: 'consumer' }

    await createSponsorApplication({ ...VALID_SPONSOR_SIGNUP, email: 'jane@gmail.com' })

    expect(mocks.auditInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'sponsor_application_blocked',
        entity_type: 'sponsor_applications',
        metadata: { email_domain: 'gmail.com', rule_category: 'consumer' },
      })
    )
    const [[audited]] = mocks.auditInsertMock.mock.calls
    expect(JSON.stringify(audited)).not.toContain('jane@gmail.com')
  })

  it('lets an allowlisted applicant through and records an unknown verdict', async () => {
    SESSION_EMAIL = 'jane@gmail.com'
    mocks.state.rule = { domain: 'gmail.com', rule: 'allow', category: 'manual' }

    const result = await createSponsorApplication({ ...VALID_SPONSOR_SIGNUP, email: 'jane@gmail.com' })

    expect(result).toBeUndefined()
    expect(mocks.appInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ email_domain: 'gmail.com', domain_match: 'unknown' })
    )
  })
})

describe('createSponsorApplication — domain-match verdict', () => {
  it('persists the website and a match verdict when the domains agree', async () => {
    await createSponsorApplication(VALID_SPONSOR_SIGNUP)
    expect(mocks.appInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        website: 'https://www.acme.com/about',
        email_domain: 'acme.com',
        website_domain: 'acme.com',
        domain_match: 'match',
      })
    )
  })

  it('flags a mismatch and appends a heads-up to the admin notification', async () => {
    SESSION_EMAIL = 'jane@othercorp.com'
    await createSponsorApplication({ ...VALID_SPONSOR_SIGNUP, email: 'jane@othercorp.com' })

    expect(mocks.appInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        email_domain: 'othercorp.com',
        website_domain: 'acme.com',
        domain_match: 'mismatch',
      })
    )
    const bodies = mocks.inAppMock.mock.calls.map(([arg]) => arg.body as string)
    expect(bodies.some((b) => b.includes('does not match'))).toBe(true)
  })

  it('refreshes the verdict when a rejected applicant re-applies', async () => {
    mocks.state.existingApp = { id: 'app-1', status: 'rejected' }
    SESSION_EMAIL = 'jane@othercorp.com'

    await createSponsorApplication({ ...VALID_SPONSOR_SIGNUP, email: 'jane@othercorp.com' })

    expect(mocks.appInsertMock).not.toHaveBeenCalled()
    expect(mocks.appUpdateEqMock).toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// THE SCOPE FENCE, enforced rather than documented.
//
// Coaches are unpaid volunteers on personal email. If a future change wires the gate (or
// even the domain comparison) into provisionCoachProfile / createCoachProfile /
// completeCoachProfile, that change silently locks out most of the product's supply side.
// A comment cannot stop that; this can.
// ─────────────────────────────────────────────────────────────────────────────

describe('scope fence: the coach path never touches the domain gate', () => {
  const source = readFileSync(path.resolve(__dirname, '../../app/actions/auth.ts'), 'utf8')
  const sponsorActionStart = source.indexOf('export async function createSponsorApplication')

  it.each(['checkSponsorEmailDomain(', 'compareDomains(', 'emailDomain(', 'websiteDomain('])(
    'calls %s only inside createSponsorApplication',
    (call) => {
      expect(sponsorActionStart).toBeGreaterThan(0)
      const indexes: number[] = []
      for (let i = source.indexOf(call); i !== -1; i = source.indexOf(call, i + 1)) indexes.push(i)
      expect(indexes.length).toBeGreaterThan(0)
      for (const i of indexes) expect(i).toBeGreaterThan(sponsorActionStart)
    }
  )
})
