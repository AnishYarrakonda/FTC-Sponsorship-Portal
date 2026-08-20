import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHash } from 'crypto'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const sendMock = vi.fn()
  const captureMock = vi.fn()
  // Per-table results for the mock admin client. Tests set these as needed.
  const tableResults: Record<string, { data?: unknown; error?: unknown }> = {}
  return { sendMock, captureMock, tableResults }
})

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: mocks.sendMock }
  },
}))

vi.mock('@sentry/nextjs', () => ({
  captureException: mocks.captureMock,
}))

vi.mock('@/lib/env', () => ({
  env: {
    RESEND_API_KEY: 'test-key',
    RESEND_FROM_EMAIL: 'portal@test.dev',
    NEXT_PUBLIC_APP_URL: 'https://portal.test',
    ADMIN_NOTIFICATION_EMAILS: 'admin@test.dev',
  },
}))

// Minimal chainable supabase mock: every fluent method returns the builder; the
// terminal single()/maybeSingle()/await resolves the configured table result.
function makeBuilder(table: string) {
  const result = () => mocks.tableResults[table] ?? { data: null, error: null }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {}
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'is', 'in', 'not', 'order', 'limit']) {
    b[m] = vi.fn(() => b)
  }
  b.single = vi.fn(async () => result())
  b.maybeSingle = vi.fn(async () => result())
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  b.then = (onFulfilled: any, onRejected: any) => Promise.resolve(result()).then(onFulfilled, onRejected)
  return b
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => makeBuilder(table),
  }),
}))

import {
  createInAppNotification,
  sendCoachSignupWelcomeEmail,
  sendCoachDenialEmail,
  sendHandshakeEmail,
  sendSponsorApplicationConfirmation,
  sendSubmissionDecisionEmail,
  sendWelcomeInAppNotification,
} from '@/lib/notify'
import { SUPPORT_EMAIL } from '@/lib/site-config'

const SEND_OK = { data: { id: 'email-1' }, error: null }

