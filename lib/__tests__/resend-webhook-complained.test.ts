import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Prompt 17 — Resend webhook: spam complaints.
 *
 * These drive the real route handler (app/api/webhooks/resend/route.ts) through a stateful
 * in-memory stand-in for the service-role client, in the same idiom as
 * sso-jit-provisioning.test.ts.
 *
 * The point of this file is mostly NEGATIVE assertions. `email.bounced` calls
 * `release_submission_reservation`, which subtracts the reservation from
 * `sponsors.funding_used_cents` and dead-ends the pitch. `email.complained` must never reach
 * that path, or the "Report spam" button in any recipient's mail client becomes a
 * capacity-release primitive. So: assert the audit row and the admin alert, and assert just
 * as hard that the status and the RPC were left alone.
 */

// ── Mocks ──────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>

const mocks = vi.hoisted(() => {
  const verifyMock = vi.fn()
  const notifyMock = vi.fn(
    async (_args: {
      recipientId: string
      type: string
      title: string
      body: string
      submissionId?: string
      skipEmail?: boolean
    }) => ({ success: true })
  )
  const rpcMock = vi.fn(async () => ({ data: null, error: null }))
  const tables: Record<string, Row[]> = {}
  return { verifyMock, notifyMock, rpcMock, tables }
})

vi.mock('svix', () => ({
  Webhook: class {
    verify = mocks.verifyMock
  },
}))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))
vi.mock('@/lib/env', () => ({ env: { RESEND_WEBHOOK_SECRET: 'whsec_test' } }))
vi.mock('@/lib/notify', () => ({ createInAppNotification: mocks.notifyMock }))

let idCounter = 0
function nextId(prefix: string) {
  idCounter += 1
  return `${prefix}-${idCounter}`
}

/** Chainable, stateful PostgREST stand-in supporting the subset the route uses. */
function makeBuilder(table: string) {
  const rows = () => (mocks.tables[table] ??= [])
  const filters: ((row: Row) => boolean)[] = []
  let pending: { kind: 'insert' | 'update'; payload?: Row } | null = null

  const matches = (row: Row) => filters.every((f) => f(row))

  function apply(): { data: Row[] } {
    if (!pending) return { data: rows().filter(matches) }
    if (pending.kind === 'insert') {
      const row = { id: nextId(table), ...pending.payload }
      rows().push(row)
      return { data: [row] }
    }
    const hits = rows().filter(matches)
    hits.forEach((r) => Object.assign(r, pending!.payload))
    return { data: hits }
  }

  const builder = {
    select: () => builder,
    limit: () => builder,
    order: () => builder,
    eq(col: string, value: unknown) {
      filters.push((row) => row[col] === value)
      return builder
    },
    is(col: string, value: unknown) {
      filters.push((row) => (row[col] ?? null) === value)
      return builder
    },
    in(col: string, values: unknown[]) {
      filters.push((row) => values.includes(row[col]))
      return builder
    },
    contains(col: string, value: Row) {
      filters.push((row) => {
        const actual = (row[col] ?? {}) as Row
        return Object.entries(value).every(([k, v]) => actual[k] === v)
      })
      return builder
    },
    insert(payload: Row) {
      pending = { kind: 'insert', payload }
      return builder
    },
    update(payload: Row) {
      pending = { kind: 'update', payload }
      return builder
    },
    async single() {
      const { data } = apply()
      return data.length ? { data: data[0], error: null } : { data: null, error: { message: 'no rows' } }
    },
    async maybeSingle() {
      const { data } = apply()
      return { data: data[0] ?? null, error: null }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    then(onFulfilled: any, onRejected: any) {
      const { data } = apply()
      return Promise.resolve({ data, error: null }).then(onFulfilled, onRejected)
    },
  }
  return builder
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => makeBuilder(table),
    rpc: mocks.rpcMock,
  }),
}))

import { POST } from '@/app/api/webhooks/resend/route'

