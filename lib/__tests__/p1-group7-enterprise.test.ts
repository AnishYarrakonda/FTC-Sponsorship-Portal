/**
 * Regression cover for Group 7 (enterprise gaps, A-12).
 *
 * Two of the four were built. The other two are recorded here as deliberate
 * non-work, with the evidence, so a later reader does not "finish" them by accident.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

describe('A-12-02 — a departing member leaves no orphaned proposals', () => {
  const lib = read('lib/sponsor-offboarding.ts')

  it('withdraws only their PENDING proposals, in their own org', () => {
    expect(lib).toContain("eq('status', 'pending')")
    expect(lib).toContain("eq('proposed_by', profileId)")
    expect(lib).toContain("eq('sponsor_id', sponsorId)")
  })

  it('records why, so the row is distinguishable from a real withdrawal', () => {
    expect(lib).toContain("closed_reason: 'proposer_offboarded'")
  })

  it('does not reassign or auto-confirm', () => {
    // A proposal is a person's recommendation to commit money. There is no honest way to
    // transfer authorship, and confirming on their behalf would commit funds nobody
    // currently in the org approved.
    expect(lib).not.toMatch(/status:\s*'confirmed'/)
    // Scoped to the UPDATE payload — `proposed_by` legitimately appears in the audit
    // metadata, which records who the departing proposer was.
    const update = lib.slice(lib.indexOf('.update({'), lib.indexOf(".eq('sponsor_id', sponsorId)"))
    expect(update).not.toContain('proposed_by')
  })

  it('is wired into BOTH offboarding paths', () => {
    expect(read('app/actions/sponsor-members.ts')).toContain('withdrawProposalsForDepartedMember')
    expect(read('app/api/webhooks/clerk/route.ts')).toContain('withdrawProposalsForDepartedMember')
  })
})

describe('A-12-03 — SCIM deprovisioning cannot leave an org headless', () => {
  const lib = read('lib/sponsor-offboarding.ts')
  const hook = read('app/api/webhooks/clerk/route.ts')

  it('promotes the LONGEST-TENURED remaining member', () => {
    // Not the highest-ranked: an approver is not automatically the right person to run
    // the org, and seniority is the only signal available that is not a guess about the
    // company's internal structure.
    expect(lib).toContain("order('created_at', { ascending: true })")
    expect(lib).toContain("role: 'org_admin'")
  })

  it('only acts when there is genuinely no admin left', () => {
    expect(lib).toMatch(/if \(\(adminCount \?\? 0\) > 0\) return \{ promoted: null, headless: false \}/)
  })

  it('the webhook repairs rather than refuses', () => {
    // Returning non-2xx would make Svix redeliver forever against a membership that is
    // already gone in Clerk — the A-01-02 failure mode.
    expect(hook).toContain('backfillOrgAdminIfHeadless')
    expect(hook).not.toMatch(/organizationMembership\.deleted[\s\S]{0,2500}last_admin[\s\S]{0,80}status: 500/)
  })

  it('tells admins, because an automatic promotion needs human review', () => {
    expect(hook).toContain('auto-promoted a new admin')
    expect(lib).toContain('sponsor_org_admin_backfilled')
  })

  it('never throws — a failure here must not become a webhook 500', () => {
    expect(lib).not.toMatch(/^\s*throw /m)
  })
})

describe('A-12-01 — SUPERSEDED: now BUILT', () => {
  /**
   * This block used to assert the opposite: that multi-org membership was deliberately
   * refused, and that building a switcher would reverse an enforced product invariant.
   *
   * That was the correct read of the code at the time, and the decision was correctly
   * escalated rather than made unilaterally. Anish answered it in the Phase 4 close:
   * a sponsor user CAN legitimately belong to two organizations (an agency contact, a
   * parent company and a subsidiary), so the invariant was a limitation rather than a
   * safeguard, and the switcher is built.
   *
   * The behaviour is now pinned in lib/__tests__/phase4-enterprise-decisions.test.ts,
   * including the part that actually matters: the active-org cookie is caller-controlled
   * and is re-validated against real memberships on every request.
   */
  it('a second organization is no longer refused, but is still audited', () => {
    const hook = read('app/api/webhooks/clerk/route.ts')
    expect(hook).not.toContain('already a member of a different sponsor organization')
    expect(hook).toContain('sponsor_member_joined_additional_org')
  })

  it('the P0-13 guard is untouched: a coach/admin is still never flipped to sponsor', () => {
    const hook = read('app/api/webhooks/clerk/route.ts')
    expect(hook).toContain('profile role is not sponsor')
  })
})

describe('A-12-04 — BUILT in 0110, then REMOVED in 0111', () => {
  /**
   * Short life. The finding asked for PO numbers and a fiscal-year boundary; 0110 built
   * both; 0111 removed the fulfillment and receipt surfaces they existed to annotate. A PO
   * number is a reference for a payment the platform no longer records, so keeping the
   * column would have been money state in exactly the two shapes this finding warned about.
   *
   * What survives, and is the part that always mattered: funding caps were never bucketed
   * by year, so funding_cap_cents remains the single enforcement point for Capacity
   * Integrity. That is asserted here against the live schema rather than the migration,
   * because it is a property of the system and not of one file.
   */
  it('the PO number and fiscal-year column are gone, not half-present', () => {
    const types = read('lib/supabase/types.ts')
    expect(types).not.toContain('po_number')
    expect(types).not.toContain('fiscal_year_start_month')
  })

  it('funding caps are still not bucketed by year — one source of truth for capacity', () => {
    const types = read('lib/supabase/types.ts')
    expect(types).toContain('funding_cap_cents')
    // A per-year cap column would be the drift this finding was really about.
    expect(types).not.toMatch(/funding_cap_cents_\d{4}|funding_cap_by_year/)
  })
})
