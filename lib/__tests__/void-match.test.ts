/**
 * Void-a-match: the replacement for the only post-acceptance capacity release the platform
 * had before 0111 (cancelling a fulfillment, migration 0095).
 *
 * These are source/migration assertions, not a live DB run -- the end-to-end behaviour
 * (capacity returns to its pre-approval value, the sponsor flips inactive -> active, and
 * detect_capacity_drift() stays at zero) is exercised by
 * scripts/verify-capacity-invariant.mjs against a real database.
 *
 * What is pinned here is the DESIGN, because each piece of it is a thing a well-meaning
 * future edit would plausibly undo.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

const migration = read('supabase/migrations/0111_strip_post_match_pipeline.sql')
const action = read('app/actions/void-match.ts')

describe('a void is a compensating ledger row, never a delete', () => {
  it('the RPC inserts a NEGATIVE row rather than mutating or removing the original', () => {
    const fn = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.void_match_atomic'),
      migration.indexOf('REVOKE EXECUTE ON FUNCTION public.void_match_atomic')
    )
    expect(fn).toContain('INSERT INTO transactions_ledger')
    expect(fn).toContain('-v_net')
    // The ledger is append-only and is now the complete record of a match. Deleting or
    // updating the original row would destroy the evidence that the match ever happened.
    expect(fn).not.toMatch(/DELETE\s+FROM\s+transactions_ledger/i)
    expect(fn).not.toMatch(/UPDATE\s+transactions_ledger/i)
  })

  it('the sign and the decision_type cannot disagree', () => {
    // Without this constraint a void could be written positive, which would DOUBLE the
    // recorded commitment instead of reversing it.
    expect(migration).toContain('transactions_ledger_void_sign_check')
    expect(migration).toContain("CHECK ((decision_type = 'void') = (amount_cents < 0))")
  })

  it('capacity is floored at zero and the sponsor is reactivated, matching 0095', () => {
    const fn = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.void_match_atomic'),
      migration.indexOf('REVOKE EXECUTE ON FUNCTION public.void_match_atomic')
    )
    expect(fn).toContain('GREATEST(funding_used_cents - v_net, 0)')
    expect(fn).toContain("'active'::sponsor_status")
  })

  it('a second void is refused rather than double-crediting the sponsor', () => {
    const fn = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.void_match_atomic'),
      migration.indexOf('REVOKE EXECUTE ON FUNCTION public.void_match_atomic')
    )
    // Idempotency comes from NETTING the ledger, not from looking up one row -- so a
    // partially-reversed submission cannot be credited again either.
    expect(fn).toContain('SUM(tl.amount_cents)')
    expect(fn).toContain('already_voided')
  })
})

describe('detect_capacity_drift keeps working after the fulfillment layer is gone', () => {
  it('it no longer reads the dropped funding_capacity_releases table', () => {
    // This is the bug the migration nearly shipped: the function is introduced in 0084 over
    // submissions + transactions_ledger only, but 0095 later added a third term against
    // funding_capacity_releases. Reading 0084 alone says it is unaffected by 0111; the live
    // body says otherwise. Left unrepaired it would throw on every call -- silently
    // DISABLING the Capacity Integrity check rather than failing it.
    const fn = migration.slice(
      migration.indexOf('CREATE FUNCTION public.detect_capacity_drift'),
      migration.indexOf('COMMENT ON FUNCTION detect_capacity_drift')
    )
    expect(fn).not.toContain('funding_capacity_releases')
    expect(fn).toContain('transactions_ledger')
    expect(fn).toContain('reserved_amount_cents')
  })

  it('the released term is not replaced by anything, because voids net themselves out', () => {
    expect(migration).toContain('s.funding_used_cents <> r.open_cents + l.settled_cents')
  })
})

describe('the action follows the canonical 5-step shape', () => {
  it('validates, requires admin, audits, and notifies both parties', () => {
    expect(action).toContain('voidMatchSchema.safeParse')
    expect(action).toContain('requireAdmin()')
    expect(action).toContain('writeAudit(')
    // Both sides were told a match existed; both must be told it does not.
    expect(action).toContain('sponsorRecipientProfiles')
    expect(action).toMatch(/recipientId: coachId/)
  })

  it('a reason is mandatory in BOTH the action and the RPC', () => {
    // The action guard alone would be bypassed by any future service-role caller.
    expect(action).toMatch(/min\(10/)
    expect(migration).toContain('reason_required')
  })

  it('RPC error codes are mapped to human copy, never returned raw', () => {
    // B-03-05: a raw database code in the UI is the defect this repo already fixed once.
    expect(action).toContain("'not_approved'")
    expect(action).toContain("'already_voided'")
    expect(action).toContain('unmapped RPC error code')
  })
})
