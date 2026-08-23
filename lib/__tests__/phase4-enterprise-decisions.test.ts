/**
 * Phase 4 — the five items the audit pack deliberately left open.
 *
 *   1. B-03-08 governing law   → closed; pinned in p2-groupA-money.test.ts
 *   2. A-12-01 org switcher    → BUILT (Anish: yes, a sponsor can belong to two orgs)
 *   3. A-12-04 PO / fiscal year→ BUILT (Anish: yes, build it end-to-end)
 *   4. EIN backfill            → closed by Phase 1: funding_receipts is empty in production
 *   5. B-04-05 live palette    → E2E added in tests/e2e/accessibility.spec.ts
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pickActiveSponsorId, ACTIVE_SPONSOR_COOKIE_OPTIONS } from '../active-sponsor-org'
import { ORG_ADMIN_WRITABLE_SPONSOR_COLUMNS } from '../sponsor-org-writes'
import { projectFulfillment, IMPACT_FULFILLMENT_FIELDS, IMPACT_FORBIDDEN_KEYS } from '../impact-report/projection'

const root = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
const readCode = (p: string) =>
  read(p).replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const ORG_A = '11111111-1111-4111-8111-111111111111'
const ORG_B = '22222222-2222-4222-8222-222222222222'
const ORG_OTHER = '33333333-3333-4333-8333-333333333333'

describe('A-12-01 — the active org is a preference, never an authorization', () => {
  it('a requested org the caller holds is honoured', () => {
    expect(pickActiveSponsorId(ORG_B, [ORG_A, ORG_B], ORG_A)).toBe(ORG_B)
  })

  it('THE SECURITY PROPERTY: an org the caller does not hold cannot be selected', () => {
    // The cookie is caller-controlled. This is the line that stops it mattering.
    expect(pickActiveSponsorId(ORG_OTHER, [ORG_A, ORG_B], ORG_A)).toBe(ORG_A)
  })

  it('it falls back SILENTLY rather than erroring, so it is not an org-id oracle', () => {
    expect(pickActiveSponsorId(ORG_OTHER, [ORG_A], ORG_A)).toBe(ORG_A)
    expect(pickActiveSponsorId('not-a-uuid', [ORG_A], ORG_A)).toBe(ORG_A)
    expect(pickActiveSponsorId(null, [ORG_A], ORG_A)).toBe(ORG_A)
    expect(pickActiveSponsorId(undefined, [ORG_A], ORG_A)).toBe(ORG_A)
    expect(pickActiveSponsorId('', [ORG_A], ORG_A)).toBe(ORG_A)
  })

  it('the cookie is httpOnly, so injected script cannot silently switch the active org', () => {
    expect(ACTIVE_SPONSOR_COOKIE_OPTIONS.httpOnly).toBe(true)
    expect(ACTIVE_SPONSOR_COOKIE_OPTIONS.sameSite).toBe('lax')
  })

  it('requireSponsor validates the cookie against memberships it resolved itself', () => {
    const src = read('lib/actions-utils.ts')
    expect(src).toContain('resolveActiveSponsorId(sponsorIds, defaultSponsorId)')
    // The rank must follow the ACTIVE org: org_admin of A and viewer of B must be a viewer
    // while acting as B. Reading it from profiles.sponsor_id would leak authority.
    expect(src).toContain('rows.find((m) => m.sponsor_id === sponsorId)')
  })

  it('the switch action refuses and AUDITS an org the caller does not hold', () => {
    const src = read('app/actions/sponsor-org-switch.ts')
    expect(src).toContain('if (!sponsorIds.includes(parsed.data.sponsorId))')
    expect(src).toContain("action: 'sponsor_org_switch_rejected'")
  })

  it('the one-org refusals are gone from BOTH places that enforced them', () => {
    expect(readCode('app/actions/sponsor-members.ts')).not.toContain(
      'This person already belongs to another sponsor organization.'
    )
    // The webhook's OTHER sponsor_member_sync_rejected — "profile role is not sponsor" —
    // is the P0-13 guard against flipping a coach/admin into a sponsor, and MUST stay.
    const hook = readCode('app/api/webhooks/clerk/route.ts')
    expect(hook).not.toContain('already a member of a different sponsor organization')
    expect(hook).toContain('profile role is not sponsor')
    // …but joining a second org is still recorded: it is a material access change.
    expect(read('app/api/webhooks/clerk/route.ts')).toContain('sponsor_member_joined_additional_org')
  })

  it('a duplicate membership of the SAME org is still refused', () => {
    const src = read('app/actions/sponsor-members.ts')
    expect(src).toContain('This person is already part of your team.')
    // Scoped .eq() rather than an unscoped maybeSingle(), which now throws on two rows.
    expect(src).toContain(".eq('sponsor_id', sponsorId)")
  })

  it('the layout can survive two memberships', () => {
    // .maybeSingle() over sponsor_members throws with two rows, which would have dropped a
    // fully provisioned user into the "Awaiting verification" branch.
    const layout = read('app/(sponsor)/layout.tsx')
    const block = layout.slice(layout.indexOf("from('sponsor_members')"))
    expect(block.slice(0, 300)).not.toContain('.maybeSingle()')
    expect(layout).toContain('resolveActiveSponsorId')
  })

  it('the switcher exposes names only — never another org’s budget', () => {
    const action = read('app/actions/sponsor-org-switch.ts')
    expect(action).toContain(".select('id, company_name')")
    for (const leak of ['funding_cap_cents', 'funding_used_cents', 'contact_email']) {
      expect(action, leak).not.toContain(leak)
    }
    expect(read('components/sponsor/org-switcher.tsx')).toContain('if (orgs.length < 2) return null')
  })
})

describe('A-12-04 — PO numbers and fiscal year, without a second budget', () => {
  const migration = read('supabase/migrations/0110_po_numbers_and_fiscal_year.sql')

  it('CAPACITY INTEGRITY: no second budget column was introduced', () => {
    // The finding asked to "migrate funding caps to be bucketed by year". Doing so would
    // put money state in two shapes. funding_cap_cents stays the single enforcement point.
    expect(migration).not.toMatch(/funding_cap_cents\s*=|ALTER COLUMN funding_cap_cents/)
    // No per-year budget column. (Scoped to the ALTER statements; the header comment
    // explains at length why one was not added.)
    const statements = migration.split('\n').filter((l) => /^\s*(ALTER TABLE|ADD COLUMN)/.test(l))
    expect(statements.join('\n')).not.toMatch(/budget/i)
    expect(migration).toContain('fiscal_year_start_month')
  })

  it('nothing resets funding_used_cents automatically', () => {
    // A silent reset is money state changing with no actor and no audit row.
    expect(migration).not.toMatch(/UPDATE\s+sponsors\s+SET\s+funding_used_cents/i)
  })

  it('the PO lives on funding_fulfillments, not on the immutable ledger', () => {
    expect(migration).toContain('ALTER TABLE funding_fulfillments')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS po_number text')
    expect(migration).not.toMatch(/ALTER TABLE transactions_ledger/)
  })

  it('the fiscal-year month is constrained to a real month', () => {
    expect(migration).toContain('CHECK (fiscal_year_start_month BETWEEN 1 AND 12)')
    expect(migration).toContain('DEFAULT 1') // existing sponsors keep calendar-year behaviour
  })

  it('an org admin may set the fiscal year but STILL not the funding cap', () => {
    expect(ORG_ADMIN_WRITABLE_SPONSOR_COLUMNS).toContain('fiscal_year_start_month')
    expect(ORG_ADMIN_WRITABLE_SPONSOR_COLUMNS).toContain('approval_required_above_cents')
    expect(ORG_ADMIN_WRITABLE_SPONSOR_COLUMNS).not.toContain('funding_cap_cents')
    expect(ORG_ADMIN_WRITABLE_SPONSOR_COLUMNS).not.toContain('status')
  })

  it('the PO action is tenant-scoped and audited', () => {
    const src = read('app/actions/sponsor-finance.ts')
    expect(src).toContain(".in('sponsor_id', sponsorIds)")
    expect(src).toContain("action: 'set_fulfillment_po_number'")
    expect(src).toContain("action: 'update_org_fiscal_year'")
  })

  it('the PO reaches the CSR report, and payment_reference still does not', () => {
    expect(IMPACT_FULFILLMENT_FIELDS).toContain('po_number')
    // A cheque/ACH number must never leave the row — a CSR report gets emailed around.
    expect(IMPACT_FULFILLMENT_FIELDS).not.toContain('payment_reference')
    expect(IMPACT_FORBIDDEN_KEYS).toContain('payment_reference')

    const projected = projectFulfillment({
      amount_cents: 50000,
      status: 'receipted',
      po_number: 'PO-2026-00412',
      payment_reference: 'CHECK-8891',
      notes: 'private',
    })
    expect(projected.po_number).toBe('PO-2026-00412')
    expect(projected).not.toHaveProperty('payment_reference')
    expect(projected).not.toHaveProperty('notes')
  })

  it('the CSR CSV carries the two columns a finance team reconciles by', () => {
    const src = read('app/api/sponsor/impact-report/route.ts')
    expect(src).toContain("'po_numbers'")
    expect(src).toContain("'fiscal_year'")
  })

  it('the UI states plainly that the fiscal year is not a budget reset', () => {
    // "Fiscal year" in a finance UI strongly implies a reset. It does not do that.
    const card = read('components/sponsor/fiscal-year-card.tsx')
    expect(card).toMatch(/does <strong>not<\/strong> reset your funding budget/)
  })
})

describe('Phase 4 — the other three items are closed, not pending', () => {
  it('B-03-08: an unreviewed agreement cannot be countersigned', () => {
    expect(read('supabase/migrations/0106_legal_review_gate_and_orphan_fulfillments.sql')).toContain(
      "'template_needs_legal_review'"
    )
  })

  it('B-04-05 / A-08-04: the palette is driven live, not inspected', () => {
    const spec = read('tests/e2e/accessibility.spec.ts')
    expect(spec).toContain('the global command palette traps focus and restores it on Escape')
  })

  it('the EIN backfill was closed forward-only, and the render is last-4', () => {
    // Phase 1 census against production: 0 hyphenated, 0 bare, 0 rows in funding_receipts,
    // so there is nothing to redact and no migration is owed. What must not regress is the
    // forward fix — receipts render last-4, never a full decrypted EIN.
    const doc = read('lib/receipt-document.tsx')
    expect(doc).toContain('payeeEinLast4')
    expect(doc).not.toMatch(/\bein_ciphertext\b/)
  })
})
