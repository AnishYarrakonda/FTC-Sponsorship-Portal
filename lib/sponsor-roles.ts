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
