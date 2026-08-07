import { describe, it, expect } from 'vitest'
import { mapBudgetItems } from '@/lib/dispatch-budget'

/**
 * Regression net for the `$NaN` budget lines in the sponsor pitch email — the single
 * most visible defect in the product's outreach artifact.
 *
 * `app/actions/team.ts:17-26` writes `teams.budget_items` as snake_case
 * `{label, qty, unit_cost_cents, total_cents}`. `emails/submission-email.tsx:148` reads
 * `item.totalCents`. The old code bridged the two with a type ASSERTION:
 *
 *     budgetItems: team.budget_items as { …; unitCostCents: number; totalCents: number }[]
 *
 * An assertion is erased at compile time and checks nothing at runtime, so every line
 * rendered `undefined / 100` → `NaN` and the sponsor received:
 *
 *     2× REV Control Hub                        $NaN
 *     1× goBILDA Strafer Chassis Kit            $NaN
 *
 * `tsc` cannot catch this class of bug by construction, which is exactly why the
 * remediation prompt asks for a test rather than just a diff.
 */
describe('mapBudgetItems', () => {
  it('maps the stored snake_case shape to the camelCase the email template reads', () => {
    const stored = [
      { label: 'REV Control Hub', qty: 2, unit_cost_cents: 29900, total_cents: 59800 },
      { label: 'goBILDA Strafer Chassis Kit', qty: 1, unit_cost_cents: 44900, total_cents: 44900 },
      { label: 'Regional competition registration', qty: 3, unit_cost_cents: 21500, total_cents: 64500 },
    ]

    expect(mapBudgetItems(stored)).toEqual([
      { label: 'REV Control Hub', qty: 2, unitCostCents: 29900, totalCents: 59800 },
      { label: 'goBILDA Strafer Chassis Kit', qty: 1, unitCostCents: 44900, totalCents: 44900 },
      { label: 'Regional competition registration', qty: 3, unitCostCents: 21500, totalCents: 64500 },
    ])
  })

  it('never produces NaN for any rendered money value — the actual bug', () => {
    const stored = [{ label: 'REV Control Hub', qty: 2, unit_cost_cents: 29900, total_cents: 59800 }]

    for (const item of mapBudgetItems(stored)) {
      // This is precisely what emails/submission-email.tsx:148 computes.
      expect(Number.isNaN(item.totalCents / 100)).toBe(false)
      expect(Number.isNaN(item.unitCostCents / 100)).toBe(false)
      expect((item.totalCents / 100).toFixed(2)).toBe('598.00')
    }
  })

  it('is total garbage-in tolerant: never throws, never emits NaN', () => {
    // budget_items is untyped jsonb — a legacy or partially-written row must not take
    // down a dispatch, and must not silently render $NaN either.
    const cases: unknown[] = [
      null,
      undefined,
      'not an array',
      {},
      [{}],
      [{ label: 'Partial' }],
      [{ label: 'Nulls', qty: null, unit_cost_cents: null, total_cents: null }],
    ]

    for (const input of cases) {
      const result = mapBudgetItems(input)
      expect(Array.isArray(result)).toBe(true)
      for (const item of result) {
        expect(Number.isNaN(item.totalCents)).toBe(false)
        expect(Number.isNaN(item.unitCostCents)).toBe(false)
        expect(Number.isNaN(item.qty)).toBe(false)
        expect(typeof item.label).toBe('string')
      }
    }
  })

  it('does NOT silently accept an already-camelCase row (the shape that regressed)', () => {
    // If someone "fixes" a future writer to emit camelCase without updating this mapper,
    // the money must come through as 0 rather than NaN, and this test documents that.
    const camel = [{ label: 'Wrong shape', qty: 1, unitCostCents: 100, totalCents: 100 }]
    expect(mapBudgetItems(camel)[0]).toEqual({
      label: 'Wrong shape',
      qty: 1,
      unitCostCents: 0,
      totalCents: 0,
    })
  })
})
