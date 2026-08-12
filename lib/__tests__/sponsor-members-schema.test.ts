import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  inviteSponsorMemberSchema,
  updateSponsorMemberRoleSchema,
  removeSponsorMemberSchema,
} from '../schemas/sponsor-members'

describe('inviteSponsorMemberSchema', () => {
  it('normalizes email (trim + lowercase)', () => {
    const result = inviteSponsorMemberSchema.safeParse({ email: '  Jane@Example.COM  ', role: 'member' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.email).toBe('jane@example.com')
  })

  it('rejects an invalid email', () => {
    const result = inviteSponsorMemberSchema.safeParse({ email: 'not-an-email', role: 'member' })
    expect(result.success).toBe(false)
  })

  it('accepts member and org_admin roles', () => {
    expect(inviteSponsorMemberSchema.safeParse({ email: 'a@example.com', role: 'member' }).success).toBe(true)
    expect(inviteSponsorMemberSchema.safeParse({ email: 'a@example.com', role: 'org_admin' }).success).toBe(true)
  })

  it('rejects a role outside the enum', () => {
    const result = inviteSponsorMemberSchema.safeParse({ email: 'a@example.com', role: 'owner' })
    expect(result.success).toBe(false)
  })

  it('rejects a missing role', () => {
    const result = inviteSponsorMemberSchema.safeParse({ email: 'a@example.com' })
    expect(result.success).toBe(false)
  })
})

describe('updateSponsorMemberRoleSchema', () => {
  it('requires a uuid memberId', () => {
    expect(
      updateSponsorMemberRoleSchema.safeParse({ memberId: 'not-a-uuid', role: 'member' }).success
    ).toBe(false)
    expect(
      updateSponsorMemberRoleSchema.safeParse({
        memberId: '11111111-1111-4111-8111-111111111111',
        role: 'member',
      }).success
    ).toBe(true)
  })

  it('rejects a role outside the enum', () => {
    const result = updateSponsorMemberRoleSchema.safeParse({
      memberId: '11111111-1111-4111-8111-111111111111',
      role: 'superadmin',
    })
    expect(result.success).toBe(false)
  })
})

describe('removeSponsorMemberSchema', () => {
  it('requires a uuid memberId', () => {
    expect(removeSponsorMemberSchema.safeParse({ memberId: 'nope' }).success).toBe(false)
    expect(
      removeSponsorMemberSchema.safeParse({ memberId: '11111111-1111-4111-8111-111111111111' }).success
    ).toBe(true)
  })
})

describe('sponsor-members action module — every schema is enforced with safeParse', () => {
  const source = readFileSync(
    join(__dirname, '..', '..', 'app', 'actions', 'sponsor-members.ts'),
    'utf-8'
  )

  it('never calls .parse( directly (safeParse only, per the canonical action shape)', () => {
    expect(source).not.toMatch(/[^e]\.parse\(/)
  })

  it('validates every mutating action input with its schema', () => {
    expect(source).toMatch(/inviteSponsorMemberSchema\.safeParse/)
    expect(source).toMatch(/updateSponsorMemberRoleSchema\.safeParse/)
    expect(source).toMatch(/removeSponsorMemberSchema\.safeParse/)
  })

  it('exports the four actions the members page depends on', () => {
    expect(source).toMatch(/export async function inviteSponsorMember/)
    expect(source).toMatch(/export async function updateSponsorMemberRole/)
    expect(source).toMatch(/export async function removeSponsorMember/)
    expect(source).toMatch(/export async function listSponsorMembers/)
  })
})
