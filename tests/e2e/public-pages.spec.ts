import { test, expect } from '@playwright/test'

test.describe('Public pages (no auth required)', () => {
  test('landing page shows hero and CTAs', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('h1')).toBeVisible()
    await expect(page.getByRole('link', { name: /open portal/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /sponsor a team/i })).toBeVisible()
  })

  test('landing page links to /signup and /sponsors/apply', async ({ page }) => {
    await page.goto('/')
    const coachLink = page.getByRole('link', { name: /open portal/i })
    await expect(coachLink).toHaveAttribute('href', '/signup')
    const sponsorLink = page.getByRole('link', { name: /sponsor a team/i })
    await expect(sponsorLink).toHaveAttribute('href', '/sponsors/apply')
  })

  test('terms of service page renders', async ({ page }) => {
    await page.goto('/legal/terms')
    await expect(page.getByRole('heading', { name: /terms of service/i })).toBeVisible()
    await expect(page.getByText(/acceptance of terms/i)).toBeVisible()
  })

  test('privacy policy page renders', async ({ page }) => {
    await page.goto('/legal/privacy')
    await expect(page.getByRole('heading', { name: /privacy/i })).toBeVisible()
  })

  // Prompt 16 replaced the flat sponsor form with a three-step wizard
  // (components/auth/sponsor-signup-wizard.tsx): step 1 creates the Clerk account, step 2
  // collects the company, step 3 the sponsorship terms. Company/contact fields are no longer
  // on the first paint, and the submit button only exists on the last step.
  test('sponsor application wizard renders step 1', async ({ page }) => {
    await page.goto('/sponsors/apply')
    // "Sponsor Registration" is rendered via shadcn CardTitle (a <div>), not a heading element.
    await expect(page.getByText(/sponsor registration/i)).toBeVisible()
    await expect(page.getByText(/step 1 of 3/i)).toBeVisible()
    await expect(page.getByLabel(/representative name/i)).toBeVisible()
    await expect(page.getByLabel(/work email address/i)).toBeVisible()
    await expect(page.getByLabel(/^password$/i)).toBeVisible()
    // The advance control is labelled "Next" (it becomes "Submit Application" on step 3).
    await expect(page.getByRole('button', { name: /^next$/i })).toBeVisible()
    // The corporate-email gate is stated up front, not only on rejection.
    await expect(page.getByText(/use your work email/i)).toBeVisible()
  })

  test('sponsor wizard will not advance past step 1 with an empty form', async ({ page }) => {
    await page.goto('/sponsors/apply')
    // Disabled until Clerk's client loads, because advancing step 1 creates the account.
    const next = page.getByRole('button', { name: /^next$/i })
    await expect(next).toBeEnabled()
    await next.click()
    // RHF + zod validate in place: no navigation, and still on step 1.
    await expect(page).toHaveURL(/\/sponsors\/apply/)
    await expect(page.getByText(/step 1 of 3/i)).toBeVisible()
    await expect(page.getByLabel(/representative name/i)).toBeVisible()
  })

  test('unauthenticated access to /dashboard redirects to /login', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login/)
  })

  test('unauthenticated access to /moderation redirects to /login', async ({ page }) => {
    await page.goto('/moderation')
    await expect(page).toHaveURL(/\/login/)
  })
})
