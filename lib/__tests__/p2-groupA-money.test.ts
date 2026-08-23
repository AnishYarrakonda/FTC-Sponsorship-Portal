/**
 * Regression cover for P2 Group A — money, capacity and state correctness.
 *
 * A-04-02, A-04-03, B-03-11, B-03-12, B-03-14, B-03-15, B-03-16, A-11-06, A-03-03.
 *
 * The DB-level halves of A-04-02 / A-04-03 / B-03-12 are proven end-to-end against the
 * live function bodies on the local Docker stack (and B-03-12 also carries a
 * detect_capacity_drift assertion in scripts/verify-capacity-invariant.mjs, scenario 7).
 * What these tests pin is the part that silently rots: the migration text that has to stay
 * present, and the application wiring that has no other assertion on it.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatTransactionDate, formatTransactionDateShort, toUtcCalendarDate } from '../format-dates'
import { TERMINAL_STATUSES, COACH_EDITABLE_STATUSES, isTerminal } from '../submission-status'

const root = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

describe('A-04-02 — needs_legal_review gates agreement signing', () => {
  const migration = read('supabase/migrations/0106_legal_review_gate_and_orphan_fulfillments.sql')

  it('sign_agreement_atomic refuses a template flagged for legal review', () => {
    expect(migration).toContain('IF v_template.needs_legal_review THEN')
    expect(migration).toContain("'template_needs_legal_review'")
  })

  it('the gate sits AFTER the template was resolved, so it cannot mask template_not_effective', () => {
    const effectiveAt = migration.indexOf("'template_not_effective'")
    const legalAt = migration.indexOf("'template_needs_legal_review'")
    expect(effectiveAt).toBeGreaterThan(-1)
    expect(legalAt).toBeGreaterThan(effectiveAt)
  })

  it('the 0099 approver-rank gate survives the rewrite', () => {
    // Rebuilding a function body from an older migration has silently deleted later fixes
    // three times in this repo. 0106 was patched from a live pg_get_functiondef dump; this
    // asserts the previous fix is still in the text that will be applied.
    expect(migration).toContain('sponsor_member_role_rank')
    expect(migration).toContain("sponsor_member_role_rank('approver')")
  })

  it('the signer is told who can unblock it, not shown a raw error code', () => {
    const src = read('app/actions/agreements-sign.ts')
    expect(src).toContain("case 'template_needs_legal_review':")
    expect(src).toMatch(/awaiting review by counsel/i)
  })

  it('the signing panel blocks rather than inviting a signature the DB will refuse', () => {
    const panel = read('components/agreements/signing-panel.tsx')
    expect(panel).toContain('blockedByLegalReview')
    // The consent controls and the submit button must both be inert.
    expect(panel).toMatch(/const controlsDisabled = [^\n]*blockedByLegalReview/)
    expect(panel).toMatch(/const canSubmit =[\s\S]{0,160}!blockedByLegalReview/)
    // The old copy actively invited signing; that is the bug.
    expect(panel).not.toContain('You can sign, and the signature is legally recorded')
  })
})

describe('A-04-03 — orphaned fulfillments cannot move money', () => {
  const migration = read('supabase/migrations/0106_legal_review_gate_and_orphan_fulfillments.sql')

  it('record_fulfillment_transition refuses every forward transition on an orphan', () => {
    expect(migration).toContain("IF v_f.submission_id IS NULL AND p_to_status <> 'cancelled' THEN")
    expect(migration).toContain("'submission_orphaned'")
  })

  it('cancellation is still permitted, so capacity can be released', () => {
    // The guard is scoped to `p_to_status <> 'cancelled'` precisely so the 0095 release
    // path below it stays reachable — an orphan that could not be cancelled would hold a
    // sponsor's capacity forever.
    expect(migration).toContain('funding_capacity_releases')
  })

  it('the pre-existing signature gate is still present', () => {
    expect(migration).toContain('agreement_is_signed')
  })
})

describe('B-03-11 — access tokens are revoked on a terminal decision', () => {
  const followUp = read('lib/decision-followup.ts')

  it('a shared revoke helper exists and writes revoked_at', () => {
    expect(followUp).toContain('export async function revokeSubmissionAccessTokens')
    expect(followUp).toContain("from('submission_access_tokens')")
    expect(followUp).toContain('revoked_at')
  })

  it('only already-live tokens are touched, so a revocation time is never overwritten', () => {
    expect(followUp).toMatch(/\.is\('revoked_at', null\)/)
  })

  it('approved and declined revoke; changes_requested does NOT', () => {
    // changes_requested returns the pitch to the coach for another round, so the sponsor
    // still needs their link.
    expect(followUp).toMatch(/if \(status === 'approved' \|\| status === 'declined'\)/)
  })

  it('the emailed-token decision path revokes too', () => {
    const src = read('app/actions/sponsor-decision.ts')
    expect(src).toContain('revokeSubmissionAccessTokens')
  })
})

describe('B-03-12 — a dispatched pitch can be withdrawn', () => {
  const migration = read('supabase/migrations/0107_submission_withdrawn_status.sql')
  const action = read('app/actions/submission.ts')

  it('withdrawn is a real status, not an overloaded changes_requested', () => {
    expect(migration).toContain("ALTER TYPE submission_status ADD VALUE IF NOT EXISTS 'withdrawn'")
  })

  it('it releases capacity through the same RPC expiry and bounce use', () => {
    expect(migration).toContain("'withdrawn')")
    expect(migration).toContain('release_submission_reservation')
    expect(action).toContain("p_new_status: 'withdrawn'")
  })

  it('the action verifies ownership and that the sponsor has not already decided', () => {
    expect(action).toContain('requireVerifiedCoach')
    expect(action).toContain('isAwaitingSponsor(submission.status)')
  })

  it('the sponsor is notified, so a pitch does not silently vanish from their inbox', () => {
    expect(action).toContain('sponsorRecipientProfiles')
    expect(action).toMatch(/withdrew their pitch/)
  })

  it('withdrawing also revokes the bearer link (B-03-11 applies here too)', () => {
    expect(action).toContain('revokeSubmissionAccessTokens')
  })

  it('withdrawn is terminal for the sponsor but still coach-editable', () => {
    expect(TERMINAL_STATUSES).toContain('withdrawn')
    expect(COACH_EDITABLE_STATUSES).toContain('withdrawn')
    expect(isTerminal('withdrawn')).toBe(true)
  })

  it('it renders as a badge rather than a raw lowercase string', () => {
    // `delivered` and `opened` shipped without a badge config once already; that is how a
    // live pitch fell out of both dashboards mid-flight.
    expect(read('components/ui/status-badge.tsx')).toContain('withdrawn:')
  })
})

describe('B-03-14 — one receipt reports one date on every surface', () => {
  // 2026-08-22T04:16:35Z is 2026-08-21 in America/Los_Angeles. The bug was that the table
  // rendered the local day and the document rendered the UTC day.
  const issuedAt = '2026-08-22T04:16:35+00:00'
  const contributionDate = '2026-08-22'

  it('a timestamptz and a date column for the same day format identically', () => {
    expect(formatTransactionDate(issuedAt)).toBe(formatTransactionDate(contributionDate))
  })

  it('the formatted value is the UTC calendar day, not the runner timezone', () => {
    expect(formatTransactionDate(issuedAt)).toBe('Aug 22, 2026')
    expect(toUtcCalendarDate(issuedAt)).toBe('2026-08-22')
  })

  it('a date-only string is not shifted backwards', () => {
    // `new Date('2026-08-22')` is UTC midnight; formatting it in a negative-offset zone
    // without timeZone:'UTC' yields Aug 21. That is the off-by-one.
    expect(formatTransactionDate('2026-08-22')).toBe('Aug 22, 2026')
    expect(formatTransactionDateShort('2026-08-22')).toBe('Aug 22')
  })

  it('null and malformed values degrade to a dash, never "Invalid Date"', () => {
    expect(formatTransactionDate(null)).toBe('—')
    expect(formatTransactionDate('not a date')).toBe('—')
    expect(toUtcCalendarDate(undefined)).toBe('')
  })

  it('the receipts table and the receipt document use the same formatter', () => {
    expect(read('app/(sponsor)/sponsor/funding/page.tsx')).toContain('formatTransactionDate(r.issued_at)')
    expect(read('app/(sponsor)/sponsor/funding/page.tsx')).toContain('formatTransactionDate(r.contribution_date)')
    expect(read('lib/receipt-document.tsx')).toContain('formatTransactionDate(ctx.issuedAt)')
  })

  it('no fulfillment surface formats dates in en-GB any more', () => {
    for (const f of ['components/sponsor/sponsor-fulfillment-row.tsx', 'components/coach/funding-tab.tsx']) {
      expect(read(f), f).not.toContain('en-GB')
    }
  })
})

describe('B-03-15 — an overturned appeal does not carry the reversed decline text', () => {
  const src = read('app/actions/appeals.ts')

  it('admin_feedback is cleared when the pitch is returned to the coach', () => {
    expect(src).toMatch(/status: 'changes_requested', reviewed_at: null, admin_feedback: null/)
  })

  it('appeal resolution notes are still NOT written into admin_feedback', () => {
    // That column reaches the sponsor's browser after re-approval; writing appeal text
    // there would hand a sponsor the admin's private moderation reasoning.
    expect(src).not.toMatch(/admin_feedback: resolutionNotes/)
  })
})

describe('B-03-16 — leaving with money in flight warns both sides', () => {
  const src = read('app/actions/account.ts')

  it('deletion is gated on an explicit acknowledgement, not silently allowed', () => {
    expect(src).toContain('acknowledgeCommitments')
    expect(src).toContain('requiresCommitmentAcknowledgement')
  })

  it('only non-terminal fulfillments count — receipted and cancelled are done', () => {
    expect(src).toContain('IN_FLIGHT_FULFILLMENT_STATUSES')
    expect(src).not.toMatch(/IN_FLIGHT_FULFILLMENT_STATUSES = \[[^\]]*'receipted'/)
    expect(src).not.toMatch(/IN_FLIGHT_FULFILLMENT_STATUSES = \[[^\]]*'cancelled'/)
  })

  it('the sponsor is notified BEFORE the Clerk user is deleted', () => {
    // Afterwards the profile, team name and submission link are gone.
    const notifyAt = src.indexOf('has left the platform')
    const deleteAt = src.indexOf('clerk.users.deleteUser')
    expect(notifyAt).toBeGreaterThan(-1)
    expect(deleteAt).toBeGreaterThan(notifyAt)
  })

  it('the deletion is audited with the commitment count', () => {
    expect(src).toContain("action: 'delete_account'")
    expect(src).toContain('in_flight_commitments')
  })

  it('the UI blocks the button until the warning is acknowledged', () => {
    const ui = read('components/account/account-settings.tsx')
    expect(ui).toContain('commitmentWarning')
    expect(ui).toMatch(/!!commitmentWarning && !commitmentsAcknowledged/)
  })
})

describe('A-11-06 — the capacity detector is falsifiable', () => {
  const script = read('scripts/verify-capacity-invariant.mjs')

  it('a negative control proves detect_capacity_drift() can actually report drift', () => {
    expect(script).toContain('Negative control')
    expect(script).toContain('UPDATE sponsors SET funding_used_cents = funding_used_cents + 33300')
    expect(script).toContain('IF NOT FOUND THEN')
  })

  it('it also proves the detector falls silent again once the drift is repaired', () => {
    expect(script).toContain('UPDATE sponsors SET funding_used_cents = funding_used_cents - 33300')
    expect(script).toContain('negative control (restored)')
  })

  it('the new withdraw path is covered by the invariant suite', () => {
    expect(script).toContain('7. Withdraw')
  })
})

describe('A-03-03 — the proposal branch revalidates every affected surface', () => {
  const src = read('app/actions/sponsor-decision.ts')

  it('creating a pending proposal revalidates the inbox and dashboard, not only /approvals', () => {
    // The finding claimed the two SETTLE branches did not revalidate. They do, via
    // runDecisionFollowUp. The real gap was the inverse — this branch.
    const branch = src.slice(src.indexOf("revalidatePath('/sponsor/approvals')"), src.indexOf('pendingApproval: true'))
    expect(branch).toContain("revalidatePath('/sponsor/inbox')")
    expect(branch).toContain("revalidatePath('/sponsor/dashboard')")
  })

  it('runDecisionFollowUp still carries the settle-path revalidations', () => {
    const followUp = read('lib/decision-followup.ts')
    for (const p of ['/sponsor/dashboard', '/sponsor/inbox', '/dashboard']) {
      expect(followUp).toContain(`revalidatePath('${p}')`)
    }
  })
})

/**
 * B-03-08 — the governing-law clause. Phase 4 item 1.
 *
 * Section 11 of the effective `sponsorship_agreement` reads
 * `TODO(legal): jurisdiction to be set by counsel.` The P1 sweep deliberately did not
 * invent a jurisdiction, and that call stands: the executed record attests to the exact
 * bytes shown, SHA-256'd as evidence, so fabricating a governing-law clause into an
 * ESIGN/UETA document would be worse than the gap.
 *
 * What the P1 sweep got wrong was letting the signer proceed anyway. A-04-02 showed the
 * gate was always the intent — migration 0079's own header says an attorney must review
 * the seeded body "and an admin must clear the flag before this platform relies on it in a
 * real transaction". 0106 enforces it and the signing panel blocks.
 *
 * The item is therefore CLOSED as: the platform cannot execute an unreviewed agreement,
 * and the one remaining action is not an engineering one. It is recorded in
 * prompts/_NEXT-SESSION.md as the single thing Anish must obtain from counsel.
 */
