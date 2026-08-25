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
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { pickActiveSponsorId, ACTIVE_SPONSOR_COOKIE_OPTIONS } from '../active-sponsor-org'
import { ORG_ADMIN_WRITABLE_SPONSOR_COLUMNS } from '../sponsor-org-writes'
import { IMPACT_LEDGER_FIELDS, IMPACT_FORBIDDEN_KEYS } from '../impact-report/projection'

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

describe('Phase 4 — the remaining items are closed, not pending', () => {
  // B-03-08 (an unreviewed agreement must not be countersignable) is retired: 0111 removed
  // the agreement layer outright, so there is no signature to gate. What survives from that
  // finding is the principle that no engineer invents a jurisdiction -- pinned in
  // p2-groupA-money.test.ts against the Terms, which still carry the open governing-law gap.

  it('B-04-05 / A-08-04: the palette is driven live, not inspected', () => {
    const spec = read('tests/e2e/accessibility.spec.ts')
    expect(spec).toContain('the global command palette traps focus and restores it on Escape')
  })

  it('no EIN, encrypted or otherwise, survives anywhere in the tree', () => {
    // The original finding was that a receipt could render a full decrypted EIN. 0111
    // deleted receipts, payout profiles and the EIN crypto helpers entirely, which closes
    // it far more thoroughly than redaction did -- so the assertion becomes the stronger
    // one: the concept is gone, not merely masked.
    const hits = execSync(
      "grep -rl 'ein_ciphertext\\|payeeEinLast4\\|PAYOUT_ENCRYPTION_KEY' app lib components emails --exclude-dir=__tests__ || true",
      { cwd: process.cwd(), encoding: 'utf8' }
    ).trim()
    expect(hits).toBe('')
  })
})
