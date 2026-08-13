import { describe, it, expect, vi, beforeEach } from 'vitest'
import { jitMemberRole, reconcileMemberRole } from '@/lib/sponsor-roles'

/**
 * Prompt 10 — enterprise SSO just-in-time provisioning.
 *
 * These drive the real webhook handler (app/api/webhooks/clerk/route.ts) through a
 * stateful in-memory stand-in for the service-role client, because the properties that
 * matter here are behavioural: what role a member ends up with, whether a stranger's org
 * can mint rows, and whether an unsigned payload is refused.
 */

// ── Mocks ──────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>

const mocks = vi.hoisted(() => {
  const verifyMock = vi.fn()
  const notifyMock = vi.fn()
  const tables: Record<string, Row[]> = {}
  return { verifyMock, notifyMock, tables }
})

vi.mock('@clerk/nextjs/webhooks', () => ({ verifyWebhook: mocks.verifyMock }))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))
vi.mock('@/lib/env', () => ({ env: { CLERK_WEBHOOK_SIGNING_SECRET: 'whsec_test' } }))
vi.mock('@/lib/notify', () => ({ createInAppNotification: mocks.notifyMock }))
vi.mock('@/lib/credentials-retention', () => ({
  purgeUserStorage: async () => ({ removed: 0, failedBuckets: [] }),
}))

let idCounter = 0
function nextId(prefix: string) {
  idCounter += 1
  return `${prefix}-${idCounter}`
}

/** Chainable, stateful PostgREST stand-in supporting the subset the route uses. */
function makeBuilder(table: string) {
  const rows = () => (mocks.tables[table] ??= [])
  const filters: { op: 'eq' | 'neq'; col: string; value: unknown }[] = []
  let pending: { kind: 'insert' | 'upsert' | 'update' | 'delete'; payload?: Row; onConflict?: string } | null = null

  const matches = (row: Row) =>
    filters.every((f) => (f.op === 'eq' ? row[f.col] === f.value : row[f.col] !== f.value))

  function apply(): { data: Row[] } {
    if (!pending) return { data: rows().filter(matches) }
    const { kind, payload, onConflict } = pending
    if (kind === 'insert') {
      const row = { id: nextId(table), ...payload }
      rows().push(row)
      return { data: [row] }
    }
    if (kind === 'upsert') {
      const keys = (onConflict ?? '').split(',').map((k) => k.trim()).filter(Boolean)
      const existing = rows().find((r) => keys.every((k) => r[k] === payload![k]))
      if (existing) {
        Object.assign(existing, payload)
        return { data: [existing] }
      }
      const row = { id: nextId(table), ...payload }
      rows().push(row)
      return { data: [row] }
    }
    if (kind === 'update') {
      const hits = rows().filter(matches)
      hits.forEach((r) => Object.assign(r, payload))
      return { data: hits }
    }
    const hits = rows().filter(matches)
    mocks.tables[table] = rows().filter((r) => !hits.includes(r))
    return { data: hits }
  }

  const builder = {
    select: () => builder,
    limit: () => builder,
    order: () => builder,
    eq(col: string, value: unknown) {
      filters.push({ op: 'eq', col, value })
      return builder
    },
    neq(col: string, value: unknown) {
      filters.push({ op: 'neq', col, value })
      return builder
    },
    in: () => builder,
    insert(payload: Row) {
      pending = { kind: 'insert', payload }
      return builder
    },
    upsert(payload: Row, opts?: { onConflict?: string }) {
      pending = { kind: 'upsert', payload, onConflict: opts?.onConflict }
      return builder
    },
    update(payload: Row) {
      pending = { kind: 'update', payload }
      return builder
    },
    delete() {
      pending = { kind: 'delete' }
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
  createAdminClient: () => ({ from: (table: string) => makeBuilder(table) }),
}))

import { POST } from '@/app/api/webhooks/clerk/route'

// ── Fixtures ───────────────────────────────────────────────────────────────────

const SPONSOR_ID = 'sponsor-acme'
const ORG_ID = 'org_acme'
const PROFILE_ID = 'profile-dana'

function membershipEvent(overrides: {
  type?: string
  clerkUserId?: string
  orgId?: string
  membershipId?: string
  role?: string
  identifier?: string
}) {
  return {
    type: overrides.type ?? 'organizationMembership.created',
    data: {
      id: overrides.membershipId ?? 'orgmem_1',
      role: overrides.role ?? 'org:member',
      organization: { id: overrides.orgId ?? ORG_ID },
      public_user_data: {
        user_id: overrides.clerkUserId ?? 'user_dana',
        identifier: overrides.identifier ?? 'dana@acme.com',
        first_name: 'Dana',
        last_name: 'Cole',
      },
    },
  }
}

const request = () => new Request('https://portal.test/api/webhooks/clerk', { method: 'POST' })

