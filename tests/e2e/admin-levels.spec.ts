/**
 * Admin levels — reviewer vs super admin (prompt 11 / migration 0084).
 *
 * The seeded admin from scripts/seed-test-accounts.mjs is a SUPER admin: 0084 backfills
 * every pre-existing admin to super_admin. There is no seeded reviewer, so the reviewer
 * half is gated behind REVIEWER_EMAIL / REVIEWER_PASSWORD — demote a second admin to
 * `reviewer` from /admin/team (or with a direct UPDATE) and export those two vars:
 *
 *   SUPABASE_LOCAL=1 REVIEWER_EMAIL=reviewer+clerk_test@example.com \
 *   REVIEWER_PASSWORD='ReviewerTest123!' npx playwright test admin-levels
 *
 * The Vitest suite in lib/__tests__/admin-levels.test.ts is the unconditional proof of the
 * boundary; this file is the once-in-the-browser confirmation the acceptance criteria ask
 * for.
 */

import { test, expect, type Page } from '@playwright/test'
import { clerk, setupClerkTestingToken } from '@clerk/testing/playwright'

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin+clerk_test@example.com'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'AdminTest123!'
const REVIEWER_EMAIL = process.env.REVIEWER_EMAIL
const REVIEWER_PASSWORD = process.env.REVIEWER_PASSWORD

async function signIn(page: Page, email: string, password: string) {
  await setupClerkTestingToken({ page })
  await page.goto('/')
  await clerk.signOut({ page }).catch(() => {})
  await clerk.signIn({
    page,
    signInParams: { strategy: 'password', identifier: email, password },
  })
}

test.describe('Admin team page — access', () => {
  test('unauthenticated GET /admin/team redirects to /login', async ({ page }) => {
    await page.goto('/admin/team')
    await expect(page).toHaveURL(/\/login/)
  })

  test('a super admin sees the roster and the level control', async ({ page }) => {
    test.skip(!process.env.SUPABASE_LOCAL, 'Set SUPABASE_LOCAL=true to enable this test')
    await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    await page.goto('/admin/team')

    await expect(page.getByRole('heading', { name: 'Admin team' })).toBeVisible()
    await expect(page.getByText('Add an admin')).toBeVisible()
    // Own row renders as static text with the reason, not a broken-looking disabled select.
    await expect(page.getByText('You cannot change your own level')).toBeVisible()
  })
})

test.describe('Reviewer boundaries', () => {
  test.skip(
    !process.env.SUPABASE_LOCAL || !REVIEWER_EMAIL || !REVIEWER_PASSWORD,
    'Set SUPABASE_LOCAL, REVIEWER_EMAIL and REVIEWER_PASSWORD to enable these tests'
  )

  test('a reviewer still gets the moderation queue', async ({ page }) => {
    await signIn(page, REVIEWER_EMAIL!, REVIEWER_PASSWORD!)
    await page.goto('/moderation')
    await expect(page).toHaveURL(/\/moderation/)
  })

  test('a reviewer sees the permission-denied card on /admin/team', async ({ page }) => {
    await signIn(page, REVIEWER_EMAIL!, REVIEWER_PASSWORD!)
    await page.goto('/admin/team')

    await expect(page.getByText('Super admin access required')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Go to the review queue' })).toBeVisible()
    await expect(page.getByText('Add an admin')).toHaveCount(0)
  })

  test('the funding-cap input is disabled for a reviewer', async ({ page }) => {
    await signIn(page, REVIEWER_EMAIL!, REVIEWER_PASSWORD!)
    await page.goto('/sponsors')

    const firstEdit = page.getByRole('link', { name: /edit/i }).first()
    test.skip((await firstEdit.count()) === 0, 'No sponsor rows seeded to edit')
    await firstEdit.click()

    const capInput = page.getByLabel('Annual Funding Cap (USD)')
    await expect(capInput).toBeDisabled()
    await expect(page.getByText('Only a super admin can change a funding cap.')).toBeVisible()
  })

  test('GET /api/admin/export returns JSON 403, not a redirect', async ({ page }) => {
    await signIn(page, REVIEWER_EMAIL!, REVIEWER_PASSWORD!)
    const response = await page.request.get('/api/admin/export')
    expect(response.status()).toBe(403)
    expect(await response.json()).toEqual({ error: 'Forbidden' })
  })

  test('a reviewer can still reach the capacity audit', async ({ page }) => {
    await signIn(page, REVIEWER_EMAIL!, REVIEWER_PASSWORD!)
    await page.goto('/admin/capacity')
    await expect(page.getByRole('heading', { name: 'Capacity audit' })).toBeVisible()
  })
})