// ── Fixtures ───────────────────────────────────────────────────────────────────

const SUBMISSION_ID = 'sub-1'
const EMAIL_ID = 'resend-email-abc'

function seed() {
  mocks.tables.submissions = [
    {
      id: SUBMISSION_ID,
      status: 'delivered',
      resend_message_id: EMAIL_ID,
      teams: { team_name: 'Exodius' },
      sponsors: { company_name: 'Acme Robotics' },
    },
  ]
  mocks.tables.audit_log = []
  mocks.tables.profiles = [
    { id: 'admin-1', role: 'admin' },
    { id: 'admin-2', role: 'admin' },
    { id: 'coach-1', role: 'coach' },
  ]
}

/**
 * `emailId` defaults to the submission's stored `resend_message_id`, exercising the primary
 * lookup. Pass `tagged` to exercise the `submission_id` tag fallback instead — that is the
 * only way a second, different message on the same submission is matched.
 */
function event(type: string, emailId = EMAIL_ID, tagged = false) {
  return new Request('https://portal.test/api/webhooks/resend', {
    method: 'POST',
    headers: { 'svix-id': 'msg_1', 'svix-timestamp': '1', 'svix-signature': 'v1,sig' },
    body: JSON.stringify({
      type,
      data: {
        email_id: emailId,
        ...(tagged ? { tags: [{ name: 'submission_id', value: SUBMISSION_ID }] } : {}),
      },
    }),
  })
}

const auditRows = () => mocks.tables.audit_log ?? []
const submission = () => mocks.tables.submissions[0]

beforeEach(() => {
  for (const key of Object.keys(mocks.tables)) delete mocks.tables[key]
  mocks.verifyMock.mockReset()
  mocks.notifyMock.mockClear()
  mocks.rpcMock.mockClear()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  seed()
})

// ── email.complained ───────────────────────────────────────────────────────────

describe('email.complained', () => {
  it('writes one audit row and alerts every admin', async () => {
    const res = await POST(event('email.complained'))

    expect(await res.json()).toEqual({ success: true, matched: true, complained: true })

    expect(auditRows()).toHaveLength(1)
    expect(auditRows()[0]).toMatchObject({
      actor_id: null,
      action: 'resend_webhook_email.complained',
      entity_type: 'submissions',
      entity_id: SUBMISSION_ID,
      metadata: { resend_email_id: EMAIL_ID, webhook_type: 'email.complained', new_status: null },
    })

    // One notification per admin — and not to the coach.
    expect(mocks.notifyMock).toHaveBeenCalledTimes(2)
    const recipients = mocks.notifyMock.mock.calls.map((c) => c[0].recipientId)
    expect(recipients.sort()).toEqual(['admin-1', 'admin-2'])

    // skipEmail must stay at its default so the alert also reaches an admin's mailbox.
    const first = mocks.notifyMock.mock.calls[0][0]
    expect(first.skipEmail).toBeUndefined()
    // The alert carries enough context to act on without opening the DB.
    expect(first.body).toContain('Acme Robotics')
    expect(first.body).toContain('Exodius')
  })

  it('does NOT release the reservation and does NOT change the submission status', async () => {
    await POST(event('email.complained'))

    // The guardrail this whole file exists for.
    expect(mocks.rpcMock).not.toHaveBeenCalled()
    expect(submission().status).toBe('delivered')
  })

  it('is deduped by the existing audit_log idempotency check on a svix retry', async () => {
    await POST(event('email.complained'))
    mocks.notifyMock.mockClear()

    const res = await POST(event('email.complained'))

    expect(await res.json()).toEqual({ success: true, duplicate: true })
    expect(auditRows()).toHaveLength(1)
    expect(mocks.notifyMock).not.toHaveBeenCalled()
  })

  it('still fires for a DIFFERENT message on the same submission', async () => {
    // The dedupe key is (action, entity_id, resend_email_id) — a genuinely separate
    // complaint on a re-dispatch must not be swallowed by the first one.
    await POST(event('email.complained'))
    await POST(event('email.complained', 'resend-email-xyz', true))

    expect(auditRows()).toHaveLength(2)
    expect(mocks.notifyMock).toHaveBeenCalledTimes(4)
  })

  it('still alerts admins when the complaint cannot be matched to a submission', async () => {
    // Most of what this product sends (notifications, welcome, receipts, nudges) has no
    // submission_id tag and no stored resend_message_id. Dropping those complaints would
    // mean dropping the majority of them.
    const res = await POST(event('email.complained', 'resend-email-unknown'))

    expect(await res.json()).toEqual({ success: true, matched: false, complained: true })
    expect(auditRows()).toHaveLength(1)
    expect(auditRows()[0]).toMatchObject({
      action: 'resend_webhook_email.complained',
      entity_type: 'emails',
      entity_id: null,
      metadata: { resend_email_id: 'resend-email-unknown' },
    })
    expect(mocks.notifyMock).toHaveBeenCalledTimes(2)
    // No submission to link the inbox alert to.
    expect(mocks.notifyMock.mock.calls[0][0]).not.toHaveProperty('submissionId')
    expect(mocks.rpcMock).not.toHaveBeenCalled()
  })

  it('dedupes a retried unmatched complaint', async () => {
    await POST(event('email.complained', 'resend-email-unknown'))
    mocks.notifyMock.mockClear()

    const res = await POST(event('email.complained', 'resend-email-unknown'))

    expect(await res.json()).toEqual({ success: true, duplicate: true })
    expect(auditRows()).toHaveLength(1)
    expect(mocks.notifyMock).not.toHaveBeenCalled()
  })

  it('an unmatched NON-complaint event is still just acknowledged', async () => {
    const res = await POST(event('email.bounced', 'resend-email-unknown'))

    expect(await res.json()).toEqual({ success: true, matched: false })
    expect(auditRows()).toHaveLength(0)
    expect(mocks.rpcMock).not.toHaveBeenCalled()
  })
})

