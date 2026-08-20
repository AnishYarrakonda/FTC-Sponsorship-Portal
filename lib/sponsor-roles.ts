/**
 * Canonical sponsor-org role ladder: viewer < submitter < approver < org_admin.
 *
 * Mirrors lib/submission-status.ts — a small, dependency-free module that exists so the
 * UI, the server-action guards, and the SQL permission helpers cannot drift apart.
 */

export const SPONSOR_ROLES = ['viewer', 'submitter', 'approver', 'org_admin'] as const
export type SponsorRole = (typeof SPONSOR_ROLES)[number]

export const SPONSOR_ROLE_RANK: Record<SponsorRole, number> = {
  viewer: 1,
  submitter: 2,
  approver: 3,
  org_admin: 4,
}

/**
 * Legacy shape: a sponsor linked only through profiles.sponsor_id, with no
 * sponsor_members row (0082 deliberately did not backfill). MUST agree with the
 * COALESCE fallback in the SQL function current_sponsor_member_role() (0083) — that
 * agreement is what lets a legacy sponsor still propose and confirm funding.
 */
export const LEGACY_MEMBER_ROLE: SponsorRole = 'org_admin'

export const SPONSOR_ROLE_LABELS: Record<SponsorRole, { label: string; hint: string }> = {
  viewer: {
    label: 'Viewer',
    hint: 'Can see pitches, funding, and approvals, but cannot act on any of them.',
  },
  submitter: {
    label: 'Submitter',
    hint: 'Can decline, request changes, and propose funding decisions.',
  },
  approver: {
    label: 'Approver',
    hint: 'Can confirm or reject a proposed funding decision.',
  },
  org_admin: {
    label: 'Admin',
    hint: 'Full access, including inviting teammates and organization settings.',
  },
}

export function isSponsorRole(value: string | null | undefined): value is SponsorRole {
  return !!value && (SPONSOR_ROLES as readonly string[]).includes(value)
}

/**
 * Clerk only models two organization-level roles. The two intermediate ranks of the
 * ladder above (viewer, submitter) exist ONLY in sponsor_members.role, which is why an
 * `org:member` webhook event carries no usable information about a member who is already
 * below org_admin — see reconcileMemberRole().
 */
export const CLERK_ORG_ADMIN_ROLE = 'org:admin'

/**
 * Role for a sponsor_members row a Clerk webhook is creating for the FIRST time —
 * enterprise-SSO just-in-time provisioning (prompt 10) and invite acceptance both land
 * here. Least privilege: anything that is not an explicit Clerk org admin becomes
 * `viewer`. An IdP-authenticated stranger must not be able to move money on day one; an
 * org admin promotes them afterwards.
 *
 * `org:admin` is honored because it can only be granted by an existing org admin (our
 * invite action or the Clerk dashboard) — never by an IdP assertion. Clerk assigns the
 * organization's default role, `org:member`, to every SSO first login.
 */
export function jitMemberRole(clerkRole: string | null | undefined): SponsorRole {
  return clerkRole === CLERK_ORG_ADMIN_ROLE ? 'org_admin' : 'viewer'
}

/**
 * The role to persist when an organizationMembership event arrives for a member we may
 * already know about. SSO logins re-fire these events, so this must never demote.
 *
 * - No local row yet          → jitMemberRole() (viewer, or org_admin if Clerk says so).
 * - Clerk says org:admin      → org_admin.
 * - Clerk says org:member and the member is already below org_admin → UNCHANGED. This is
 *   the demotion bug this function exists to prevent: a returning `approver` signing in
 *   through their employer's IdP must still be an `approver` afterwards.
 * - Clerk says org:member and the member IS org_admin → a real demotion performed in the
 *   Clerk dashboard; land on `submitter`, the closest rank Clerk can express. (An in-app
 *   demotion writes sponsor_members first, so by the time the echo event arrives the row
 *   already holds the intended role and the branch above keeps it.)
 */
export function reconcileMemberRole(
  clerkRole: string | null | undefined,
  existingRole: SponsorRole | null
): SponsorRole {
  if (!existingRole) return jitMemberRole(clerkRole)
  if (clerkRole === CLERK_ORG_ADMIN_ROLE) return 'org_admin'
  return existingRole === 'org_admin' ? 'submitter' : existingRole
}

export function hasSponsorRole(actual: SponsorRole | null, min: SponsorRole): boolean {
  if (!actual) return false
  return SPONSOR_ROLE_RANK[actual] >= SPONSOR_ROLE_RANK[min]
}

/**
 * Whether a commitment of `amountCents` requires a second person to confirm, given the
 * org's threshold. `thresholdCents === null` means approvals are off for that org — the
 * pre-0083 behavior. The boundary is `>`, not `>=`: a commitment exactly AT the
 * threshold auto-approves. This is the one place that boundary is written; every caller
 * (the two actions, the review shell, the settings card) imports it.
 */
export function requiresApproval(amountCents: number, thresholdCents: number | null): boolean {
  if (thresholdCents === null) return false
  return amountCents > thresholdCents
}
