/**
 * Agreements admin — access boundaries and the draft/publish flow.
 *
 * The security-boundary tests (unauthenticated + wrong-role redirects, public
 * specimen page) run unconditionally. The admin create/publish flow is gated
 * behind SUPABASE_LOCAL plus the seeded accounts from scripts/seed-test-accounts.mjs,
 * because it mutates real rows in agreement_templates.
 */

import { test, expect, type Page } from '@playwright/test'
import { clerk, setupClerkTestingToken } from '@clerk/testing/playwright'

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin+clerk_test@example.com'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'AdminTest123!'
const COACH_EMAIL = process.env.COACH_EMAIL ?? 'coach+clerk_test@example.com'
const COACH_PASSWORD = process.env.COACH_PASSWORD ?? 'CoachTest123!'
const SPONSOR_EMAIL = process.env.SPONSOR_EMAIL ?? 'sponsor+clerk_test@example.com'
const SPONSOR_PASSWORD = process.env.SPONSOR_PASSWORD ?? 'SponsorTest123!'

async function signIn(page: Page, email: string, password: string) {
  await setupClerkTestingToken({ page })
  await page.goto('/')
  await clerk.signOut({ page }).catch(() => {})
  await clerk.signIn({
    page,
    signInParams: { strategy: 'password', identifier: email, password },
  })
}

test.describe('Agreements — access boundaries', () => {
  test('unauthenticated GET /agreements redirects to /login', async ({ page }) => {
    await page.goto('/agreements')
    await expect(page).toHaveURL(/\/login/)
  })

  test('signed-in coach is redirected off /agreements', async ({ page }) => {
    test.skip(!process.env.SUPABASE_LOCAL, 'Set SUPABASE_LOCAL=true to enable this test')
    await signIn(page, COACH_EMAIL, COACH_PASSWORD)
    await page.goto('/agreements')
    await expect(page).toHaveURL(/\/dashboard\?redirected=admin/)
  })

  test('signed-in sponsor is redirected off /agreements', async ({ page }) => {
    test.skip(!process.env.SUPABASE_LOCAL, 'Set SUPABASE_LOCAL=true to enable this test')
    await signIn(page, SPONSOR_EMAIL, SPONSOR_PASSWORD)
    await page.goto('/agreements')
    await expect(page).toHaveURL(/\/sponsor\/dashboard\?redirected=admin/)
  })

  test('unauthenticated GET /legal/agreement loads and shows the specimen notice', async ({ page }) => {
    const response = await page.goto('/legal/agreement')
    expect(response?.status()).toBe(200)
    await expect(page.getByText(/specimen/i).first()).toBeVisible()
  })
})

test.describe('Agreements — admin draft and publish flow', () => {
  test.skip(
    !process.env.SUPABASE_LOCAL || !process.env.ADMIN_EMAIL,
    'Set SUPABASE_LOCAL=true and ADMIN_EMAIL/ADMIN_PASSWORD (a seeded admin) to enable this test',
  )

  test('admin creates a draft, sees the unknown-token warning, fixes it, saves, and publishes', async ({ page }) => {
    await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    await page.goto('/agreements/team_participation/edit')

    await page.getByLabel(/title/i).fill('Team Participation Agreement')
    await page.locator('#agreement-consent').fill('By signing you consent to transact electronically under ESIGN/UETA law for this document.')
    await page.locator('#agreement-body').fill('<p>{{ bogus_field }}</p>')

    await expect(page.getByText(/unknown merge field/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /save draft/i })).toBeDisabled()

    await page.locator('#agreement-body').fill('<p>{{ team_name }} agrees to participate for {{ season }}.</p>')
    await expect(page.getByText(/unknown merge field/i)).not.toBeVisible()
    await expect(page.getByRole('button', { name: /save draft/i })).toBeEnabled()

    await page.getByRole('button', { name: /save draft/i }).click()
    await expect(page.getByRole('button', { name: /^publish$/i })).toBeVisible({ timeout: 10_000 })

    await page.getByRole('button', { name: /^publish$/i }).click()
    await expect(page).toHaveURL(/\/agreements\/team_participation$/, { timeout: 10_000 })
    await expect(page.getByText(/effective/i).first()).toBeVisible()
  })
})
