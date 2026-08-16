import { test, expect } from '@playwright/test'

test.describe('Fulfillment UI Security & Workflow Boundaries', () => {
  /**
   * These specs drive role switching through `GET /api/dev/bypass?role=…`. That route does
   * not exist in this repo and never has — the dev bypass is an env flag read at server
   * start (`NEXT_PUBLIC_DEV_AUTH_BYPASS`, lib/dev-bypass.ts), not an HTTP endpoint, so a
   * single run cannot switch roles by navigation. Every assertion below therefore ran
   * against `/login` and failed for the wrong reason.
   *
   * Skipped rather than deleted: the coverage they describe (prompt 03's sponsor/coach/admin
   * boundary checks) is still owed, and a permanently-red spec teaches everyone to ignore a
   * red suite. Unskip by giving each role a real seeded Clerk session, the way
   * receipts.spec.ts and sponsor-organizations.spec.ts already do. Tracked in
   * docs/verification-backlog.md under prompt 03.
   */
  test.skip(
    true,
    'Targets GET /api/dev/bypass, which does not exist. Needs real seeded sessions — see docs/verification-backlog.md (prompt 03).'
  )

  test('1 & 5. Sponsor view boundary: only own commitments visible & no coach controls', async ({ page }) => {
    await page.goto('/api/dev/bypass?role=sponsor')
    await page.goto('/sponsor/funding')

    await expect(page.locator('h1', { hasText: 'Funding' })).toBeVisible()
    await expect(page.locator('text=Total Committed')).toBeVisible()

    // Assert sponsor sees NO "Confirm funds received" or "Confirm Receipt" control
    await expect(page.locator('button', { hasText: 'Confirm Receipt' })).toHaveCount(0)
    await expect(page.locator('button', { hasText: 'Confirm funds received' })).toHaveCount(0)
  })

  test('3 & 5. Coach view boundary: only own team pledges visible & no sponsor controls', async ({ page }) => {
    await page.goto('/api/dev/bypass?role=coach')
    await page.goto('/dashboard?tab=funding')

    await expect(page.locator('h2', { hasText: 'Funding' })).toBeVisible()

    // Assert coach sees NO "Mark payment sent" control
    await expect(page.locator('button', { hasText: 'Mark Payment Sent' })).toHaveCount(0)
    await expect(page.locator('button', { hasText: 'Mark payment sent' })).toHaveCount(0)
  })

  test('4. Non-admin redirects: coach and sponsor landing on /reconciliation get redirected', async ({ page }) => {
    // Coach navigation redirect to /dashboard?redirected=admin
    await page.goto('/api/dev/bypass?role=coach')
    await page.goto('/reconciliation')
    await expect(page).toHaveURL(/.*\/dashboard\?redirected=admin/)

    // Sponsor navigation redirect to /sponsor/dashboard?redirected=admin
    await page.goto('/api/dev/bypass?role=sponsor')
    await page.goto('/reconciliation')
    await expect(page).toHaveURL(/.*\/sponsor\/dashboard\?redirected=admin/)
  })

  test('7. Payment reference masking and client-side toggle', async ({ page }) => {
    await page.goto('/api/dev/bypass?role=sponsor')
    await page.goto('/sponsor/funding')

    const showButton = page.locator('button', { hasText: 'Show' }).first()
    if (await showButton.isVisible()) {
      await showButton.click()
      await expect(page.locator('button', { hasText: 'Hide' }).first()).toBeVisible()
    }
  })

  test('8. Cron route auth boundary: unauthenticated and wrong bearer return JSON 401', async ({ request }) => {
    // No Authorization header -> 401 JSON (not HTML redirect)
    const noAuth = await request.get('/api/cron/nudge-fulfillments')
    expect(noAuth.status()).toBe(401)
    const noAuthJson = await noAuth.json()
    expect(noAuthJson).toEqual({ error: 'Unauthorized' })

    // Invalid bearer token -> 401 JSON
    const wrongAuth = await request.get('/api/cron/nudge-fulfillments', {
      headers: { Authorization: 'Bearer invalid_secret_token_123' },
    })
    expect(wrongAuth.status()).toBe(401)
    const wrongAuthJson = await wrongAuth.json()
    expect(wrongAuthJson).toEqual({ error: 'Unauthorized' })
  })

  test('9 & 10. Cron route execution idempotency', async ({ request }) => {
    const cronSecret = process.env.CRON_SECRET || 'test_secret'
    const res = await request.get('/api/cron/nudge-fulfillments', {
      headers: { Authorization: `Bearer ${cronSecret}` },
    })

    // If secret matches local env, assert JSON response shape
    if (res.status() === 200) {
      const data = await res.json()
      expect(data).toHaveProperty('scanned')
      expect(data).toHaveProperty('nudged_sponsor')
      expect(data).toHaveProperty('nudged_coach')
      expect(data).toHaveProperty('escalated_admin')
    }
  })

  test('11 & 12. Admin reconciliation table and override legal transition bounds', async ({ page }) => {
    await page.goto('/api/dev/bypass?role=admin')
    await page.goto('/reconciliation')

    await expect(page.locator('h1', { hasText: 'Fulfillment Reconciliation' })).toBeVisible()
    await expect(page.locator('text=Pledged Volume')).toBeVisible()

    const overrideBtn = page.locator('button', { hasText: 'Override' }).first()
    if (await overrideBtn.isVisible()) {
      await overrideBtn.click()
      await expect(page.locator('text=Admin Override')).toBeVisible()
      await expect(page.locator('text=An override is recorded against your account')).toBeVisible()
    }
  })
})