describe('B-03-08 — an unreviewed agreement cannot be countersigned', () => {
  const migration = read('supabase/migrations/0106_legal_review_gate_and_orphan_fulfillments.sql')

  it('the DB refuses to sign while needs_legal_review is true', () => {
    expect(migration).toContain('IF v_template.needs_legal_review THEN')
    expect(migration).toContain("'template_needs_legal_review'")
  })

  it('the gate is the ONLY thing standing between the TODO and an executed document', () => {
    // If someone clears the flag without replacing the clause, the document executes with
    // the placeholder in it. That is a deliberate product decision (the flag means "counsel
    // has reviewed this"), not an oversight — but it must stay a conscious admin act.
    const approve = read('app/actions/agreements.ts')
    expect(approve).toContain('needs_legal_review: false')
    expect(approve).toContain('requireAdmin')
  })

  it('no jurisdiction was fabricated into the seeded template', () => {
    // The seeded body lives in migration 0079. If a future change writes a jurisdiction
    // there without counsel, this fails and someone has to justify it.
    const seed = read('supabase/migrations/0079_agreement_templates.sql')
    expect(seed).toContain('TODO(legal)')
    expect(seed).toContain('LEGAL REVIEW REQUIRED')
  })

  it('the signer is told it is blocked, not invited to sign anyway', () => {
    const panel = read('components/agreements/signing-panel.tsx')
    expect(panel).toContain('This agreement cannot be signed yet.')
    expect(panel).not.toContain('You can sign, and the signature is legally recorded')
  })
})
