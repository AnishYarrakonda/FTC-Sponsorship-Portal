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

describe('0111 — the agreement and fulfillment layers stay gone', () => {
  const migration = read('supabase/migrations/0111_strip_post_match_pipeline.sql')

  it('the signature gate is removed, not merely bypassed', () => {
    // A-04-03 and A-04-02 both lived in record_fulfillment_transition / sign_agreement_atomic.
    // Neither function exists now; this asserts nobody reintroduces the callee.
    expect(migration).toContain('DROP FUNCTION IF EXISTS agreement_is_signed(uuid)')
    expect(migration).toContain('DROP FUNCTION IF EXISTS record_fulfillment_transition')
  })

  it('the decision RPC no longer writes a fulfillment row', () => {
    // The body in this migration was patched from a LIVE pg_get_functiondef dump. If a
    // future edit rebuilds it from 0100 instead, the fulfillment inserts come back AND the
    // 0101 anon-actor fix (A-02-02) silently disappears -- so both are pinned here.
    const fn = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.sponsor_decide_submission_atomic'),
      migration.indexOf('REVOKE EXECUTE ON FUNCTION public.sponsor_decide_submission_atomic')
    )
    expect(fn).not.toContain('funding_fulfillment')
    expect(fn).toContain('is_trusted_server_context()')
    expect(fn).toContain('v_prior_reserved')
  })

  it('capacity can still be given back, or a dead match burns a sponsor cap forever', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.void_match_atomic')
    expect(migration).toContain("'void'")
    // The compensating row must be negative; a positive one would double-count the match.
    expect(migration).toContain('transactions_ledger_void_sign_check')
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

  it('only LIVE commitments count — a voided match must not warn or notify', () => {
    // The fulfillment status list this used to check went with 0111. The equivalent test
    // now is that the ledger is NETTED per submission: a void is a negative row, so a match
    // the sponsor already unwound sums to zero and drops out. Without the netting a coach
    // would be warned about, and a sponsor notified of, a commitment that no longer exists.
    expect(src).toContain('netBySubmission')
    expect(src).toMatch(/amountCents > 0/)
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

describe('B-03-08 — nobody invents a jurisdiction', () => {
  /**
   * Filed when the seeded sponsorship_agreement carried
   *     TODO(legal): jurisdiction to be set by counsel.
   * and nothing stopped it being executed. 0111 removed the agreement layer outright, which
   * closes it -- but the PRINCIPLE has one artifact left: Terms of Service section 13 still
   * says the governing law and venue "have not yet been fixed".
   *
   * That is the honest state and it blocks nothing. What must not happen is an engineer
   * quietly filling in a jurisdiction to tidy the copy. This test exists to make that edit
   * fail loudly and route it to counsel instead.
   */
  it('the Terms still defer governing law to counsel rather than naming one', () => {
    const terms = read('app/legal/terms/page.tsx')
    expect(terms).toContain('ATTORNEY REVIEW REQUIRED')
    expect(terms).toMatch(/have not yet been fixed/)
  })

  it('no sponsorship agreement template survives to be signed', () => {
    const migration = read('supabase/migrations/0111_strip_post_match_pipeline.sql')
    expect(migration).toContain('DROP TABLE IF EXISTS agreement_templates')
    expect(migration).toContain('DROP FUNCTION IF EXISTS sign_agreement_atomic')
  })
})
