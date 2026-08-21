/**
 * Agreements admin — access boundaries and the draft/publish flow.
 *
 * The security-boundary tests (unauthenticated + wrong-role redirects, public
 * specimen page) run unconditionally. The admin create/publish flow is gated
 * behind SUPABASE_LOCAL plus the seeded accounts from scripts/seed-test-accounts.mjs,
 * because it mutates real rows in agreement_templates.
 */

import { test, expect, type Page } from '@playwright/test'
import { signIn, gotoStable } from '../helpers/clerk-auth'

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin+clerk_test@example.com'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'AdminTest123!'
const COACH_EMAIL = process.env.COACH_EMAIL ?? 'coach+clerk_test@example.com'
const COACH_PASSWORD = process.env.COACH_PASSWORD ?? 'CoachTest123!'
const SPONSOR_EMAIL = process.env.SPONSOR_EMAIL ?? 'sponsor+clerk_test@example.com'
const SPONSOR_PASSWORD = process.env.SPONSOR_PASSWORD ?? 'SponsorTest123!'


test.describe('Agreements — access boundaries', () => {
  test('unauthenticated GET /agreements redirects to /login', async ({ page }) => {
    await gotoStable(page, '/agreements')
    await expect(page).toHaveURL(/\/login/)
  })

  test('signed-in coach is redirected off /agreements', async ({ page }) => {
    test.skip(!process.env.SUPABASE_LOCAL, 'Set SUPABASE_LOCAL=true to enable this test')
    await signIn(page, COACH_EMAIL, COACH_PASSWORD)
    await gotoStable(page, '/agreements')
    await expect(page).toHaveURL(/\/dashboard\?redirected=admin/)
  })

  test('signed-in sponsor is redirected off /agreements', async ({ page }) => {
    test.skip(!process.env.SUPABASE_LOCAL, 'Set SUPABASE_LOCAL=true to enable this test')
    await signIn(page, SPONSOR_EMAIL, SPONSOR_PASSWORD)
    await gotoStable(page, '/agreements')
    await expect(page).toHaveURL(/\/sponsor\/dashboard\?redirected=admin/)
  })

  test('unauthenticated GET /legal/agreement loads and shows the specimen notice', async ({ page }) => {
    const response = await page.goto('/legal/agreement')
    expect(response?.status()).toBe(200)
    await expect(page.getByText(/specimen/i).first()).toBeVisible()
  })
})

const VALID_BODY = [
  '<p>{{ team_name }} agrees to participate for the {{ season }} season under the terms set',
  'out below. The team confirms that all listed mentors are verified adults and that no',
  'student personal information will be shared with the sponsor at any point.</p>',
  '<p>The team agrees to acknowledge the sponsor in the manner described in the sponsorship',
  'record and to report on the use of funds at the end of the season.</p>',
].join(' ')

test.describe('Agreements — admin draft and publish flow', () => {
  test.skip(
    !process.env.SUPABASE_LOCAL || !process.env.ADMIN_EMAIL,
    'Set SUPABASE_LOCAL=true and ADMIN_EMAIL/ADMIN_PASSWORD (a seeded admin) to enable this test',
  )

  test('admin creates a draft, sees the unknown-token warning, fixes it, saves, and publishes', async ({ page }) => {
    await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    await gotoStable(page, '/agreements/team_participation/edit')

    /**
     * A published version cannot be deleted (`trg_agreement_template_no_delete` — it is a
     * legal record), so the second run of this test finds v1 already effective and the edit
     * route renders the read-only card instead of the editor. The test used to assume a
     * clean slate and hung waiting for a Title field that was not on the page. Branch on
     * what is actually there: open a fresh draft from the effective version when one exists.
     */
    const newVersion = page.getByRole('button', { name: /create version n\+1 from this/i })
    if (await newVersion.isVisible().catch(() => false)) {
      await newVersion.click()
      await expect(page.getByLabel(/title/i)).toBeVisible({ timeout: 20_000 })
    }

    await page.getByLabel(/title/i).fill('Team Participation Agreement')
    await page.locator('#agreement-consent').fill('By signing you consent to transact electronically under ESIGN/UETA law for this document.')
    await page.locator('#agreement-body').fill('<p>{{ bogus_field }}</p>')

    // Matched with the trailing colon so it hits the alert ("Unknown merge field(s): {{ … }}")
    // and not the preview pane's "Fix the unknown merge field(s) to see a preview.", which
    // otherwise makes this a strict-mode violation rather than a real assertion.
    await expect(page.getByText(/unknown merge field\(s\):/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /save draft/i })).toBeDisabled()

    // createAgreementDraftSchema requires a body of at least 200 characters, so a one-line
    // sample silently fails validation and the draft is never created — which then reads as
    // "the Publish button never appeared" several assertions later.
    await page.locator('#agreement-body').fill(VALID_BODY)
    await expect(page.getByText(/unknown merge field\(s\):/i)).not.toBeVisible()
    await expect(page.getByRole('button', { name: /save draft/i })).toBeEnabled()

    await page.getByRole('button', { name: /save draft/i }).click()
    await expect(page.getByRole('button', { name: /^publish$/i })).toBeVisible({ timeout: 10_000 })

    await page.getByRole('button', { name: /^publish$/i }).click()
    await expect(page).toHaveURL(/\/agreements\/team_participation$/, { timeout: 10_000 })
    await expect(page.getByText(/effective/i).first()).toBeVisible()
  })
})