function seedSponsor() {
  mocks.tables.sponsors = [{ id: SPONSOR_ID, clerk_org_id: ORG_ID, company_name: 'Acme Robotics' }]
}
function seedProfile(extra: Row = {}) {
  mocks.tables.profiles = [
    { id: PROFILE_ID, clerk_user_id: 'user_dana', role: 'sponsor', sponsor_id: SPONSOR_ID, email: 'dana@acme.com', ...extra },
  ]
}

beforeEach(() => {
  for (const key of Object.keys(mocks.tables)) delete mocks.tables[key]
  mocks.verifyMock.mockReset()
  mocks.notifyMock.mockReset()
  idCounter = 0
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

// ── Pure role rules ────────────────────────────────────────────────────────────

describe('role resolution', () => {
  it('defaults a brand-new member to viewer, never approver', () => {
    expect(jitMemberRole('org:member')).toBe('viewer')
    expect(jitMemberRole(undefined)).toBe('viewer')
    expect(jitMemberRole('org:admin')).toBe('org_admin')
  })

  it('never demotes an existing member on a repeated org:member event', () => {
    expect(reconcileMemberRole('org:member', 'approver')).toBe('approver')
    expect(reconcileMemberRole('org:member', 'submitter')).toBe('submitter')
    expect(reconcileMemberRole('org:member', 'viewer')).toBe('viewer')
  })

  it('applies a genuine Clerk-side promotion and demotion of org_admin', () => {
    expect(reconcileMemberRole('org:admin', 'viewer')).toBe('org_admin')
    expect(reconcileMemberRole('org:member', 'org_admin')).toBe('submitter')
  })
})

// ── Webhook behaviour ──────────────────────────────────────────────────────────

describe('clerk webhook — SSO JIT provisioning', () => {
  it('rejects an unsigned / wrongly-signed payload without touching the database', async () => {
    mocks.verifyMock.mockRejectedValue(new Error('bad signature'))
    seedSponsor()
    seedProfile()

    const res = await POST(request() as never)

    expect(res.status).toBe(400)
    expect(mocks.tables.sponsor_members ?? []).toHaveLength(0)
  })

  it('provisions a first-time SSO member as viewer and audits it', async () => {
    mocks.verifyMock.mockResolvedValue(membershipEvent({}))
    seedSponsor()
    seedProfile({ sponsor_id: null })

    const res = await POST(request() as never)

    expect(res.status).toBe(200)
    expect(mocks.tables.sponsor_members).toHaveLength(1)
    expect(mocks.tables.sponsor_members[0]).toMatchObject({
      sponsor_id: SPONSOR_ID,
      profile_id: PROFILE_ID,
      role: 'viewer',
      clerk_membership_id: 'orgmem_1',
    })
    const audit = (mocks.tables.audit_log ?? []).find((r) => r.action === 'sso_jit_provision')
    expect(audit).toBeTruthy()
    expect(audit!.metadata).toMatchObject({ clerk_org_id: ORG_ID, email_domain: 'acme.com', role: 'viewer' })
    // profiles.sponsor_id is stamped so the member's very next request resolves.
    expect(mocks.tables.profiles[0].sponsor_id).toBe(SPONSOR_ID)
  })

  it('creates the profile row for an SSO user who has never signed up here', async () => {
    mocks.verifyMock.mockResolvedValue(membershipEvent({ clerkUserId: 'user_new', identifier: 'sam@acme.com' }))
    seedSponsor()
    mocks.tables.profiles = []

    const res = await POST(request() as never)

    expect(res.status).toBe(200)
    expect(mocks.tables.profiles).toHaveLength(1)
    expect(mocks.tables.profiles[0]).toMatchObject({
      clerk_user_id: 'user_new',
      email: 'sam@acme.com',
      full_name: 'Dana Cole',
      role: 'sponsor',
      sponsor_id: SPONSOR_ID,
    })
    // Nobody accepted terms on this person's behalf.
    expect(mocks.tables.profiles[0].tos_accepted).toBeUndefined()
    expect(mocks.tables.sponsor_members[0]).toMatchObject({ role: 'viewer' })
  })

  it('refuses to duplicate a profile when Clerk minted a second user for the same email', async () => {
    mocks.verifyMock.mockResolvedValue(membershipEvent({ clerkUserId: 'user_dupe' }))
    seedSponsor()
    seedProfile() // same email, different clerk_user_id
    mocks.tables.profiles.push({ id: 'admin-1', role: 'admin' })

    const res = await POST(request() as never)

    expect(res.status).toBe(200)
    expect(mocks.tables.profiles.filter((p) => p.email === 'dana@acme.com')).toHaveLength(1)
    expect(mocks.tables.sponsor_members ?? []).toHaveLength(0)
    expect((mocks.tables.audit_log ?? []).some((r) => r.action === 'sso_jit_provision_conflict')).toBe(true)
    expect(mocks.notifyMock).toHaveBeenCalled()
  })

  it('leaves an existing approver as approver (the demotion bug)', async () => {
    mocks.verifyMock.mockResolvedValue(membershipEvent({ membershipId: 'orgmem_2' }))
    seedSponsor()
    seedProfile()
    mocks.tables.sponsor_members = [
      {
        id: 'member-1',
        sponsor_id: SPONSOR_ID,
        profile_id: PROFILE_ID,
        clerk_org_id: ORG_ID,
        clerk_membership_id: null,
        role: 'approver',
        joined_at: '2026-01-01T00:00:00.000Z',
      },
    ]

    const res = await POST(request() as never)

    expect(res.status).toBe(200)
    expect(mocks.tables.sponsor_members).toHaveLength(1)
    expect(mocks.tables.sponsor_members[0]).toMatchObject({
      role: 'approver',
      clerk_membership_id: 'orgmem_2',
      joined_at: '2026-01-01T00:00:00.000Z',
    })
    // Not a first provision — no duplicate JIT audit row.
    expect((mocks.tables.audit_log ?? []).filter((r) => r.action === 'sso_jit_provision')).toHaveLength(0)
  })

  it('is idempotent across repeated SSO logins', async () => {
    mocks.verifyMock.mockResolvedValue(membershipEvent({}))
    seedSponsor()
    seedProfile()

    await POST(request() as never)
    await POST(request() as never)
    await POST(request() as never)

    expect(mocks.tables.sponsor_members).toHaveLength(1)
    expect(mocks.tables.sponsor_members[0].role).toBe('viewer')
  })

  it('creates nothing for an unknown clerk_org_id and returns 200', async () => {
    mocks.verifyMock.mockResolvedValue(membershipEvent({ orgId: 'org_stranger' }))
    seedSponsor()
    seedProfile()
    mocks.tables.profiles.push({ id: 'admin-1', role: 'admin' })

    const res = await POST(request() as never)

    expect(res.status).toBe(200)
    expect(mocks.tables.sponsor_members ?? []).toHaveLength(0)
    expect((mocks.tables.audit_log ?? []).some((r) => r.action === 'sponsor_member_sync_orphan_org')).toBe(true)
    expect(mocks.notifyMock).toHaveBeenCalled()
  })

  it('refuses to make a coach account a sponsor org member', async () => {
    mocks.verifyMock.mockResolvedValue(membershipEvent({}))
    seedSponsor()
    seedProfile({ role: 'coach', sponsor_id: null })

    const res = await POST(request() as never)

    expect(res.status).toBe(200)
    expect(mocks.tables.sponsor_members ?? []).toHaveLength(0)
    expect((mocks.tables.audit_log ?? []).some((r) => r.action === 'sponsor_member_sync_rejected')).toBe(true)
  })

  it('does not let a second organization claim an existing member', async () => {
    mocks.verifyMock.mockResolvedValue(membershipEvent({ orgId: 'org_other' }))
    mocks.tables.sponsors = [
      { id: SPONSOR_ID, clerk_org_id: ORG_ID, company_name: 'Acme Robotics' },
      { id: 'sponsor-other', clerk_org_id: 'org_other', company_name: 'Other Co' },
    ]
    seedProfile()

    const res = await POST(request() as never)

    expect(res.status).toBe(200)
    expect(mocks.tables.sponsor_members ?? []).toHaveLength(0)
    expect(mocks.tables.profiles[0].sponsor_id).toBe(SPONSOR_ID)
  })

  it('removes the sponsor_members row and the sponsor_id pointer on deprovisioning', async () => {
    mocks.verifyMock.mockResolvedValue({
      type: 'organizationMembership.deleted',
      data: { id: 'orgmem_1' },
    })
    seedSponsor()
    seedProfile()
    mocks.tables.sponsor_members = [
      {
        id: 'member-1',
        sponsor_id: SPONSOR_ID,
        profile_id: PROFILE_ID,
        clerk_org_id: ORG_ID,
        clerk_membership_id: 'orgmem_1',
        role: 'approver',
      },
    ]

    const res = await POST(request() as never)

    expect(res.status).toBe(200)
    expect(mocks.tables.sponsor_members).toHaveLength(0)
    expect(mocks.tables.profiles[0].sponsor_id).toBeNull()
  })

  it('does not demote an approver when Clerk echoes an org:member update', async () => {
    mocks.verifyMock.mockResolvedValue(
      membershipEvent({ type: 'organizationMembership.updated', membershipId: 'orgmem_1' })
    )
    seedSponsor()
    seedProfile()
    mocks.tables.sponsor_members = [
      {
        id: 'member-1',
        sponsor_id: SPONSOR_ID,
        profile_id: PROFILE_ID,
        clerk_org_id: ORG_ID,
        clerk_membership_id: 'orgmem_1',
        role: 'approver',
      },
    ]

    const res = await POST(request() as never)

    expect(res.status).toBe(200)
    expect(mocks.tables.sponsor_members[0].role).toBe('approver')
  })
})
