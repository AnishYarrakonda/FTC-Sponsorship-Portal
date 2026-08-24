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
import { createClient } from '@supabase/supabase-js'
import { signIn, gotoStable } from '../helpers/clerk-auth'
import type { Database } from '../../lib/supabase/types'

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin+clerk_test@example.com'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'AdminTest123!'
// Defaulted like the rest. These were bare `?? ''`, so the skip gate below was always
// true and this suite never ran. The denied coach is seeded by
// scripts/seed-test-accounts.mjs.
const COACH_EMAIL = process.env.DENIAL_COACH_EMAIL ?? 'denial-coach+clerk_test@example.com'
const COACH_PASSWORD = process.env.DENIAL_COACH_PASSWORD ?? 'DenialCoachTest123!'

// Unique reason so the coach-side assertion can't match stale data.
const DENIAL_REASON = `E2E denial ${Date.now()}: the provided ID is expired, please upload a valid one.`


test.describe.serial('Coach denial flow', () => {
  test.skip(
    !process.env.SUPABASE_LOCAL || !ADMIN_EMAIL || !COACH_EMAIL,
    'Set SUPABASE_LOCAL=true, ADMIN_EMAIL/ADMIN_PASSWORD and DENIAL_COACH_EMAIL/DENIAL_COACH_PASSWORD (an unverified coach with uploaded credentials) to enable the denial-flow E2E test'
  )

  /**
   * Test 1 denies the coach, which takes them out of the "Awaiting Verification" queue
   * the same test needs to find them in. Without this reset the spec passes exactly once
   * per seed and fails on every re-run — which is how it failed inside a full sweep after
   * having passed in isolation minutes earlier. Put the application back to undecided.
   */
  test.beforeAll(async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
    if (!serviceKey) return
    const admin = createClient<Database>(url, serviceKey)

    const { data: profile, error: readErr } = await admin
      .from('profiles')
      .select('clerk_user_id')
      .eq('email', COACH_EMAIL)
      .single()
    if (readErr) throw new Error(`could not load the denial-flow coach: ${readErr.message}`)

    /**
     * Denying a coach purges their credential, which drops them out of the
     * "Awaiting Verification" queue entirely — /coaches keys that queue on
     * (!coach_verified && !!coach_credentials_url). Restoring the column is what makes
     * the application pending again, so put the storage object back behind it too rather
     * than leaving the reviewer's document viewer pointed at nothing.
     */
    const credentialsPath = `${profile!.clerk_user_id}/dev-denial-coach-id.png`
    const placeholderPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    )
    await admin.storage
      .from('coach-credentials')
      .upload(credentialsPath, placeholderPng, { contentType: 'image/png', upsert: true })

    const { error } = await admin
      .from('profiles')
      .update({
        coach_verified: false,
        coach_credentials_url: credentialsPath,
        coach_credentials_purged_at: null,
        denial_reason: null,
        denied_at: null,
      })
      .eq('email', COACH_EMAIL)
    if (error) throw new Error(`could not reset the denial-flow coach: ${error.message}`)
  })

  test('1. Admin denies the pending coach with a reason', async ({ page }) => {
    await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    await gotoStable(page, '/coaches', { timeout: 30_000 })

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

    await gotoStable(page, '/awaiting-verification', { timeout: 30_000 })

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
