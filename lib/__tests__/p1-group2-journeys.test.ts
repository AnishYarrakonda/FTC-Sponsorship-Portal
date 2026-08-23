/**
 * Regression cover for the Group 2 (journeys / correctness) P1 findings.
 *
 * Most of this group failed silently — a dashboard reading $0, a payer called "Sponsor",
 * a control nothing mounted — so the assertions pin the property that was violated rather
 * than the shape of today's markup.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

describe('B-03-04 — the coach dashboard reads columns it actually fetched', () => {
  const page = read('app/(coach)/dashboard/page.tsx')

  it('selects season and requested_amount_cents', () => {
    const select = page.match(/\.select\('id, status, admin_feedback[^']*'\)/)?.[0] ?? ''
    expect(select).toContain('season')
    expect(select).toContain('requested_amount_cents')
  })

  it('no longer reads them through an `as any` cast', () => {
    // The cast is what hid the missing column from tsc, so the coach's own progress bar
    // read "$0 of $X · 0%" while the ledger said $1,200. Same class as the $NaN
    // budget-item defect in lib/dispatch.ts.
    expect(page).not.toMatch(/\(s as any\)\.requested_amount_cents/)
    expect(page).not.toMatch(/\(s as any\)\.season/)
  })
})

describe('B-03-03 — the payer is named on the coach funding surface', () => {
  const page = read('app/(coach)/dashboard/page.tsx')

  it('does not embed sponsors on funding_fulfillments', () => {
    // sponsors_select is is_admin(); sponsors_select_own is current_sponsor_ids(). A coach
    // matches neither, so the embed resolved to null on every row and funding-tab fell
    // back to the literal string 'Sponsor'.
    expect(page).not.toMatch(/from\('funding_fulfillments'\)[\s\S]{0,80}sponsors\(company_name\)/)
  })

  it('resolves names from v_sponsors_public instead', () => {
    const resolver = page.slice(page.indexOf('B-03-03'))
    expect(resolver).toContain('v_sponsors_public')
    expect(resolver).toContain('f.sponsors = ')
  })
})

describe('B-03-02 — rich text is never shown as raw markup', () => {
  it('sponsor-facing surfaces RENDER it, agreeing with the token page', () => {
    for (const f of ['components/sponsor/review-shell.tsx', 'components/impact/impact-report-view.tsx']) {
      const src = read(f)
      expect(src, f).toContain('RichText')
      expect(src, f).toMatch(/RichText[\s\S]{0,120}mission_statement|mission_statement[\s\S]{0,120}RichText/)
    }
  })

  it('admin + coach previews FLATTEN it, matching their sibling fields', () => {
    const mod = read('components/admin/moderation-queue.tsx')
    for (const field of ['mission_statement', 'technical_summary', 'outreach_summary']) {
      expect(mod, field).toContain(`htmlToPlainText(team?.${field})`)
    }
    // The coach snapshot is line-clamped, which needs a text child — RichText's nested
    // <p> would break the clamp.
    const dash = read('components/coach/dashboard-shell.tsx')
    expect(dash).toContain('htmlToPlainText(team.mission_statement)')
  })

  it('leaves the dispatch email alone — it already strips tags', () => {
    expect(read('emails/submission-email.tsx')).toContain('stripTags')
  })
})

describe('B-03-05 — the payment gate is explained and routable', () => {
  it('agreement_not_signed has human copy', () => {
    const src = read('app/actions/fulfillment.ts')
    expect(src).toContain("case 'agreement_not_signed'")
    expect(src).toMatch(/agreement has not been signed/i)
  })

  it('the default branch no longer leaks raw database codes', () => {
    const src = read('app/actions/fulfillment.ts')
    expect(src).not.toMatch(/default:\s*return error\b/)
    expect(src).toMatch(/unmapped transition error code/)
  })

  it('the funding row offers a route to sign, gated on rank', () => {
    const row = read('components/sponsor/sponsor-fulfillment-row.tsx')
    expect(row).toContain('/sign')
    expect(row).toContain("hasSponsorRole(memberRole, 'approver')")
    // and distinguishes "you have not signed" from "waiting on the coach"
    expect(row).toMatch(/Waiting on the coach/)
  })

  it('the page reads coach signatures through the admin client, since RLS hides them', () => {
    const page = read('app/(sponsor)/sponsor/funding/page.tsx')
    expect(page).toMatch(/adminClient[\s\S]{0,200}agreement_signatures/)
    // Minimal columns only — no signature payload, no PII.
    expect(page).toContain("select('submission_id, signer_role')")
  })
})

describe('B-03-06 — receipt controls are reachable', () => {
  const page = read('app/(admin)/reconciliation/page.tsx')

  it('receipted fulfillments get a table of their own', () => {
    expect(page).toContain('receiptedRows')
    expect(page).toMatch(/ReconciliationTable[\s\S]{0,160}receiptedRows/)
  })

  it('ReconciliationTable is still the only mount point for the controls', () => {
    // If this stops being true the fix above is no longer load-bearing — but if it is
    // true and receipted rows are excluded again, the controls vanish silently.
    const table = read('components/admin/reconciliation-table.tsx')
    expect(table).toContain('receipt-actions')
  })
})

describe('B-03-07 / A-03-02 — partial funding works from the portal', () => {
  const action = read('app/actions/sponsor-decision.ts')

  it('the schema accepts an amount', () => {
    expect(action).toMatch(/amountCents: z\.number\(\)\.int\(\)\.positive\(\)\.optional\(\)/)
  })

  it('neither RPC call hardcodes 0 any more', () => {
    expect(action).toMatch(/create_sponsor_decision_proposal[\s\S]{0,400}p_amount_cents: partialAmountCents/)
    expect(action).toMatch(/sponsor_decide_submission_atomic[\s\S]{0,400}p_amount_cents: partialAmountCents/)
  })

  it('refuses an offer larger than the ask', () => {
    // The RPC treats `p_amount_cents < v_reserved` as partial and anything else as
    // "fund in full", so an over-ask amount would silently commit MORE than was offered.
    expect(action).toContain('A partial offer cannot exceed the full request.')
  })

  it('judges the approval threshold against what is actually committed', () => {
    expect(action).toMatch(/committedAmountCents = partialAmountCents > 0 \? partialAmountCents : fullAmountCents/)
  })

  it('refuses an amount on a non-approval decision', () => {
    expect(action).toContain('An amount can only be offered when approving a sponsorship.')
  })

  it('the console exposes it', () => {
    const shell = read('components/sponsor/review-shell.tsx')
    expect(shell).toContain('Offer Partial Amount')
    // Labelled field, not a bare placeholder: this decides how much a team receives.
    expect(shell).toContain('htmlFor="portal-partial-amount"')
    expect(shell).toContain('role="alert"')
  })
})

describe('B-03-08 — the signer is told the agreement is unreviewed', () => {
  it('needsLegalReview reaches the panel', () => {
    expect(read('lib/agreements/provider.ts')).toContain('needsLegalReview')
    expect(read('lib/agreements/in-house-provider.ts')).toContain('needs_legal_review')
  })

  it('the panel warns before signature, and only when flagged', () => {
    const panel = read('components/agreements/signing-panel.tsx')
    expect(panel).toContain('document.needsLegalReview')
    expect(panel).toMatch(/not been reviewed by counsel/i)
  })

  it('does NOT invent a governing-law clause', () => {
    // Fabricating a jurisdiction into a document executed under ESIGN/UETA, with a
    // SHA-256 of the exact bytes stored as evidence, would be worse than the gap.
    const migrations = read('supabase/migrations/0079_agreement_templates.sql')
    expect(migrations).toContain('TODO(legal)')
  })
})

describe('A-03-01 — the EIN reveal validates its input', () => {
  const src = read('app/actions/admin-payout.ts')

  it('safeParses teamId and target', () => {
    expect(src).toContain('safeParse')
    expect(src).toContain('z.string().uuid()')
    expect(src).toContain("z.enum(['payee', 'fiscal_sponsor'])")
  })

  it('uses the parsed values, not the raw arguments', () => {
    expect(src).toContain('p_team_id: parsed.data.teamId')
    expect(src).toContain('p_target: parsed.data.target')
  })
})

describe('A-03-05 — audit_log failures are no longer swallowed', () => {
  it('writeAudit reports and never throws', () => {
    const src = read('lib/audit.ts')
    expect(src).toContain('Sentry.captureException')
    expect(src).toContain('console.error')
    // Must not throw: a failed audit write cannot be allowed to fail a mutation that has
    // already committed.
    expect(src).not.toMatch(/^\s*throw /m)
  })

  it('no action still fires an unchecked audit insert', () => {
    const files = [
      'app/actions/admin.ts',
      'app/actions/moderation.ts',
      'app/actions/submission.ts',
      'app/actions/agreements-sign.ts',
      'app/actions/receipt.ts',
      'app/actions/sponsor.ts',
      'app/api/webhooks/clerk/route.ts',
    ]
    for (const f of files) {
      const src = read(f)
      const unchecked = src.match(/^\s*await [^\n=]*\.from\('audit_log'\)\.insert\(/m)
      expect(unchecked, `${f} still has an unchecked audit insert`).toBeNull()
    }
  })
})

describe('A-01-01 / A-01-02 — account deletion cannot loop forever', () => {
  const src = read('app/api/webhooks/clerk/route.ts')

  it('checks the super-admin floor BEFORE purging storage', () => {
    // Order is the whole fix: the old code destroyed the user's government ID and only
    // then discovered the profile delete was impossible.
    const floorCheck = src.indexOf('super_admin_floor')
    const purge = src.indexOf('purgeUserStorage(supabase, clerkUserId)')
    expect(floorCheck).toBeGreaterThan(-1)
    expect(purge).toBeGreaterThan(-1)
    expect(floorCheck).toBeLessThan(purge)
  })

  it('returns 200 on a refusal so Svix stops retrying', () => {
    expect(src).toMatch(/blocked: 'super_admin_floor'/)
    expect(src).toContain("code === '23514'")
  })

  it('captures sponsor memberships before the cascade destroys them', () => {
    const capture = src.indexOf('orgIdsToCheck')
    const del = src.indexOf(".from('profiles')\n          .delete()")
    expect(capture).toBeGreaterThan(-1)
    if (del > -1) expect(capture).toBeLessThan(del)
  })

  it('deactivates an org left with no members and no legacy owner', () => {
    expect(src).toContain('sponsor_org_orphaned_deactivated')
    expect(src).toMatch(/legacyOwners/)
    expect(src).toMatch(/status: 'inactive'/)
  })
})

describe('0104 — an override reason survives the actor being deleted', () => {
  it('the CHECK no longer requires overridden_by', () => {
    const sql = read('supabase/migrations/0104_override_reason_survives_actor_deletion.sql')
    // overridden_by is ON DELETE SET NULL, so requiring it NOT NULL made the overriding
    // admin permanently undeletable — the same forever-retry as A-01-02, on a far more
    // common actor.
    expect(sql).toContain('override_reason IS NOT NULL')
    expect(sql).not.toMatch(/CHECK[\s\S]{0,120}overridden_by IS NOT NULL/)
  })
})