beforeEach(() => {
  mocks.sendMock.mockReset()
  mocks.captureMock.mockReset()
  for (const key of Object.keys(mocks.tableResults)) delete mocks.tableResults[key]
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

// ── Return contract: { success: boolean; error?: string }, never throws ───────

describe('notify return contract', () => {
  it('returns { success: true } when Resend accepts the email', async () => {
    mocks.sendMock.mockResolvedValue(SEND_OK)
    const result = await sendCoachSignupWelcomeEmail('coach@test.dev', 'Coach')
    expect(result).toEqual({ success: true })
  })

  it('returns { success: false, error } when Resend returns an error object', async () => {
    mocks.sendMock.mockResolvedValue({ data: null, error: { message: 'invalid from address' } })
    const result = await sendCoachDenialEmail('coach@test.dev', 'Coach', 'blurry ID')
    expect(result.success).toBe(false)
    expect(result.error).toBe('invalid from address')
    expect(mocks.captureMock).toHaveBeenCalled()
  })

  it('never throws — a rejected send resolves to { success: false }', async () => {
    mocks.sendMock.mockRejectedValue(new Error('network down'))
    const result = await sendCoachSignupWelcomeEmail('coach@test.dev', 'Coach')
    expect(result.success).toBe(false)
    expect(result.error).toBe('network down')
    expect(mocks.captureMock).toHaveBeenCalled()
  })

  it('sendSubmissionDecisionEmail fails cleanly when the submission is missing', async () => {
    mocks.tableResults.submissions = { data: null, error: null }
    const result = await sendSubmissionDecisionEmail('00000000-0000-0000-0000-000000000000', 'approved')
    expect(result.success).toBe(false)
    expect(mocks.sendMock).not.toHaveBeenCalled()
    expect(mocks.captureMock).toHaveBeenCalled()
  })
})

// ── replyTo: emails that invite a reply must not reply into the noreply@ void ──

describe('replyTo wiring', () => {
  it('sendCoachDenialEmail replies to the support inbox', async () => {
    mocks.sendMock.mockResolvedValue(SEND_OK)
    await sendCoachDenialEmail('coach@test.dev', 'Coach', 'blurry ID')
    expect(mocks.sendMock.mock.calls[0][0].replyTo).toBe(SUPPORT_EMAIL)
  })

  it('sendSponsorApplicationConfirmation replies to the support inbox', async () => {
    mocks.sendMock.mockResolvedValue(SEND_OK)
    await sendSponsorApplicationConfirmation('Acme', 'sponsor@test.dev', 'Sponsor', 500000)
    expect(mocks.sendMock.mock.calls[0][0].replyTo).toBe(SUPPORT_EMAIL)
  })
})

// ── createInAppNotification (dual-channel) ────────────────────────────────────

describe('createInAppNotification', () => {
  const base = {
    recipientId: 'profile-1',
    type: 'general' as const,
    title: 'Hello',
    body: 'World',
  }

  it('succeeds when both the inbox insert and the mirror email work', async () => {
    mocks.tableResults.notifications = { error: null }
    mocks.tableResults.profiles = { data: { email: 'coach@test.dev' }, error: null }
    mocks.sendMock.mockResolvedValue(SEND_OK)

    const result = await createInAppNotification(base)
    expect(result).toEqual({ success: true })
    expect(mocks.sendMock).toHaveBeenCalledTimes(1)
  })

  it('skipEmail short-circuits the mirror email', async () => {
    mocks.tableResults.notifications = { error: null }
    const result = await createInAppNotification({ ...base, skipEmail: true })
    expect(result).toEqual({ success: true })
    expect(mocks.sendMock).not.toHaveBeenCalled()
  })

  it('reports failure when the in-app insert errors (previously swallowed)', async () => {
    mocks.tableResults.notifications = { error: { message: 'insert denied' } }
    mocks.tableResults.profiles = { data: { email: 'coach@test.dev' }, error: null }
    mocks.sendMock.mockResolvedValue(SEND_OK)

    const result = await createInAppNotification(base)
    expect(result.success).toBe(false)
    expect(result.error).toContain('insert denied')
    // The email channel is still attempted.
    expect(mocks.sendMock).toHaveBeenCalledTimes(1)
  })

  it('reports failure when the mirror email fails but the insert succeeded', async () => {
    mocks.tableResults.notifications = { error: null }
    mocks.tableResults.profiles = { data: { email: 'coach@test.dev' }, error: null }
    mocks.sendMock.mockResolvedValue({ data: null, error: { message: 'rate limited' } })

    const result = await createInAppNotification(base)
    expect(result.success).toBe(false)
    expect(result.error).toContain('rate limited')
  })
})

// ── sendWelcomeInAppNotification: Clerk id → profile id resolution ────────────

describe('sendWelcomeInAppNotification', () => {
  it('resolves a Clerk user id to the profile uuid before inserting', async () => {
    // Regression: signup passes the Clerk id (`user_…`), but recipient_id is a
    // uuid FK to profiles(id) — inserting the raw Clerk id failed silently.
    mocks.tableResults.profiles = { data: { id: 'a0000000-0000-0000-0000-000000000001' }, error: null }
    mocks.tableResults.notifications = { error: null }

    const result = await sendWelcomeInAppNotification('user_2abcDEF', 'Coach')
    expect(result).toEqual({ success: true })
  })

  it('fails cleanly when no profile exists for the Clerk id', async () => {
    mocks.tableResults.profiles = { data: null, error: null }
    const result = await sendWelcomeInAppNotification('user_2missing', 'Coach')
    expect(result.success).toBe(false)
    expect(mocks.captureMock).toHaveBeenCalled()
  })
})

// ── Idempotency keys must stay exactly as-is ──────────────────────────────────

describe('sendHandshakeEmail idempotency', () => {
  it('sends both emails with the original sha256 idempotency keys', async () => {
    const submissionId = '11111111-1111-1111-1111-111111111111'
    mocks.tableResults.submissions = {
      data: {
        id: submissionId,
        team_id: 't1',
        sponsor_id: 's1',
        teams: {
          team_name: 'Exodius',
          ftc_team_number: 31579,
          profiles: { email: 'coach@test.dev', full_name: 'Coach' },
        },
        sponsors: { company_name: 'Acme', contact_email: 'sponsor@test.dev', contact_name: 'Sponsor' },
      },
      error: null,
    }
    mocks.sendMock.mockResolvedValue(SEND_OK)

    const result = await sendHandshakeEmail(submissionId, 50000)
    expect(result).toEqual({ success: true })
    expect(mocks.sendMock).toHaveBeenCalledTimes(2)

    const keys = mocks.sendMock.mock.calls.map((c) => c[1]?.idempotencyKey)
    expect(keys).toContain(createHash('sha256').update(submissionId + 'handshake-coach').digest('hex'))
    expect(keys).toContain(createHash('sha256').update(submissionId + 'handshake-sponsor').digest('hex'))
  })

  it('fails when either of the two sends fails', async () => {
    const submissionId = '11111111-1111-1111-1111-111111111111'
    mocks.tableResults.submissions = {
      data: {
        id: submissionId,
        teams: { team_name: 'Exodius', ftc_team_number: 31579, profiles: { email: 'coach@test.dev', full_name: 'Coach' } },
        sponsors: { company_name: 'Acme', contact_email: 'sponsor@test.dev', contact_name: 'Sponsor' },
      },
      error: null,
    }
    mocks.sendMock
      .mockResolvedValueOnce(SEND_OK)
      .mockResolvedValueOnce({ data: null, error: { message: 'sponsor mailbox rejected' } })

    const result = await sendHandshakeEmail(submissionId, 50000)
    expect(result.success).toBe(false)
    expect(result.error).toContain('sponsor mailbox rejected')
  })
})