// ── Untouched behaviour ────────────────────────────────────────────────────────

describe('events this slice must not change', () => {
  it('email.delivery_delayed is still skipped and writes nothing', async () => {
    const res = await POST(event('email.delivery_delayed'))

    expect(await res.json()).toEqual({ success: true, skipped: true })
    expect(auditRows()).toHaveLength(0)
    expect(mocks.notifyMock).not.toHaveBeenCalled()
    expect(mocks.rpcMock).not.toHaveBeenCalled()
    expect(submission().status).toBe('delivered')
  })

  it('email.bounced still releases the reservation', async () => {
    const res = await POST(event('email.bounced'))

    expect(await res.json()).toEqual({ success: true, matched: true, status: 'bounced' })
    expect(mocks.rpcMock).toHaveBeenCalledWith('release_submission_reservation', {
      p_submission_id: SUBMISSION_ID,
      p_new_status: 'bounced',
      p_reason: 'email_bounced',
    })
    expect(mocks.notifyMock).not.toHaveBeenCalled()
    expect(auditRows()[0]).toMatchObject({ action: 'resend_webhook_email.bounced' })
  })

  it('email.delivered still updates status, guarded to live states', async () => {
    await POST(event('email.delivered'))
    expect(submission().status).toBe('delivered')

    // A late tracking event must never overwrite a terminal state.
    submission().status = 'approved'
    mocks.tables.audit_log = []
    await POST(event('email.opened'))
    expect(submission().status).toBe('approved')
  })

  it('an unsigned payload is rejected with 400', async () => {
    mocks.verifyMock.mockImplementation(() => {
      throw new Error('No matching signature found')
    })

    const res = await POST(event('email.complained'))

    expect(res.status).toBe(400)
    expect(auditRows()).toHaveLength(0)
    expect(mocks.notifyMock).not.toHaveBeenCalled()
  })
})
