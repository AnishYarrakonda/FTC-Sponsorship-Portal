import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Action-level tests for coach appeals (0086).
 *
 * The database independently enforces the 30-day window, the legal transitions, the
 * one-appeal-per-decision index and the self-review CHECK (verified with psql against the
 * live schema). What is covered here is what the ACTIONS alone are responsible for:
 * subject eligibility, the soft different-reviewer rule, subject-effect-before-resolution,
 * and the two overturn behaviours.
 */

type Row = Record<string, unknown>

const mocks = vi.hoisted(() => ({
  tables: {} as Record<string, { select?: unknown; update?: unknown; insert?: unknown }>,
  inserts: [] as { table: string; payload: Row }[],
  updates: [] as { table: string; payload: Row }[],
  insertErrors: {} as Record<string, { code?: string; message: string } | null>,
  updateErrors: {} as Record<string, { code?: string; message: string } | null>,
  notifyMock: vi.fn(),
  requireAuthMock: vi.fn(),
  requireAdminMock: vi.fn(),
  requireSuperAdminMock: vi.fn(),
  overrideTeamVerificationMock: vi.fn(),
}))

function makeBuilder(table: string) {
  let op: 'select' | 'insert' | 'update' = 'select'
  let payload: Row = {}

  const resolve = () => {
    const cfg = mocks.tables[table] ?? {}
    if (op === 'insert') {
      const err = mocks.insertErrors[table] ?? null
      if (!err) mocks.inserts.push({ table, payload })
      return Promise.resolve({ data: err ? null : (cfg.insert ?? { id: `${table}-new` }), error: err })
    }
    if (op === 'update') {
      const err = mocks.updateErrors[table] ?? null
      if (!err) mocks.updates.push({ table, payload })
      return Promise.resolve({ data: err ? null : (cfg.update ?? []), error: err })
    }
    // A function lets one table answer successive reads differently — createAppeal reads the
    // verification record, then reads the latest record for the same team number.
    const sel = typeof cfg.select === 'function' ? (cfg.select as () => unknown)() : cfg.select
    return Promise.resolve({ data: sel ?? null, error: null })
  }

  const b: Record<string, unknown> = {
    select: () => b,
    insert: (p: Row) => { op = 'insert'; payload = p; return b },
    update: (p: Row) => { op = 'update'; payload = p; return b },
    eq: () => b, in: () => b, is: () => b, not: () => b, gt: () => b, or: () => b,
    order: () => b, limit: () => b,
    single: () => resolve(),
    maybeSingle: () => resolve(),
    then: (f: (v: unknown) => unknown, r?: (e: unknown) => unknown) => resolve().then(f, r),
  }
  return b
}

