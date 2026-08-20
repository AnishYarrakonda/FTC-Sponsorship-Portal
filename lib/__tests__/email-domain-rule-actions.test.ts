import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Guard + audit behaviour of the two email_domain_rules admin actions (0090).
 *
 * The DATABASE-layer denial (no write policy at all, so even an admin's own Clerk token
 * is refused by PostgREST) is asserted in tests/e2e/sponsor-domain-gating.spec.ts against
 * the real project. This file pins the action-layer half: a non-admin gets Forbidden and
 * the table is never touched.
 */

const mocks = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  upsertMock: vi.fn(),
  deleteEqMock: vi.fn(),
  auditInsertMock: vi.fn(),
  existing: null as { rule: string } | null,
}))

function chain(result: unknown) {
  const obj: Record<string, unknown> = {}
  Object.assign(obj, {
    select: () => obj,
    eq: () => obj,
    maybeSingle: () => Promise.resolve(result),
    single: () => Promise.resolve(result),
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(result).then(res, rej),
  })
  return obj
}

const adminClient = {
  from: (table: string) => {
    if (table === 'audit_log') return { insert: mocks.auditInsertMock }
    return {
      select: () => chain({ data: mocks.existing, error: null }),
      upsert: mocks.upsertMock,
      delete: () => ({ eq: mocks.deleteEqMock }),
    }
  },
}

vi.mock('@/lib/actions-utils', () => ({
  requireAdmin: mocks.requireAdminMock,
  requireSuperAdmin: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))
vi.mock('@clerk/nextjs/server', () => ({ clerkClient: async () => ({}) }))
vi.mock('@/lib/notify', () => ({
  createInAppNotification: vi.fn(),
  sendCoachVerificationEmail: vi.fn(),
  sendCoachDenialEmail: vi.fn(),
}))
vi.mock('@/lib/credentials-retention', () => ({ purgeCoachCredentials: vi.fn() }))
vi.mock('@/lib/ftc-roster', () => ({ verifyFTCTeamIdentity: vi.fn() }))

import { adminSetEmailDomainRule, adminDeleteEmailDomainRule } from '@/app/actions/admin'

beforeEach(() => {
  mocks.existing = { rule: 'block' }
  mocks.requireAdminMock
    .mockReset()
    .mockResolvedValue({ user: { id: 'admin-uuid' }, adminClient, supabase: adminClient })
  mocks.upsertMock.mockReset().mockResolvedValue({ error: null })
  mocks.deleteEqMock.mockReset().mockResolvedValue({ error: null })
  mocks.auditInsertMock.mockReset().mockResolvedValue({ error: null })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('adminSetEmailDomainRule', () => {
  it('returns Forbidden for a non-admin and never touches the table', async () => {
    mocks.requireAdminMock.mockRejectedValue(new Error('Forbidden'))
    const result = await adminSetEmailDomainRule({ domain: 'acme.com', rule: 'allow' })
    expect(result).toEqual({ error: 'Forbidden' })
    expect(mocks.upsertMock).not.toHaveBeenCalled()
    expect(mocks.auditInsertMock).not.toHaveBeenCalled()
  })

  it('rejects anything that is not a bare domain', async () => {
    for (const domain of ['https://acme.com', 'jane@acme.com', 'acme', 'a.c']) {
      const result = await adminSetEmailDomainRule({ domain, rule: 'block' })
      expect(result.error).toBeDefined()
    }
    expect(mocks.upsertMock).not.toHaveBeenCalled()
  })

  it('normalizes the domain and upserts it as a manual override', async () => {
    const result = await adminSetEmailDomainRule({
      domain: '  ACME.com ',
      rule: 'allow',
      reason: 'Family foundation',
    })
    expect(result).toEqual({ success: true })
    expect(mocks.upsertMock).toHaveBeenCalledWith(
      {
        domain: 'acme.com',
        rule: 'allow',
        category: 'manual',
        reason: 'Family foundation',
        created_by: 'admin-uuid',
      },
      { onConflict: 'domain' }
    )
  })

  it('records the previous rule in the audit metadata', async () => {
    await adminSetEmailDomainRule({ domain: 'gmail.com', rule: 'allow' })
    expect(mocks.auditInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actor_id: 'admin-uuid',
        action: 'set_email_domain_rule',
        entity_type: 'email_domain_rules',
        metadata: { domain: 'gmail.com', rule: 'allow', previous_rule: 'block', reason: null },
      })
    )
  })
})

describe('adminDeleteEmailDomainRule', () => {
  it('returns Forbidden for a non-admin and never deletes', async () => {
    mocks.requireAdminMock.mockRejectedValue(new Error('Forbidden'))
    const result = await adminDeleteEmailDomainRule('gmail.com')
    expect(result).toEqual({ error: 'Forbidden' })
    expect(mocks.deleteEqMock).not.toHaveBeenCalled()
  })

  it('refuses a domain that is not on either list', async () => {
    mocks.existing = null
    const result = await adminDeleteEmailDomainRule('nothere.com')
    expect(result).toEqual({ error: 'That domain is not on either list.' })
    expect(mocks.deleteEqMock).not.toHaveBeenCalled()
  })

  it('deletes and audits the previous rule', async () => {
    const result = await adminDeleteEmailDomainRule('gmail.com')
    expect(result).toEqual({ success: true })
    expect(mocks.deleteEqMock).toHaveBeenCalledWith('domain', 'gmail.com')
    expect(mocks.auditInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'delete_email_domain_rule',
        metadata: { domain: 'gmail.com', previous_rule: 'block' },
      })
    )
  })
})
