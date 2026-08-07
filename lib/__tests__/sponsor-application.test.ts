import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  insertMock: vi.fn(),
  getClientIpMock: vi.fn(),
  confirmationMock: vi.fn(),
  captureMock: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: mocks.rpcMock,
    from: () => ({ insert: mocks.insertMock }),
  }),
}))

vi.mock('@/lib/actions-utils', () => ({
  getClientIp: mocks.getClientIpMock,
  requireAdmin: vi.fn(),
}))

vi.mock('@/lib/notify', () => ({
  sendSponsorApplicationConfirmation: mocks.confirmationMock,
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

vi.mock('@sentry/nextjs', () => ({ captureException: mocks.captureMock }))

import { submitSponsorApplication } from '@/app/actions/sponsor'

const VALID_INPUT = {
  companyName: 'Acme Robotics',
  contactName: 'Jane Doe',
  contactEmail: 'Jane@Example.com',
  proposedCapCents: 100_000,
  message: 'We would love to sponsor local FTC teams.',
}

const RPC_ALLOWED = { data: true, error: null }
const RPC_BLOCKED = { data: false, error: null }

beforeEach(() => {
  mocks.rpcMock.mockReset().mockResolvedValue(RPC_ALLOWED)
  mocks.insertMock.mockReset().mockResolvedValue({ error: null })
  mocks.getClientIpMock.mockReset().mockResolvedValue('1.2.3.4')
  mocks.confirmationMock.mockReset().mockResolvedValue({ success: true })
  mocks.captureMock.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('submitSponsorApplication — honeypot', () => {
  it('silently no-ops (fake success) when the honeypot is filled', async () => {
    const result = await submitSponsorApplication({ ...VALID_INPUT, website2: 'http://spam.example' })
    expect(result).toEqual({ success: true })
    expect(mocks.rpcMock).not.toHaveBeenCalled()
    expect(mocks.insertMock).not.toHaveBeenCalled()
    expect(mocks.confirmationMock).not.toHaveBeenCalled()
  })

  it('treats an empty honeypot as a real submission', async () => {
    const result = await submitSponsorApplication({ ...VALID_INPUT, website2: '' })
    expect(result).toEqual({ success: true })
    expect(mocks.insertMock).toHaveBeenCalledTimes(1)
  })
})

describe('submitSponsorApplication — throttling', () => {
  it('rejects when the per-IP throttle is exceeded (3/hour)', async () => {
    mocks.rpcMock.mockResolvedValueOnce(RPC_BLOCKED)

    const result = await submitSponsorApplication(VALID_INPUT)
    expect(result).toEqual({ error: 'Too many applications from this network — please try again later.' })
    expect(mocks.rpcMock).toHaveBeenCalledWith('check_throttle', {
      p_key: 'sponsor-apply:1.2.3.4',
      p_limit: 3,
      p_window: '1 hour',
    })
    expect(mocks.insertMock).not.toHaveBeenCalled()
  })

  it('rejects when the per-email throttle is exceeded (2/day), keyed on the normalized email', async () => {
    mocks.rpcMock
      .mockResolvedValueOnce(RPC_ALLOWED)
      .mockResolvedValueOnce(RPC_BLOCKED)

    const result = await submitSponsorApplication(VALID_INPUT)
    expect(result).toEqual({ error: 'Too many applications for this email address — please try again later.' })
    expect(mocks.rpcMock).toHaveBeenLastCalledWith('check_throttle', {
      p_key: 'sponsor-apply-email:jane@example.com',
      p_limit: 2,
      p_window: '1 day',
    })
    expect(mocks.insertMock).not.toHaveBeenCalled()
  })

  it('fails OPEN when the throttle RPC itself errors (availability over strictness)', async () => {
    mocks.rpcMock.mockResolvedValue({ data: null, error: { message: 'function missing' } })

    const result = await submitSponsorApplication(VALID_INPUT)
    expect(result).toEqual({ success: true })
    expect(mocks.insertMock).toHaveBeenCalledTimes(1)
    expect(mocks.captureMock).toHaveBeenCalled()
  })
})

describe('submitSponsorApplication — happy path & validation', () => {
  it('inserts the application and sends the confirmation email', async () => {
    const result = await submitSponsorApplication(VALID_INPUT)
    expect(result).toEqual({ success: true })
    expect(mocks.insertMock).toHaveBeenCalledWith({
      company_name: 'Acme Robotics',
      contact_name: 'Jane Doe',
      // Lowercased by sponsorApplicationSchema as of the P1 email-case fix: profiles.email
      // is Clerk-lowercased and approveSponsorApplication links the two by equality, so a
      // raw "Jane@Example.com" matched zero rows and locked the sponsor out permanently.
      contact_email: 'jane@example.com',
      proposed_cap_cents: 100_000,
      message: VALID_INPUT.message,
    })
    expect(mocks.confirmationMock).toHaveBeenCalledTimes(1)
  })

  it('still succeeds when the confirmation email fails (application is saved)', async () => {
    mocks.confirmationMock.mockResolvedValue({ success: false, error: 'smtp down' })
    const result = await submitSponsorApplication(VALID_INPUT)
    expect(result).toEqual({ success: true })
  })

  it('rejects invalid input without touching the database', async () => {
    const result = await submitSponsorApplication({ ...VALID_INPUT, contactEmail: 'not-an-email' })
    expect(result).toEqual({ error: 'Invalid data provided' })
    expect(mocks.rpcMock).not.toHaveBeenCalled()
    expect(mocks.insertMock).not.toHaveBeenCalled()
  })

  it('returns a friendly mapped message when the insert fails (no raw pg error)', async () => {
    mocks.insertMock.mockResolvedValue({ error: { code: '23505', message: 'duplicate key value violates unique constraint "sponsor_applications_pkey"' } })
    const result = await submitSponsorApplication(VALID_INPUT)
    expect(result.error).toBeDefined()
    expect(result.error).not.toContain('duplicate key')
    expect(result.error).not.toContain('sponsor_applications')
  })
})
