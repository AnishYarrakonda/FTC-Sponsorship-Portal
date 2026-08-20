import { test, expect } from '@playwright/test'
import { setupClerkTestingToken } from '@clerk/testing/playwright'

test.describe('Auth pages', () => {
  test('login page renders form', async ({ page }) => {
    await setupClerkTestingToken({ page })
    await page.goto('/login')
    await expect(page.getByLabel(/email address/i)).toBeVisible()
    await expect(page.getByLabel(/password/i)).toBeVisible()
    // The submit control is "Log In"; "Sign Up" is the header link to /signup.
    await expect(page.getByRole('button', { name: /log in/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /sign up/i })).toBeVisible()
  })

  test('login shows error for invalid credentials', async ({ page }) => {
    await setupClerkTestingToken({ page })
    await page.goto('/login')
    await page.getByLabel(/email address/i).fill('nobody@nowhere.invalid')
    await page.getByLabel(/password/i).fill('wrongpassword')
    await page.getByRole('button', { name: /log in/i }).click()
    await expect(page.locator('[role="alert"]')).toBeVisible({ timeout: 8000 })
  })

  // Coach signup is a three-step wizard (app/(auth)/signup): step 1 is account credentials,
  // step 2 email verification, step 3 the team. There is no single "Create account" button —
  // step 1 advances with "Next", so these assert the step-1 contract.
  test('signup step 1 renders all credential fields', async ({ page }) => {
    await page.goto('/signup')
    await expect(page.getByText(/coach registration/i)).toBeVisible()
    await expect(page.getByText(/step 1 of 3/i)).toBeVisible()
    await expect(page.getByLabel(/full name/i)).toBeVisible()
    await expect(page.getByLabel(/email address/i)).toBeVisible()
    await expect(page.getByLabel(/^password$/i)).toBeVisible()
    await expect(page.getByLabel(/confirm password/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /^next$/i })).toBeVisible()
  })

  test('signup will not advance past step 1 with mismatched passwords', async ({ page }) => {
    await page.goto('/signup')
    await page.getByLabel(/full name/i).fill('Test Coach')
    await page.getByLabel(/email address/i).fill('test@example.com')
    await page.getByLabel(/^password$/i).fill('Password123!')
    await page.getByLabel(/confirm password/i).fill('Different123!')
    await page.getByRole('button', { name: /^next$/i }).click()
    // Zod rejects in place: no navigation, and the wizard stays on step 1.
    await expect(page).toHaveURL(/\/signup/)
    await expect(page.getByText(/step 1 of 3/i)).toBeVisible()
  })

  test('signup will not advance past step 1 with a weak password', async ({ page }) => {
    await page.goto('/signup')
    await page.getByLabel(/full name/i).fill('Test Coach')
    await page.getByLabel(/email address/i).fill('test@example.com')
    await page.getByLabel(/^password$/i).fill('weak')
    await page.getByLabel(/confirm password/i).fill('weak')
    await page.getByRole('button', { name: /^next$/i }).click()
    await expect(page).toHaveURL(/\/signup/)
    await expect(page.getByText(/step 1 of 3/i)).toBeVisible()
  })

  // Clerk owns email verification inline in the wizard, so /verify-email is now only a
  // signpost for anyone who lands on the old URL — it has copy and links, but no heading.
  test('verify-email page renders its signpost copy', async ({ page }) => {
    await page.goto('/verify-email')
    await expect(page.getByText(/email verification is handled during sign up/i)).toBeVisible()
    await expect(page.getByRole('link', { name: /go to login/i })).toBeVisible()
  })

  test('nav header offers both auth entry points when logged out', async ({ page }) => {
    await page.goto('/')
    // The header signs up under the product's own wording ("Open portal"), not "Sign up" —
    // assert the destinations rather than the copy, so a marketing reword cannot fail this.
    const header = page.locator('header')
    await expect(header.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login')
    await expect(header.getByRole('link', { name: /open portal/i })).toHaveAttribute('href', '/signup')
  })
})
