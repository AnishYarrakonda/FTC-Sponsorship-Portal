/**
 * Coach denial flow smoke test.
 *
 * Post-merge flow: an admin denies a pending coach with a reason
 * (profiles.denial_reason / denied_at); the coach then sees the denial state on
 * /awaiting-verification with the reason and a re-upload CTA.
 *
 * Gating (same pattern as golden-path):
 *   SUPABASE_LOCAL=true             — local Supabase must be running
 *   ADMIN_EMAIL / ADMIN_PASSWORD    — seeded admin (admin+clerk_test@example.com)
 *   DENIAL_COACH_EMAIL / DENIAL_COACH_PASSWORD
 *     — a seeded coach that is UNVERIFIED with credentials uploaded (i.e. shows
 *       under "Awaiting Verification" on /coaches). This account gets denied by
 *       the test, so don't reuse the main verified coach account.
 *
 * Tests run serially: the deny must happen before the coach-side check.
 */

import { test, expect, type Page } from '@playwright/test'
import { clerk, setupClerkTestingToken } from '@clerk/testing/playwright'

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? ''
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? ''
const COACH_EMAIL = process.env.DENIAL_COACH_EMAIL ?? ''
const COACH_PASSWORD = process.env.DENIAL_COACH_PASSWORD ?? ''

// Unique reason so the coach-side assertion can't match stale data.
const DENIAL_REASON = `E2E denial ${Date.now()}: the provided ID is expired, please upload a valid one.`

async function signIn(page: Page, email: string, password: string) {
  await setupClerkTestingToken({ page })
  await page.goto('/')
  await clerk.signOut({ page }).catch(() => {})
  await clerk.signIn({
    page,
    signInParams: { strategy: 'password', identifier: email, password },
  })
}

test.describe.serial('Coach denial flow', () => {
  test.skip(
    !process.env.SUPABASE_LOCAL || !ADMIN_EMAIL || !COACH_EMAIL,
    'Set SUPABASE_LOCAL=true, ADMIN_EMAIL/ADMIN_PASSWORD and DENIAL_COACH_EMAIL/DENIAL_COACH_PASSWORD (an unverified coach with uploaded credentials) to enable the denial-flow E2E test'
  )

  test('1. Admin denies the pending coach with a reason', async ({ page }) => {
    await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    await page.goto('/coaches', { timeout: 30_000 })

    // Find the pending coach's verification card by their email and open the
    // application review dialog.
    const card = page
      .locator('div')
      .filter({ hasText: COACH_EMAIL })
      .filter({ has: page.getByRole('button', { name: /review application/i }) })
      .last()
    await expect(card, `pending card for ${COACH_EMAIL}`).toBeVisible({ timeout: 20_000 })
    await card.getByRole('button', { name: /review application/i }).click()

    const reviewDialog = page.getByRole('dialog').filter({ hasText: /application review/i })
    await expect(reviewDialog).toBeVisible({ timeout: 15_000 })

    // Open the nested deny dialog, fill the reason, confirm.
    await reviewDialog.getByRole('button', { name: /deny application/i }).click()
    const denyDialog = page.getByRole('dialog').filter({ hasText: /reason for denial/i })
    await expect(denyDialog).toBeVisible({ timeout: 10_000 })
    await denyDialog.getByLabel(/reason for denial/i).fill(DENIAL_REASON)
    await denyDialog.getByRole('button', { name: /confirm denial/i }).click()

    // Deny dialog should close once the server action completes.
    await expect(denyDialog).not.toBeVisible({ timeout: 20_000 })
  })

  test('2. Denied coach sees the denial reason and a re-upload CTA', async ({ page }) => {
    await signIn(page, COACH_EMAIL, COACH_PASSWORD)

    await page.goto('/awaiting-verification', { timeout: 30_000 })

    // Denial state: the reason recorded by the admin is shown verbatim...
    await expect(page.getByText(/denied|not approved/i).first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(DENIAL_REASON.slice(0, 40)).first()).toBeVisible({
      timeout: 10_000,
    })

    // ...alongside a CTA to re-upload credentials (link or button, wording may
    // vary post-merge — anything pointing at the upload flow counts).
    const ctaLink = page.getByRole('link', { name: /upload|re-?submit|try again/i })
    const ctaButton = page.getByRole('button', { name: /upload|re-?submit|try again/i })
    const cta = (await ctaLink.count()) > 0 ? ctaLink.first() : ctaButton.first()
    await expect(cta, 're-upload CTA').toBeVisible({ timeout: 10_000 })
  })
})
