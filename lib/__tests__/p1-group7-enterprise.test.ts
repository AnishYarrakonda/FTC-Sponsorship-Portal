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

describe('A-12-01 — NOT BUILT, on purpose', () => {
  it('multi-org membership is deliberately refused today', () => {
    // The finding asks for an org switcher because "a user with two sponsor_members rows
    // has no way to select which org to view". The app never creates that state: the
    // Clerk webhook explicitly refuses a second-org membership and alerts admins.
    // Building a switcher would be reversing a deliberately enforced product invariant,
    // not fixing a defect — that is a product decision, not an audit fix.
    const hook = read('app/api/webhooks/clerk/route.ts')
    expect(hook).toContain('already a member of a different sponsor organization')
  })
})

describe('A-12-04 — NOT BUILT, on purpose', () => {
  it('there is still no po_number column, and that is the current state of record', () => {
    // PO numbers and fiscal-year budget buckets are net-new finance surface: a schema
    // change to transactions_ledger and sponsor_decision_proposals, a migration of
    // funding caps from all-time to per-year, and UI on every funding path. That is a
    // feature to specify, not a bug to fix, and half-building it would leave money
    // state in two shapes at once.
    const types = read('lib/supabase/types.ts')
    expect(types).not.toContain('po_number')
  })
})
