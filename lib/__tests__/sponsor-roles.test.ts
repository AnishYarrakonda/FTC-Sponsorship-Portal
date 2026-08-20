import { describe, it, expect } from 'vitest'
import {
  SPONSOR_ROLES,
  SPONSOR_ROLE_RANK,
  LEGACY_MEMBER_ROLE,
  hasSponsorRole,
  requiresApproval,
  isSponsorRole,
} from '../sponsor-roles'
import {
  confirmProposalSchema,
  rejectProposalSchema,
  withdrawProposalSchema,
  orgApprovalSettingsSchema,
} from '../schemas/sponsor-approvals'

describe('the role ladder', () => {
  it('is strictly increasing: viewer < submitter < approver < org_admin', () => {
    const ranks = SPONSOR_ROLES.map((r) => SPONSOR_ROLE_RANK[r])
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i]).toBeGreaterThan(ranks[i - 1])
    }
  })

  it('hasSponsorRole is correct at every pair', () => {
    for (const actual of SPONSOR_ROLES) {
      for (const min of SPONSOR_ROLES) {
        const expected = SPONSOR_ROLE_RANK[actual] >= SPONSOR_ROLE_RANK[min]
        expect(hasSponsorRole(actual, min)).toBe(expected)
      }
    }
  })

  it('hasSponsorRole(null, ...) is always false', () => {
    for (const min of SPONSOR_ROLES) {
      expect(hasSponsorRole(null, min)).toBe(false)
    }
  })

  it('isSponsorRole rejects the pre-0083 value "member"', () => {
    expect(isSponsorRole('member')).toBe(false)
    expect(isSponsorRole('viewer')).toBe(true)
  })

  // MUST match the SQL COALESCE fallback in current_sponsor_member_role() (0083):
  // a sponsor with no sponsor_members row (the legacy profiles.sponsor_id-only shape)
  // resolves to org_admin in both layers, or one of them is a hole.
  it('LEGACY_MEMBER_ROLE is org_admin', () => {
    expect(LEGACY_MEMBER_ROLE).toBe('org_admin')
  })
})

describe('requiresApproval', () => {
  it('the boundary is > (strictly above), not >=', () => {
    expect(requiresApproval(999, 1000)).toBe(false)
    expect(requiresApproval(1000, 1000)).toBe(false)
    expect(requiresApproval(1001, 1000)).toBe(true)
  })

  it('a null threshold means approvals are off — always false', () => {
    expect(requiresApproval(1, 0)).toBe(true) // sanity: 0 is a real threshold, not "off"
    expect(requiresApproval(100_000_000, null)).toBe(false)
  })

  it('a threshold of 0 requires approval for any positive amount', () => {
    expect(requiresApproval(1, 0)).toBe(true)
    expect(requiresApproval(0, 0)).toBe(false)
  })
})

describe('sponsor-approvals schemas', () => {
  it('confirmProposalSchema requires a uuid proposalId; note is optional', () => {
    expect(confirmProposalSchema.safeParse({ proposalId: 'not-a-uuid' }).success).toBe(false)
    expect(
      confirmProposalSchema.safeParse({ proposalId: '11111111-1111-4111-8111-111111111111' }).success
    ).toBe(true)
    expect(
      confirmProposalSchema.safeParse({
        proposalId: '11111111-1111-4111-8111-111111111111',
        note: 'looks good',
      }).success
    ).toBe(true)
  })

  it('rejectProposalSchema requires a non-empty note', () => {
    expect(
      rejectProposalSchema.safeParse({ proposalId: '11111111-1111-4111-8111-111111111111', note: '' }).success
    ).toBe(false)
    expect(
      rejectProposalSchema.safeParse({ proposalId: '11111111-1111-4111-8111-111111111111' }).success
    ).toBe(false)
    expect(
      rejectProposalSchema.safeParse({
        proposalId: '11111111-1111-4111-8111-111111111111',
        note: 'budget cut',
      }).success
    ).toBe(true)
  })

  it('withdrawProposalSchema requires a uuid proposalId', () => {
    expect(withdrawProposalSchema.safeParse({ proposalId: 'nope' }).success).toBe(false)
    expect(
      withdrawProposalSchema.safeParse({ proposalId: '11111111-1111-4111-8111-111111111111' }).success
    ).toBe(true)
  })

  it('orgApprovalSettingsSchema accepts a non-negative integer or null, rejects negatives/decimals', () => {
    expect(orgApprovalSettingsSchema.safeParse({ approvalRequiredAboveCents: null }).success).toBe(true)
    expect(orgApprovalSettingsSchema.safeParse({ approvalRequiredAboveCents: 0 }).success).toBe(true)
    expect(orgApprovalSettingsSchema.safeParse({ approvalRequiredAboveCents: 100_000 }).success).toBe(true)
    expect(orgApprovalSettingsSchema.safeParse({ approvalRequiredAboveCents: -1 }).success).toBe(false)
    expect(orgApprovalSettingsSchema.safeParse({ approvalRequiredAboveCents: 1.5 }).success).toBe(false)
    expect(orgApprovalSettingsSchema.safeParse({}).success).toBe(false)
  })
})