const adminClient = { from: (t: string) => makeBuilder(t), rpc: vi.fn() }

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => adminClient }))
vi.mock('@/lib/actions-utils', () => ({
  requireAuth: mocks.requireAuthMock,
  requireAdmin: mocks.requireAdminMock,
  requireSuperAdmin: mocks.requireSuperAdminMock,
}))
vi.mock('@/lib/notify', () => ({ createInAppNotification: mocks.notifyMock }))
// resolveAppeal delegates the team_verification subject effect to this action rather than
// re-implementing the override. Mocked so these stay action-level tests of appeals.ts.
vi.mock('@/app/actions/admin', () => ({ overrideTeamVerification: mocks.overrideTeamVerificationMock }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

import { createAppeal, assignAppeal, resolveAppeal, withdrawAppeal } from '@/app/actions/appeals'

const COACH_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_COACH = '99999999-9999-4999-8999-999999999999'
const SUBMISSION_ID = '22222222-2222-4222-8222-222222222222'
const APPEAL_ID = '33333333-3333-4333-8333-333333333333'
const ADMIN_A = '44444444-4444-4444-8444-444444444444'
const ADMIN_B = '55555555-5555-4555-8555-555555555555'

const VERIFICATION_ID = '66666666-6666-4666-8666-666666666666'

const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString()

const VALID_STATEMENT =
  'The travel budget line was flagged as unclear, but the itemised quote was attached to the pitch and I would like it reconsidered.'
const VALID_NOTES = 'Reviewed the attached quote; the original decision was made in error.'

function declinedSubmission(over: Row = {}) {
  return {
    id: SUBMISSION_ID,
    status: 'declined',
    sent_at: null, // admin-stage decline
    reviewed_at: daysAgo(3),
    reviewed_by: ADMIN_A,
    deleted_at: null,
    admin_feedback: 'Budget unclear.',
    teams: { owner_id: COACH_ID },
    ...over,
  }
}

function rejectedVerification(over: Row = {}) {
  return {
    id: VERIFICATION_ID,
    team_id: null,
    profile_id: COACH_ID,
    ftc_team_number: 12345,
    outcome: 'rejected',
    checked_at: daysAgo(3),
    overridden_by: null,
    teams: null,
    ...over,
  }
}

function appealInserts() { return mocks.inserts.filter((i) => i.table === 'appeals') }
function appealUpdates() { return mocks.updates.filter((u) => u.table === 'appeals') }
function submissionUpdates() { return mocks.updates.filter((u) => u.table === 'submissions') }
function profileUpdates() { return mocks.updates.filter((u) => u.table === 'profiles') }
function auditInserts() { return mocks.inserts.filter((i) => i.table === 'audit_log') }

beforeEach(() => {
  mocks.tables = {}
  mocks.inserts = []
  mocks.updates = []
  mocks.insertErrors = {}
  mocks.updateErrors = {}
  mocks.notifyMock.mockReset().mockResolvedValue({ success: true })
  mocks.requireAuthMock.mockReset().mockResolvedValue({ user: { id: COACH_ID, role: 'coach' } })
  mocks.requireAdminMock.mockReset().mockResolvedValue({ user: { id: ADMIN_B, role: 'admin' }, adminClient })
  mocks.requireSuperAdminMock.mockReset().mockResolvedValue({ user: { id: ADMIN_B }, adminClient })
  mocks.overrideTeamVerificationMock.mockReset().mockResolvedValue({ success: true })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

// ── createAppeal: subject eligibility ─────────────────────────────────────────

describe('createAppeal — subject eligibility', () => {
  it('rejects a pitch that is not declined, and writes nothing', async () => {
    mocks.tables.submissions = { select: declinedSubmission({ status: 'pending' }) }
    const r = await createAppeal({ subjectType: 'submission', subjectId: SUBMISSION_ID, statement: VALID_STATEMENT })
    expect(r.error).toMatch(/only a declined pitch/i)
    expect(appealInserts()).toHaveLength(0)
  })

  it('rejects a SPONSOR-declined pitch (sent_at set), and writes nothing', async () => {
    mocks.tables.submissions = { select: declinedSubmission({ sent_at: daysAgo(10) }) }
    const r = await createAppeal({ subjectType: 'submission', subjectId: SUBMISSION_ID, statement: VALID_STATEMENT })
    expect(r.error).toMatch(/declined by the sponsor/i)
    expect(appealInserts()).toHaveLength(0)
  })

  it("rejects another coach's pitch, and writes nothing", async () => {
    mocks.tables.submissions = { select: declinedSubmission({ teams: { owner_id: OTHER_COACH } }) }
    const r = await createAppeal({ subjectType: 'submission', subjectId: SUBMISSION_ID, statement: VALID_STATEMENT })
    expect(r.error).toBe('Pitch not found.')
    expect(appealInserts()).toHaveLength(0)
  })

  it('accepts a rejected team number check, stamping checked_at as the decision date', async () => {
    const checkedAt = daysAgo(3)
    // Both the record read and the latest-for-this-number read resolve to the same row.
    mocks.tables.team_verification_records = { select: rejectedVerification({ checked_at: checkedAt }) }
    const r = await createAppeal({ subjectType: 'team_verification', subjectId: VERIFICATION_ID, statement: VALID_STATEMENT })
    expect(r.error).toBeUndefined()
    expect(appealInserts()).toHaveLength(1)
    expect(appealInserts()[0].payload).toMatchObject({
      subject_type: 'team_verification',
      subject_id: VERIFICATION_ID,
      decision_at: checkedAt,
      // The matcher rejected it, not a person — so the different-reviewer rule must not
      // pin the appeal to an admin who never touched it.
      original_decider_id: null,
    })
  })

  it('refuses a rejected check that a NEWER check for the same number has superseded', async () => {
    const reads = [rejectedVerification(), { id: 'a-newer-record-id' }]
    mocks.tables.team_verification_records = { select: () => reads.shift() ?? null }
    const r = await createAppeal({ subjectType: 'team_verification', subjectId: VERIFICATION_ID, statement: VALID_STATEMENT })
    expect(r.error).toMatch(/superseded/i)
    expect(appealInserts()).toHaveLength(0)
  })

  it("rejects another coach's team number check, and writes nothing", async () => {
    mocks.tables.team_verification_records = {
      select: rejectedVerification({ profile_id: OTHER_COACH, teams: { owner_id: OTHER_COACH } }),
    }
    const r = await createAppeal({ subjectType: 'team_verification', subjectId: VERIFICATION_ID, statement: VALID_STATEMENT })
    expect(r.error).toBe('Verification check not found.')
    expect(appealInserts()).toHaveLength(0)
  })

  it('rejects a check that is needs_review rather than rejected, and writes nothing', async () => {
    mocks.tables.team_verification_records = { select: rejectedVerification({ outcome: 'needs_review' }) }
    const r = await createAppeal({ subjectType: 'team_verification', subjectId: VERIFICATION_ID, statement: VALID_STATEMENT })
    expect(r.error).toMatch(/was not rejected/i)
    expect(appealInserts()).toHaveLength(0)
  })

  it('rejects a decision older than 30 days, naming the closing date, and writes nothing', async () => {
    const decidedAt = daysAgo(40)
    mocks.tables.submissions = { select: declinedSubmission({ reviewed_at: decidedAt }) }
    const r = await createAppeal({ subjectType: 'submission', subjectId: SUBMISSION_ID, statement: VALID_STATEMENT })
    expect(r.error).toMatch(/closed on/i)
    const expected = new Date(new Date(decidedAt).getTime() + 30 * 864e5).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    })
    expect(r.error).toContain(expected)
    expect(appealInserts()).toHaveLength(0)
  })

  it('maps 23505 to the already-appealed message', async () => {
    mocks.tables.submissions = { select: declinedSubmission() }
    mocks.insertErrors.appeals = { code: '23505', message: 'duplicate key' }
    const r = await createAppeal({ subjectType: 'submission', subjectId: SUBMISSION_ID, statement: VALID_STATEMENT })
    expect(r.error).toBe('You have already appealed this decision.')
  })

  it('files a valid appeal at status open and never logs the statement text', async () => {
    mocks.tables.submissions = { select: declinedSubmission() }
    mocks.tables.appeals = { insert: { id: APPEAL_ID } }
    mocks.tables.profiles = { select: [] }

    const r = await createAppeal({ subjectType: 'submission', subjectId: SUBMISSION_ID, statement: VALID_STATEMENT })

    expect(r).toEqual({ success: true })
    expect(appealInserts()[0].payload).toMatchObject({
      status: 'open',
      subject_type: 'submission',
      appellant_profile_id: COACH_ID,
      original_decider_id: ADMIN_A,
    })
    expect(JSON.stringify(auditInserts())).not.toContain(VALID_STATEMENT)
  })

  it('refuses a non-coach caller', async () => {
    mocks.requireAuthMock.mockResolvedValue({ user: { id: ADMIN_A, role: 'admin' } })
    const r = await createAppeal({ subjectType: 'submission', subjectId: SUBMISSION_ID, statement: VALID_STATEMENT })
    expect(r.error).toBe('Only a coach can file an appeal.')
    expect(appealInserts()).toHaveLength(0)
  })
})

// ── The soft different-reviewer rule ──────────────────────────────────────────

describe('assignAppeal — the different-reviewer rule', () => {
  it('ACCEPTANCE: assigning the original decider with no reason returns requiresOverride and writes NOTHING', async () => {
    mocks.requireAdminMock.mockResolvedValue({ user: { id: ADMIN_A, role: 'admin' }, adminClient })
    mocks.tables.appeals = { select: { id: APPEAL_ID, status: 'open', original_decider_id: ADMIN_A, appellant_profile_id: COACH_ID } }
    mocks.tables.profiles = { select: { id: ADMIN_A, role: 'admin' } }

    const r = await assignAppeal({ appealId: APPEAL_ID, reviewerId: ADMIN_A })

    expect(r.requiresOverride).toBe(true)
    expect(r.warning).toMatch(/written reason/i)
    expect(appealUpdates()).toHaveLength(0)
    expect(mocks.updates).toHaveLength(0)
    expect(mocks.inserts).toHaveLength(0)
  })

  it('a REVIEWER supplying a reason is Forbidden, and writes nothing', async () => {
    mocks.requireAdminMock.mockResolvedValue({ user: { id: ADMIN_A, role: 'admin' }, adminClient })
    mocks.requireSuperAdminMock.mockRejectedValue(Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' }))
    mocks.tables.appeals = { select: { id: APPEAL_ID, status: 'open', original_decider_id: ADMIN_A, appellant_profile_id: COACH_ID } }
    mocks.tables.profiles = { select: { id: ADMIN_A, role: 'admin' } }

    const r = await assignAppeal({
      appealId: APPEAL_ID,
      reviewerId: ADMIN_A,
      overrideReason: 'I am the only administrator on this deployment right now.',
    })

    expect(r.error).toBe('Forbidden')
    expect(mocks.updates).toHaveLength(0)
  })

  it('a SUPER ADMIN supplying a reason succeeds and writes an appeal_self_review_override audit row', async () => {
    mocks.requireAdminMock.mockResolvedValue({ user: { id: ADMIN_A, role: 'admin' }, adminClient })
    mocks.tables.appeals = {
      select: { id: APPEAL_ID, status: 'open', original_decider_id: ADMIN_A, appellant_profile_id: COACH_ID },
      update: [{ id: APPEAL_ID, appellant_profile_id: COACH_ID }],
    }
    mocks.tables.profiles = { select: { id: ADMIN_A, role: 'admin' } }
    const reason = 'I am the only administrator on this deployment right now.'

    const r = await assignAppeal({ appealId: APPEAL_ID, reviewerId: ADMIN_A, overrideReason: reason })

    expect(r).toEqual({ success: true })
    expect(appealUpdates()[0].payload).toMatchObject({ status: 'under_review', override_reason: reason })
    expect(auditInserts().map((a) => a.payload.action)).toContain('appeal_self_review_override')
  })

  it('assigning a DIFFERENT admin needs no reason', async () => {
    mocks.tables.appeals = {
      select: { id: APPEAL_ID, status: 'open', original_decider_id: ADMIN_A, appellant_profile_id: COACH_ID },
      update: [{ id: APPEAL_ID, appellant_profile_id: COACH_ID }],
    }
    mocks.tables.profiles = { select: { id: ADMIN_B, role: 'admin' } }
    const r = await assignAppeal({ appealId: APPEAL_ID, reviewerId: ADMIN_B })
    expect(r).toEqual({ success: true })
    expect(appealUpdates()[0].payload).toMatchObject({ status: 'under_review' })
    expect(appealUpdates()[0].payload.override_reason).toBeUndefined()
  })

  it('refuses to assign an appeal to someone who is not an admin', async () => {
    mocks.tables.appeals = { select: { id: APPEAL_ID, status: 'open', original_decider_id: ADMIN_A, appellant_profile_id: COACH_ID } }
    mocks.tables.profiles = { select: { id: COACH_ID, role: 'coach' } }

    const r = await assignAppeal({ appealId: APPEAL_ID, reviewerId: COACH_ID })

    expect(r.error).toMatch(/only be assigned to an administrator/i)
    expect(mocks.updates).toHaveLength(0)
  })

  it('records decider_known:false when the original decider is unknown, rather than a confident self_review:false', async () => {
    mocks.tables.appeals = {
      select: { id: APPEAL_ID, status: 'open', original_decider_id: null, appellant_profile_id: COACH_ID },
      update: [{ id: APPEAL_ID, appellant_profile_id: COACH_ID }],
    }
    mocks.tables.profiles = { select: { id: ADMIN_B, role: 'admin' } }

    await assignAppeal({ appealId: APPEAL_ID, reviewerId: ADMIN_B })

    const row = auditInserts().find((a) => a.payload.action === 'assign_appeal')
    expect((row!.payload.metadata as Record<string, unknown>).decider_known).toBe(false)
  })

  it('refuses an appeal that is not open', async () => {
    mocks.tables.appeals = { select: { id: APPEAL_ID, status: 'under_review', original_decider_id: ADMIN_A, appellant_profile_id: COACH_ID } }
    mocks.tables.profiles = { select: { id: ADMIN_B, role: 'admin' } }
    const r = await assignAppeal({ appealId: APPEAL_ID, reviewerId: ADMIN_B })
    expect(r.error).toBe('This appeal has already been picked up.')
    expect(mocks.updates).toHaveLength(0)
  })
})

// ── resolveAppeal ─────────────────────────────────────────────────────────────

describe('resolveAppeal', () => {
  const underReview = (over: Row = {}) => ({
    id: APPEAL_ID, status: 'under_review', subject_type: 'submission',
    subject_id: SUBMISSION_ID, appellant_profile_id: COACH_ID,
    // resolveAppeal now requires the caller to BE the assigned reviewer.
    assigned_reviewer_id: ADMIN_B, original_decider_id: ADMIN_A, ...over,
  })

  it('overturning a submission sets status to changes_requested — never draft', async () => {
    mocks.tables.appeals = { select: underReview(), update: [{ id: APPEAL_ID, appellant_profile_id: COACH_ID, subject_type: 'submission' }] }
    mocks.tables.submissions = { update: [{ id: SUBMISSION_ID }] }

    const r = await resolveAppeal({ appealId: APPEAL_ID, outcome: 'overturned', resolutionNotes: VALID_NOTES })

    expect(r).toEqual({ success: true })
    expect(submissionUpdates()).toHaveLength(1)
    expect(submissionUpdates()[0].payload.status).toBe('changes_requested')
    // admin_feedback is deliberately NOT written: it survives re-approval and the sponsor
    // portal ships the whole submission row to a client component, so appeal text there
    // would reach the sponsor's browser once the pitch is resubmitted and approved.
    expect(submissionUpdates()[0].payload).not.toHaveProperty('admin_feedback')
    // reviewed_by is NOT touched — it records who made the original decision.
    expect(submissionUpdates()[0].payload).not.toHaveProperty('reviewed_by')
    expect(mocks.notifyMock).toHaveBeenCalledTimes(1)
  })

  it('never moves capacity: no sponsors or transactions_ledger write on an overturn', async () => {
    mocks.tables.appeals = { select: underReview(), update: [{ id: APPEAL_ID, appellant_profile_id: COACH_ID, subject_type: 'submission' }] }
    mocks.tables.submissions = { update: [{ id: SUBMISSION_ID }] }

    await resolveAppeal({ appealId: APPEAL_ID, outcome: 'overturned', resolutionNotes: VALID_NOTES })

    expect(mocks.updates.filter((u) => u.table === 'sponsors')).toHaveLength(0)
    expect(mocks.inserts.filter((i) => i.table === 'transactions_ledger')).toHaveLength(0)
    expect(submissionUpdates()[0].payload).not.toHaveProperty('reserved_amount_cents')
    expect(submissionUpdates()[0].payload).not.toHaveProperty('sent_at')
  })

  it('ACCEPTANCE: a failed subject write leaves the appeal under_review and returns an error', async () => {
    mocks.tables.appeals = { select: underReview() }
    mocks.updateErrors.submissions = { message: 'row locked' }

    const r = await resolveAppeal({ appealId: APPEAL_ID, outcome: 'overturned', resolutionNotes: VALID_NOTES })

    expect(r.error).toMatch(/could not be applied to the pitch/i)
    // The appeal itself was never marked resolved.
    expect(appealUpdates()).toHaveLength(0)
    expect(mocks.notifyMock).not.toHaveBeenCalled()
  })

  it('overturning team_verification delegates to overrideTeamVerification with the resolution notes', async () => {
    mocks.tables.appeals = {
      select: underReview({ subject_type: 'team_verification', subject_id: VERIFICATION_ID }),
      update: [{ id: APPEAL_ID, appellant_profile_id: COACH_ID, subject_type: 'team_verification' }],
    }
    mocks.tables.team_verification_records = { select: rejectedVerification() }

    const r = await resolveAppeal({ appealId: APPEAL_ID, outcome: 'overturned', resolutionNotes: VALID_NOTES })

    expect(r).toEqual({ success: true })
    expect(mocks.overrideTeamVerificationMock).toHaveBeenCalledWith({
      recordId: VERIFICATION_ID,
      reason: VALID_NOTES,
      // Compare-and-set, so a concurrent override cannot be re-stamped by this one.
      expectedOutcome: 'rejected',
      // One admin action, one message: resolveAppeal sends its own.
      notifyCoach: false,
    })
    expect(mocks.notifyMock).toHaveBeenCalledTimes(1)
    // The override owns the record write; appeals.ts must not shadow it with its own.
    expect(mocks.updates.filter((u) => u.table === 'team_verification_records')).toHaveLength(0)
  })

  it('ACCEPTANCE: a check that is no longer rejected leaves the appeal under_review', async () => {
    mocks.tables.appeals = { select: underReview({ subject_type: 'team_verification', subject_id: VERIFICATION_ID }) }
    mocks.tables.team_verification_records = { select: rejectedVerification({ outcome: 'overridden' }) }

    const r = await resolveAppeal({ appealId: APPEAL_ID, outcome: 'overturned', resolutionNotes: VALID_NOTES })

    expect(r.error).toMatch(/no longer in the rejected state/i)
    expect(mocks.overrideTeamVerificationMock).not.toHaveBeenCalled()
    expect(appealUpdates()).toHaveLength(0)
    expect(mocks.notifyMock).not.toHaveBeenCalled()
  })

  it('ACCEPTANCE: a failed override leaves the appeal under_review and returns an error', async () => {
    mocks.tables.appeals = { select: underReview({ subject_type: 'team_verification', subject_id: VERIFICATION_ID }) }
    mocks.tables.team_verification_records = { select: rejectedVerification() }
    mocks.overrideTeamVerificationMock.mockResolvedValue({ error: 'Verification record not found' })

    const r = await resolveAppeal({ appealId: APPEAL_ID, outcome: 'overturned', resolutionNotes: VALID_NOTES })

    expect(r.error).toMatch(/could not be applied to the team number check/i)
    expect(appealUpdates()).toHaveLength(0)
    expect(mocks.notifyMock).not.toHaveBeenCalled()
  })

  it('overturning coach_verification clears the denial but does NOT set coach_verified', async () => {
    mocks.tables.appeals = {
      select: underReview({ subject_type: 'coach_verification', subject_id: COACH_ID }),
      update: [{ id: APPEAL_ID, appellant_profile_id: COACH_ID, subject_type: 'coach_verification' }],
    }
    mocks.tables.profiles = { update: [{ id: COACH_ID }] }

    const r = await resolveAppeal({ appealId: APPEAL_ID, outcome: 'overturned', resolutionNotes: VALID_NOTES })

    expect(r).toEqual({ success: true })
    expect(profileUpdates()).toHaveLength(1)
    expect(profileUpdates()[0].payload).toEqual({ denial_reason: null, denied_at: null })
    expect(profileUpdates()[0].payload).not.toHaveProperty('coach_verified')
    // The notification has to tell them the document is gone.
    expect(String(mocks.notifyMock.mock.calls[0][0].body)).toMatch(/upload your photo id again/i)
  })

  it('upheld touches no subject row', async () => {
    mocks.tables.appeals = { select: underReview(), update: [{ id: APPEAL_ID, appellant_profile_id: COACH_ID, subject_type: 'submission' }] }

    const r = await resolveAppeal({ appealId: APPEAL_ID, outcome: 'upheld', resolutionNotes: VALID_NOTES })

    expect(r).toEqual({ success: true })
    expect(submissionUpdates()).toHaveLength(0)
    expect(profileUpdates()).toHaveLength(0)
    expect(appealUpdates()[0].payload).toMatchObject({ status: 'upheld', resolved_by: ADMIN_B })
  })

  it('ACCEPTANCE: an admin who is NOT the assigned reviewer cannot resolve — closes the two-step self-review bypass', async () => {
    // ADMIN_A declined the pitch, assigned it to ADMIN_B (so isSelfReview was false at
    // assign time), then tries to resolve it themselves.
    mocks.requireAdminMock.mockResolvedValue({ user: { id: ADMIN_A, role: 'admin' }, adminClient })
    mocks.tables.appeals = { select: underReview({ assigned_reviewer_id: ADMIN_B, original_decider_id: ADMIN_A }) }

    const r = await resolveAppeal({ appealId: APPEAL_ID, outcome: 'upheld', resolutionNotes: VALID_NOTES })

    expect(r.error).toMatch(/assigned to another administrator/i)
    expect(mocks.updates).toHaveLength(0)
    expect(mocks.notifyMock).not.toHaveBeenCalled()
  })

  it('ACCEPTANCE: a subject update that matches ZERO rows does not mark the appeal overturned', async () => {
    // The pitch left `declined` between assignment and resolution, so the guarded update
    // matches nothing — and PostgREST reports zero rows with NO error.
    mocks.tables.appeals = { select: underReview() }
    mocks.tables.submissions = { update: [] }

    const r = await resolveAppeal({ appealId: APPEAL_ID, outcome: 'overturned', resolutionNotes: VALID_NOTES })

    expect(r.error).toMatch(/no longer in the declined state/i)
    expect(appealUpdates()).toHaveLength(0)
    expect(mocks.notifyMock).not.toHaveBeenCalled()
  })

  it('a coach_verification overturn that clears nothing does not mark the appeal overturned', async () => {
    mocks.tables.appeals = { select: underReview({ subject_type: 'coach_verification', subject_id: COACH_ID }) }
    mocks.tables.profiles = { update: [] }

    const r = await resolveAppeal({ appealId: APPEAL_ID, outcome: 'overturned', resolutionNotes: VALID_NOTES })

    expect(r.error).toMatch(/no longer carries a verification denial/i)
    expect(appealUpdates()).toHaveLength(0)
  })

  it('a coach_verification overturn writes its own audit row against profiles', async () => {
    mocks.tables.appeals = {
      select: underReview({ subject_type: 'coach_verification', subject_id: COACH_ID }),
      update: [{ id: APPEAL_ID, appellant_profile_id: COACH_ID, subject_type: 'coach_verification' }],
    }
    mocks.tables.profiles = { update: [{ id: COACH_ID }] }

    await resolveAppeal({ appealId: APPEAL_ID, outcome: 'overturned', resolutionNotes: VALID_NOTES })

    const row = auditInserts().find((a) => a.payload.action === 'appeal_overturn_coach_verification')
    expect(row).toBeTruthy()
    expect(row!.payload.entity_type).toBe('profiles')
    expect(row!.payload.entity_id).toBe(COACH_ID)
  })

  it('refuses an appeal that is not under review', async () => {
    mocks.tables.appeals = { select: null }
    const r = await resolveAppeal({ appealId: APPEAL_ID, outcome: 'upheld', resolutionNotes: VALID_NOTES })
    expect(r.error).toBe('This appeal is not under review.')
    expect(mocks.updates).toHaveLength(0)
  })
})

// ── withdrawAppeal ────────────────────────────────────────────────────────────

describe('withdrawAppeal', () => {
  it('succeeds for the appellant', async () => {
    mocks.tables.appeals = { update: [{ id: APPEAL_ID }] }
    mocks.tables.profiles = { select: [] }
    const r = await withdrawAppeal({ appealId: APPEAL_ID })
    expect(r).toEqual({ success: true })
    expect(appealUpdates()[0].payload).toMatchObject({ status: 'withdrawn' })
  })

  it('a non-appellant matches zero rows and gets an error', async () => {
    // The .eq('appellant_profile_id', user.id) filter is what makes this zero rows.
    mocks.tables.appeals = { update: [] }
    const r = await withdrawAppeal({ appealId: APPEAL_ID })
    expect(r.error).toMatch(/not yours/i)
  })
})

// ── COPPA / privacy ───────────────────────────────────────────────────────────

describe('audit_log never carries the appeal statement', () => {
  it('createAppeal', async () => {
    mocks.tables.submissions = { select: declinedSubmission() }
    mocks.tables.appeals = { insert: { id: APPEAL_ID } }
    mocks.tables.profiles = { select: [] }
    await createAppeal({ subjectType: 'submission', subjectId: SUBMISSION_ID, statement: VALID_STATEMENT })
    expect(JSON.stringify(auditInserts())).not.toContain(VALID_STATEMENT)
    expect(auditInserts()[0].payload.metadata).toEqual({ subject_type: 'submission', subject_id: SUBMISSION_ID })
  })
})
