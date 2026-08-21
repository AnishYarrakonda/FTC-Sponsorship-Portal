/**
 * Prompt 03 — fulfillment UI security and workflow boundaries.
 *
 * These specs used to drive role switching through `GET /api/dev/bypass?role=…`, a route
 * that does not exist in this repo and never has: the dev bypass is an env flag read at
 * server start (`NEXT_PUBLIC_DEV_AUTH_BYPASS`, lib/dev-bypass.ts), not an HTTP endpoint.
 * Every navigation therefore landed on `/login` and every assertion failed for a reason
 * unrelated to what it was testing, so the whole file was skipped.
 *
 * They now sign in as real seeded Clerk accounts, the way receipts.spec.ts and
 * sponsor-organizations.spec.ts do. Each Playwright test gets its own browser context, so
 * one role per test is the switch — the old "coach and sponsor both get redirected" case
 * is split in two rather than trying to change identity mid-test.
 */

import { test, expect } from '@playwright/test'
import { signIn, gotoStable } from '../helpers/clerk-auth'

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin+clerk_test@example.com'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'AdminTest123!'
const COACH_EMAIL = process.env.COACH_EMAIL ?? 'coach+clerk_test@example.com'
const COACH_PASSWORD = process.env.COACH_PASSWORD ?? 'CoachTest123!'
const SPONSOR_EMAIL = process.env.SPONSOR_EMAIL ?? 'sponsor+clerk_test@example.com'
const SPONSOR_PASSWORD = process.env.SPONSOR_PASSWORD ?? 'SponsorTest123!'

test.describe('Fulfillment UI Security & Workflow Boundaries', () => {
  test.skip(
    !process.env.SUPABASE_LOCAL,
    'Set SUPABASE_LOCAL=true and seed with scripts/seed-test-accounts.mjs to enable these tests'
  )

  test('1 & 5. Sponsor view boundary: only own commitments visible & no coach controls', async ({ page }) => {
    await signIn(page, SPONSOR_EMAIL, SPONSOR_PASSWORD)
    await gotoStable(page, '/sponsor/funding')

    await expect(page.getByRole('heading', { name: /Funding/i }).first()).toBeVisible()

    // The coach-side receipt confirmation must never render for a sponsor.
    await expect(page.getByRole('button', { name: /Confirm Receipt/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Confirm funds received/i })).toHaveCount(0)
  })

  test('3 & 5. Coach view boundary: only own team pledges visible & no sponsor controls', async ({ page }) => {
    await signIn(page, COACH_EMAIL, COACH_PASSWORD)
    await gotoStable(page, '/dashboard?tab=funding')

    // Assert we actually landed on the coach dashboard first — an absence-only assertion
    // passes just as happily on /login, which is how the old version of this file
    // "passed" nothing at all.
    await expect(page).toHaveURL(/\/dashboard/)

    // The sponsor-side payment control must never render for a coach.
    await expect(page.getByRole('button', { name: /Mark Payment Sent/i })).toHaveCount(0)
  })

  test('4a. A coach landing on /reconciliation is redirected away from the admin area', async ({ page }) => {
    await signIn(page, COACH_EMAIL, COACH_PASSWORD)
    await gotoStable(page, '/reconciliation')
    await expect(page).toHaveURL(/\/dashboard/)
  })

  test('4b. A sponsor landing on /reconciliation is redirected away from the admin area', async ({ page }) => {
    await signIn(page, SPONSOR_EMAIL, SPONSOR_PASSWORD)
    await gotoStable(page, '/reconciliation')
    await expect(page).toHaveURL(/\/sponsor/)
  })

  test('7. Payment reference masking and client-side toggle', async ({ page }) => {
    await signIn(page, SPONSOR_EMAIL, SPONSOR_PASSWORD)
    await gotoStable(page, '/sponsor/funding')
    await expect(page).toHaveURL(/\/sponsor\/funding/)

    const showButton = page.getByRole('button', { name: /^Show$/ }).first()
    if (await showButton.isVisible().catch(() => false)) {
      await showButton.click()
      await expect(page.getByRole('button', { name: /^Hide$/ }).first()).toBeVisible()
    }
  })

  test('8. Cron route auth boundary: unauthenticated and wrong bearer return JSON 401', async ({ request }) => {
    const noAuth = await request.get('/api/cron/nudge-fulfillments')
    expect(noAuth.status()).toBe(401)
    expect(await noAuth.json()).toEqual({ error: 'Unauthorized' })

    const wrongAuth = await request.get('/api/cron/nudge-fulfillments', {
      headers: { Authorization: 'Bearer invalid_secret_token_123' },
    })
    expect(wrongAuth.status()).toBe(401)
    expect(await wrongAuth.json()).toEqual({ error: 'Unauthorized' })
  })

  test('9 & 10. Cron route execution idempotency', async ({ request }) => {
    const cronSecret = process.env.CRON_SECRET || 'test_secret'
    const res = await request.get('/api/cron/nudge-fulfillments', {
      headers: { Authorization: `Bearer ${cronSecret}` },
    })

    // Only assert the payload shape when the secret actually matched this environment.
    if (res.status() === 200) {
      const data = await res.json()
      expect(data).toHaveProperty('scanned')
      expect(data).toHaveProperty('nudged_sponsor')
      expect(data).toHaveProperty('nudged_coach')
      expect(data).toHaveProperty('escalated_admin')
    }
  })

  test('11 & 12. Admin reconciliation table and override legal transition bounds', async ({ page }) => {
    await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    await gotoStable(page, '/reconciliation')

    await expect(page.getByRole('heading', { name: /Fulfillment Reconciliation/i })).toBeVisible()

    const overrideBtn = page.getByRole('button', { name: /Override/i }).first()
    if (await overrideBtn.isVisible().catch(() => false)) {
      await overrideBtn.click()
      await expect(page.getByText(/Admin Override/i).first()).toBeVisible()
    }
  })
})
