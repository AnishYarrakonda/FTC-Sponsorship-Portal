/**
 * Portfolio sections smoke test.
 *
 * Post-merge, the coach dashboard Portfolio tab is organised into 7 sections
 * (Achievements first, slim Robot & Engineering last). This suite just checks
 * that every section heading renders for the seeded verified coach.
 *
 * Gated like the golden-path suite: requires SUPABASE_LOCAL=true plus the
 * seeded coach from scripts/seed-test-accounts.mjs (override with
 * COACH_EMAIL / COACH_PASSWORD).
 */

import { test, expect } from '@playwright/test'
import { signIn } from '../helpers/clerk-auth'

const COACH_EMAIL = process.env.COACH_EMAIL ?? 'coach+clerk_test@example.com'
const COACH_PASSWORD = process.env.COACH_PASSWORD ?? 'CoachTest123!'

// Order matters for the first/last assertions below.
const SECTION_HEADINGS = [
  /achievements\s*&\s*awards/i,
  /team story\s*&\s*people/i,
  /credibility/i,
  /community\s*&\s*ethics impact/i,
  /goals\s*&\s*funding ask/i,
  /media/i,
  /robot\s*&\s*engineering/i,
]


test.describe('Coach portfolio — 7 sections', () => {
  test.skip(
    !process.env.SUPABASE_LOCAL,
    'Set SUPABASE_LOCAL=true and run with local Supabase to enable full E2E tests'
  )

  test('portfolio tab shows all 7 section headings', async ({ page }) => {
    await signIn(page, COACH_EMAIL, COACH_PASSWORD)

    await page.goto('/dashboard?tab=portfolio', { timeout: 30_000 })

    // Wait for the tab content to hydrate before asserting on sections.
    await expect(page.getByText(SECTION_HEADINGS[0]).first()).toBeVisible({ timeout: 20_000 })

    for (const heading of SECTION_HEADINGS) {
      // Prefer real headings, but fall back to any text node — section titles
      // may render via CardTitle (<div>) rather than <h*> elements.
      const byRole = page.getByRole('heading', { name: heading })
      const target = (await byRole.count()) > 0 ? byRole.first() : page.getByText(heading).first()
      await expect(target, `section heading ${heading} should be visible`).toBeVisible({
        timeout: 10_000,
      })
    }
  })

  test('Achievements section renders above Robot & Engineering', async ({ page }) => {
    await signIn(page, COACH_EMAIL, COACH_PASSWORD)
    await page.goto('/dashboard?tab=portfolio', { timeout: 30_000 })

    const achievements = page.getByText(/achievements\s*&\s*awards/i).first()
    const robot = page.getByText(/robot\s*&\s*engineering/i).first()
    await expect(achievements).toBeVisible({ timeout: 20_000 })
    await expect(robot).toBeVisible({ timeout: 10_000 })

    const [top, bottom] = await Promise.all([
      achievements.boundingBox(),
      robot.boundingBox(),
    ])
    expect(top, 'achievements bounding box').toBeTruthy()
    expect(bottom, 'robot bounding box').toBeTruthy()
    expect(top!.y).toBeLessThan(bottom!.y)
  })
})
