import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Action-level tests for the Q&A thread (0085).
 *
 * The database enforces liveness, thread-opening and the per-thread cap in a BEFORE INSERT
 * trigger, which no unit test can exercise — those are covered by the SQL checks in
 * tests/e2e and by the acceptance criteria. What IS covered here is everything the actions
 * are solely responsible for: the moderation asymmetry, the throttle's fail-open behaviour,
 * the token never being consumed, and no message body ever reaching audit_log.
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>

const mocks = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  tables: {} as Record<string, {
    select?: unknown
    insert?: unknown
    update?: unknown
    count?: number
  }>,
  inserts: [] as { table: string; payload: Row }[],
  updates: [] as { table: string; payload: Row }[],
  notifyMock: vi.fn(),
  threadEmailMock: vi.fn(),
  requireSponsorRoleMock: vi.fn(),
  requireVerifiedCoachMock: vi.fn(),
  requireAdminMock: vi.fn(),
  requireAuthMock: vi.fn(),
  getClientIpMock: vi.fn(),
}))

/**
 * Minimal chainable stub. Every terminal (`single`, `maybeSingle`, `then`) resolves to
 * whatever `mocks.tables[table]` declares for the operation that was invoked.
 */
function makeBuilder(table: string) {
  let op: 'select' | 'insert' | 'update' = 'select'
  let payload: Row = {}
  let wantCount = false

  const resolve = () => {
    const cfg = mocks.tables[table] ?? {}
    if (op === 'insert') {
      mocks.inserts.push({ table, payload })
      return Promise.resolve({ data: cfg.insert ?? { id: `${table}-new` }, error: null })
    }
    if (op === 'update') {
      mocks.updates.push({ table, payload })
      return Promise.resolve({ data: cfg.update ?? [], error: null })
    }
    if (wantCount) return Promise.resolve({ data: null, error: null, count: cfg.count ?? 0 })
    return Promise.resolve({ data: cfg.select ?? null, error: null })
  }

  const builder: Record<string, unknown> = {
    select: (_c?: string, o?: { count?: string; head?: boolean }) => {
      if (o?.count) wantCount = true
      return builder
    },
    insert: (p: Row) => { op = 'insert'; payload = p; return builder },
    update: (p: Row) => { op = 'update'; payload = p; return builder },
    eq: () => builder,
    in: () => builder,
    is: () => builder,
    not: () => builder,
    gt: () => builder,
    or: () => builder,
    order: () => builder,
    limit: () => builder,
    single: () => resolve(),
    maybeSingle: () => resolve(),
    then: (f: (v: unknown) => unknown, r?: (e: unknown) => unknown) => resolve().then(f, r),
  }
  return builder
}

const adminClient = {
  rpc: mocks.rpcMock,
  from: (table: string) => makeBuilder(table),
}

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => adminClient }))

vi.mock('@/lib/actions-utils', () => ({
  requireSponsorRole: mocks.requireSponsorRoleMock,
  requireVerifiedCoach: mocks.requireVerifiedCoachMock,
  requireAdmin: mocks.requireAdminMock,
  requireAuth: mocks.requireAuthMock,
  getClientIp: mocks.getClientIpMock,
}))

