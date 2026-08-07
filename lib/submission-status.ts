/**
 * Canonical submission-status groupings.
 *
 * The `submission_status` enum has ten values. The audit found the app treating
 * `pending` as "waiting on the sponsor" in several places, which is wrong in both
 * directions: `pending` means waiting on the ADMIN, and a pitch actually waiting on a
 * sponsor is `dispatched` / `delivered` / `opened`. Consequences that shipped:
 *
 *  - the sponsor's nav badge and dashboard count filtered on `status='pending'`, a state
 *    a sponsor-visible pitch never has, so the review queue read 0 while real pitches
 *    waited;
 *  - `delivered` and `opened` had no badge config, so a live pitch rendered as a raw
 *    lowercase string;
 *  - the sponsor review console rendered live Approve/Decline buttons for `expired` and
 *    `bounced`, whose RPC always returns `invalid_status`.
 *
 * Defining the sets once is what keeps those three from drifting apart again.
 */

/** Waiting on a SPONSOR decision. The only states the decision RPCs accept. */
export const AWAITING_SPONSOR_STATUSES = ['dispatched', 'delivered', 'opened'] as const

/** Waiting on an ADMIN moderation decision. */
export const AWAITING_ADMIN_STATUSES = ['pending'] as const

/** Terminal — no further decision is possible by anyone. */
export const TERMINAL_STATUSES = [
  'approved',
  'declined',
  'expired',
  'bounced',
] as const

/** A coach may still edit these. */
export const COACH_EDITABLE_STATUSES = ['draft', 'declined', 'changes_requested'] as const

export type AwaitingSponsorStatus = (typeof AWAITING_SPONSOR_STATUSES)[number]

export function isAwaitingSponsor(status: string | null | undefined): boolean {
  return !!status && (AWAITING_SPONSOR_STATUSES as readonly string[]).includes(status)
}

export function isTerminal(status: string | null | undefined): boolean {
  return !!status && (TERMINAL_STATUSES as readonly string[]).includes(status)
}
