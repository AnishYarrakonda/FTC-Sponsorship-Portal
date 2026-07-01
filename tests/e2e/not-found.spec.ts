/**
 * Public/authed 404 smoke tests.
 *
 * Verifies that unknown resources render the friendly not-found UI instead of
 * crashing (no Next.js "Application error" overlay, correct 404 semantics).
 *
 * Gated the same way as the golden-path suite: requires a local Supabase
 * (`SUPABASE_LOCAL=true`) so the dev server can actually query the DB. The
 * authed case uses the seeded coach account from scripts/seed-test-accounts.mjs
 * (override with COACH_EMAIL / COACH_PASSWORD).
 */

import { test, expect, type Page } from '@playwright/test'
import { clerk, setupClerkTestingToken } from '@clerk/testing/playwright'

const COACH_EMAIL = process.env.COACH_EMAIL ?? 'coach+clerk_test@example.com'
const COACH_PASSWORD = process.env.COACH_PASSWORD ?? 'CoachTest123!'

async function signIn(page: Page, email: string, password: string) {
  await setupClerkTestingToken({ page })
  await page.goto('/')
  await clerk.signOut({ page }).catch(() => {})
  await clerk.signIn({
    page,
    signInParams: { strategy: 'password', identifier: email, password },
  })
}

test.describe('Not-found resilience', () => {
  test.skip(
    !process.env.SUPABASE_LOCAL,
    'Set SUPABASE_LOCAL=true and run with local Supabase to enable full E2E tests'
  )

  test('nonexistent public team slug renders not-found UI, not a crash', async ({ page }) => {
    const response = await page.goto('/teams/nonexistent-slug-xyz-12345', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    })

    // notFound() should produce a 404 response, never a 500.
    expect(response?.status()).toBe(404)

    // The friendly not-found UI renders (root app/not-found.tsx or closer boundary).
    await expect(
      page.getByText(/not found|doesn't exist|doesn&apos;t exist/i).first()
    ).toBeVisible({ timeout: 15_000 })

    // And it's not the Next.js hard-crash screen.
    await expect(page.getByText(/application error/i)).toHaveCount(0)
  })

  test('invalid coach submission id renders pitch not-found UI, not a crash', async ({ page }) => {
    await signIn(page, COACH_EMAIL, COACH_PASSWORD)

    const response = await page.goto(
      '/submissions/00000000-0000-0000-0000-000000000000/edit',
      { waitUntil: 'domcontentloaded', timeout: 30_000 }
    )

    // Depending on team state this may 404 (guard fired) but must never 500.
    expect(response?.status()).toBeLessThan(500)

    // Either the segment not-found.tsx ("Pitch not found") or a redirect to a
    // safe page (awaiting-verification when the coach has no team) is fine —
    // the page must render something meaningful, not crash.
    await expect(page.getByText(/application error/i)).toHaveCount(0)

    const url = page.url()
    if (!/awaiting-verification|dashboard/.test(url)) {
      await expect(
        page.getByText(/pitch not found|doesn't exist or was removed/i).first()
      ).toBeVisible({ timeout: 15_000 })
    }
  })

  test('unknown public route renders the root 404 page', async ({ page }) => {
    // Must use a public route prefix (see middleware.ts): unknown non-public
    // paths are redirected to /login by clerkMiddleware before Next can 404.
    const response = await page.goto('/legal/definitely-not-a-real-page-xyz', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    })
    expect(response?.status()).toBe(404)
    await expect(page.getByText(/page not found/i).first()).toBeVisible({ timeout: 15_000 })
  })

  test('unknown non-public route redirects to /login instead of crashing', async ({ page }) => {
    const response = await page.goto('/definitely-not-a-real-route-xyz', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    })
    expect(response?.status()).toBeLessThan(500)
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 })
  })
})