vi.mock('@/lib/notify', () => ({
  createInAppNotification: mocks.notifyMock,
  sendThreadMessageEmail: mocks.threadEmailMock,
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

import {
  postSponsorQuestion,
  postCoachReply,
  releaseCoachReply,
  postSponsorQuestionByToken,
} from '@/app/actions/messages'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SPONSOR_ID = '11111111-1111-4111-8111-111111111111'
const SUBMISSION_ID = '22222222-2222-4222-8222-222222222222'
const COACH_ID = '33333333-3333-4333-8333-333333333333'
const SPONSOR_USER_ID = '44444444-4444-4444-8444-444444444444'
const ADMIN_ID = '55555555-5555-4555-8555-555555555555'
const MESSAGE_ID = '66666666-6666-4666-8666-666666666666'
const TOKEN_ID = '77777777-7777-4777-8777-777777777777'

const inTwoWeeks = () => new Date(Date.now() + 12 * 864e5).toISOString()
const yesterday = () => new Date(Date.now() - 864e5).toISOString()

function liveSubmission(over: Row = {}) {
  return {
    id: SUBMISSION_ID,
    sponsor_id: SPONSOR_ID,
    status: 'dispatched',
    expires_at: inTwoWeeks(),
    deleted_at: null,
    teams: { owner_id: COACH_ID, team_name: 'Exodius' },
    ...over,
  }
}

function messageInserts() {
  return mocks.inserts.filter((i) => i.table === 'submission_messages')
}
function auditInserts() {
  return mocks.inserts.filter((i) => i.table === 'audit_log')
}

beforeEach(() => {
  mocks.tables = {}
  mocks.inserts = []
  mocks.updates = []
  mocks.rpcMock.mockReset().mockResolvedValue({ data: true, error: null })
  mocks.notifyMock.mockReset().mockResolvedValue({ success: true })
  mocks.threadEmailMock.mockReset().mockResolvedValue({ success: true })
  mocks.getClientIpMock.mockReset().mockResolvedValue('1.2.3.4')

  // requireSponsorRole('submitter') — a `viewer` is read-only under 0083 and may not send
  // a message that reaches a coach carrying the company's name.
  mocks.requireSponsorRoleMock.mockReset().mockResolvedValue({
    user: { id: SPONSOR_USER_ID, full_name: 'Dana Cole' },
    sponsorId: SPONSOR_ID,
    sponsorIds: [SPONSOR_ID],
    memberRole: 'submitter',
    adminClient,
  })
  mocks.requireVerifiedCoachMock.mockReset().mockResolvedValue({
    user: { id: COACH_ID, full_name: 'Maria Gomez' },
  })
  mocks.requireAdminMock.mockReset().mockResolvedValue({
    user: { id: ADMIN_ID, full_name: 'Dev Admin' },
    adminClient,
  })
  mocks.requireAuthMock.mockReset().mockResolvedValue({ user: { id: COACH_ID } })

  vi.spyOn(console, 'error').mockImplementation(() => {})
})

// ── Moderation asymmetry ──────────────────────────────────────────────────────

describe('moderation asymmetry', () => {
  it('postSponsorQuestion inserts a RELEASED message', async () => {
    mocks.tables.submissions = { select: liveSubmission() }
    mocks.tables.sponsors = { select: { company_name: 'Acme Robotics', contact_name: 'Dana Cole' } }

    const result = await postSponsorQuestion({ submissionId: SUBMISSION_ID, body: 'Is the EIN the district?' })

    expect(result).toEqual({ success: true })
    expect(messageInserts()).toHaveLength(1)
    expect(messageInserts()[0].payload).toMatchObject({
      status: 'released',
      author_role: 'sponsor',
      author_profile_id: SPONSOR_USER_ID,
    })
    expect(messageInserts()[0].payload.released_at).toBeTruthy()
  })

  it('postCoachReply inserts a PENDING message and reports it as pending', async () => {
    mocks.tables.submissions = { select: liveSubmission() }
    mocks.tables.submission_messages = { count: 1 }

    const result = await postCoachReply({ submissionId: SUBMISSION_ID, body: 'A separate booster club.' })

    expect(result).toEqual({ success: true, pending: true })
    expect(messageInserts()).toHaveLength(1)
    expect(messageInserts()[0].payload).toMatchObject({
      status: 'pending',
      author_role: 'coach',
      author_profile_id: COACH_ID,
    })
  })
})

// ── A coach cannot open a thread ──────────────────────────────────────────────

describe('postCoachReply — a coach can never open a thread', () => {
  it('errors and writes nothing when no sponsor message exists', async () => {
    mocks.tables.submissions = { select: liveSubmission() }
    mocks.tables.submission_messages = { count: 0 }

    const result = await postCoachReply({ submissionId: SUBMISSION_ID, body: 'Hello, please fund us!' })

    expect(result.error).toMatch(/only reply after the sponsor/i)
    expect(messageInserts()).toHaveLength(0)
  })
})

// ── Liveness ──────────────────────────────────────────────────────────────────

describe('postCoachReply — liveness', () => {
  for (const status of ['declined', 'expired', 'approved', 'pending', 'draft']) {
    it(`errors and writes nothing on a ${status} submission`, async () => {
      mocks.tables.submissions = { select: liveSubmission({ status }) }
      mocks.tables.submission_messages = { count: 1 }

      const result = await postCoachReply({ submissionId: SUBMISSION_ID, body: 'A late reply here.' })

      expect(result.error).toMatch(/no longer awaiting a sponsor decision/i)
      expect(messageInserts()).toHaveLength(0)
    })
  }

  it('errors and writes nothing past expires_at', async () => {
    mocks.tables.submissions = { select: liveSubmission({ expires_at: yesterday() }) }
    mocks.tables.submission_messages = { count: 1 }

    const result = await postCoachReply({ submissionId: SUBMISSION_ID, body: 'A reply after the window.' })

    expect(result.error).toMatch(/14-day window/i)
    expect(messageInserts()).toHaveLength(0)
  })

  it('rejects a submission belonging to another coach', async () => {
    mocks.tables.submissions = { select: liveSubmission({ teams: { owner_id: 'someone-else' } }) }

    const result = await postCoachReply({ submissionId: SUBMISSION_ID, body: 'Not my pitch at all.' })

    expect(result.error).toBe('Proposal not found.')
    expect(messageInserts()).toHaveLength(0)
  })

  it('rejects a submission belonging to another sponsor', async () => {
    mocks.tables.submissions = { select: liveSubmission({ sponsor_id: 'another-sponsor' }) }

    const result = await postSponsorQuestion({ submissionId: SUBMISSION_ID, body: 'Whose pitch is this?' })

    expect(result.error).toBe('Proposal not found.')
    expect(messageInserts()).toHaveLength(0)
  })
})

// ── Throttling ────────────────────────────────────────────────────────────────

describe('throttle', () => {
  it('blocks and does not insert when check_throttle resolves false', async () => {
    mocks.tables.submissions = { select: liveSubmission() }
    mocks.tables.submission_messages = { count: 1 }
    mocks.rpcMock.mockResolvedValue({ data: false, error: null })

    const result = await postCoachReply({ submissionId: SUBMISSION_ID, body: 'One more question here.' })

    expect(result.error).toMatch(/lot of messages/i)
    expect(messageInserts()).toHaveLength(0)
  })

  it('FAILS OPEN — still inserts when the throttle RPC errors', async () => {
    mocks.tables.submissions = { select: liveSubmission() }
    mocks.tables.submission_messages = { count: 1 }
    mocks.rpcMock.mockResolvedValue({ data: null, error: { message: 'throttle table gone' } })

    const result = await postCoachReply({ submissionId: SUBMISSION_ID, body: 'Throttle is down right now.' })

    expect(result).toEqual({ success: true, pending: true })
    expect(messageInserts()).toHaveLength(1)
  })
})

// ── Release ───────────────────────────────────────────────────────────────────

describe('releaseCoachReply', () => {
  it('returns "already handled" and sends zero emails when the guarded update matches nothing', async () => {
    mocks.tables.submission_messages = { update: [] }

    const result = await releaseCoachReply({ messageId: MESSAGE_ID })

    expect(result.error).toBe('This message was already handled.')
    expect(mocks.threadEmailMock).not.toHaveBeenCalled()
    expect(mocks.notifyMock).not.toHaveBeenCalled()
  })

  it('fans out to every sponsor profile and sends exactly one email', async () => {
    mocks.tables.submission_messages = {
      update: [{ id: MESSAGE_ID, submission_id: SUBMISSION_ID }],
    }
    mocks.tables.submissions = { select: { sponsor_id: SPONSOR_ID } }
    mocks.tables.profiles = { select: [{ id: 'sp-user-1' }, { id: 'sp-user-2' }] }

    const result = await releaseCoachReply({ messageId: MESSAGE_ID })

    expect(result).toEqual({ success: true })
    expect(mocks.notifyMock).toHaveBeenCalledTimes(2)
    // skipEmail, because sendThreadMessageEmail is the richer template.
    expect(mocks.notifyMock.mock.calls[0][0]).toMatchObject({ skipEmail: true, type: 'general' })
    expect(mocks.threadEmailMock).toHaveBeenCalledTimes(1)
    expect(mocks.threadEmailMock).toHaveBeenCalledWith(MESSAGE_ID)
  })

  it('stamps the reviewer on the released row', async () => {
    mocks.tables.submission_messages = {
      update: [{ id: MESSAGE_ID, submission_id: SUBMISSION_ID }],
    }
    mocks.tables.submissions = { select: { sponsor_id: SPONSOR_ID } }
    mocks.tables.profiles = { select: [] }

    await releaseCoachReply({ messageId: MESSAGE_ID })

    const update = mocks.updates.find((u) => u.table === 'submission_messages')
    expect(update?.payload).toMatchObject({ status: 'released', released_by: ADMIN_ID })
  })
})

// ── The token path ────────────────────────────────────────────────────────────

describe('postSponsorQuestionByToken', () => {
  const liveToken = {
    id: TOKEN_ID,
    submission_id: SUBMISSION_ID,
    used_at: null,
    revoked_at: null,
    expires_at: inTwoWeeks(),
  }

  it('NEVER writes used_at — asking a question must not cost the sponsor their decision', async () => {
    mocks.tables.submission_access_tokens = { select: liveToken }
    mocks.tables.submissions = { select: liveSubmission() }
    mocks.tables.sponsors = { select: { company_name: 'Acme Robotics', contact_name: 'Dana Cole' } }

    const result = await postSponsorQuestionByToken({ token: 'raw-token', body: 'Quick question for you.' })

    expect(result).toEqual({ success: true })
    expect(mocks.updates.filter((u) => u.table === 'submission_access_tokens')).toHaveLength(0)
    expect(mocks.inserts.filter((i) => i.table === 'submission_access_tokens')).toHaveLength(0)
  })

  it('attributes to the token, not a profile, and audits with a null actor', async () => {
    mocks.tables.submission_access_tokens = { select: liveToken }
    mocks.tables.submissions = { select: liveSubmission() }
    mocks.tables.sponsors = { select: { company_name: 'Acme Robotics', contact_name: 'Dana Cole' } }

    await postSponsorQuestionByToken({ token: 'raw-token', body: 'Quick question for you.' })

    expect(messageInserts()[0].payload).toMatchObject({
      author_token_id: TOKEN_ID,
      author_profile_id: null,
      author_role: 'sponsor',
      status: 'released',
    })
    expect(auditInserts()[0].payload).toMatchObject({ actor_id: null })
  })

  for (const [label, token] of [
    ['used', { ...liveToken, used_at: yesterday() }],
    ['revoked', { ...liveToken, revoked_at: yesterday() }],
    ['expired', { ...liveToken, expires_at: yesterday() }],
  ] as const) {
    it(`refuses a ${label} token and writes nothing`, async () => {
      mocks.tables.submission_access_tokens = { select: token }
      mocks.tables.submissions = { select: liveSubmission() }

      const result = await postSponsorQuestionByToken({ token: 'raw-token', body: 'Quick question for you.' })

      expect(result.error).toBe('This link is no longer active.')
      expect(messageInserts()).toHaveLength(0)
    })
  }
})

// ── COPPA: no bodies in audit_log ─────────────────────────────────────────────

describe('audit_log never carries a message body', () => {
  const SECRET = 'This body must never reach the audit log at all.'

  it('postSponsorQuestion', async () => {
    mocks.tables.submissions = { select: liveSubmission() }
    mocks.tables.sponsors = { select: { company_name: 'Acme Robotics' } }

    await postSponsorQuestion({ submissionId: SUBMISSION_ID, body: SECRET })

    expect(JSON.stringify(auditInserts())).not.toContain(SECRET)
    expect(auditInserts()[0].payload.metadata).toEqual({ submission_id: SUBMISSION_ID })
  })

  it('postCoachReply', async () => {
    mocks.tables.submissions = { select: liveSubmission() }
    mocks.tables.submission_messages = { count: 1 }

    await postCoachReply({ submissionId: SUBMISSION_ID, body: SECRET })

    expect(JSON.stringify(auditInserts())).not.toContain(SECRET)
  })

  it('postSponsorQuestionByToken', async () => {
    mocks.tables.submission_access_tokens = {
      select: { id: TOKEN_ID, submission_id: SUBMISSION_ID, used_at: null, revoked_at: null, expires_at: inTwoWeeks() },
    }
    mocks.tables.submissions = { select: liveSubmission() }
    mocks.tables.sponsors = { select: { company_name: 'Acme Robotics' } }

    await postSponsorQuestionByToken({ token: 'raw-token', body: SECRET })

    expect(JSON.stringify(auditInserts())).not.toContain(SECRET)
  })
})

// ── Validation ────────────────────────────────────────────────────────────────

describe('validation', () => {
  it('rejects a body under 5 characters without touching the database', async () => {
    const result = await postSponsorQuestion({ submissionId: SUBMISSION_ID, body: 'hi' })
    expect(result.error).toMatch(/Validation failed/)
    expect(mocks.inserts).toHaveLength(0)
  })

  it('strips HTML — an <img> tag cannot survive into a stored body (COPPA)', async () => {
    mocks.tables.submissions = { select: liveSubmission() }
    mocks.tables.sponsors = { select: { company_name: 'Acme Robotics' } }

    await postSponsorQuestion({
      submissionId: SUBMISSION_ID,
      body: 'Here is our team <img src="https://example.com/students.jpg"> photo.',
    })

    const stored = messageInserts()[0]?.payload.body as string
    expect(stored).not.toContain('<img')
    expect(stored).not.toContain('students.jpg')
  })
})
