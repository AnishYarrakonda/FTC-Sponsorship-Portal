/**
 * Golden Path E2E: verified coach drafts a pitch → submits it → admin approves and
 * dispatches it → the numbers show up on the analytics page.
 *
 * ## Why this file no longer drives signup
 *
 * It used to open with "coach signs up", filling a flat form and clicking "Create account".
 * That form has not existed since the signup wizard landed, and the suite was not marked
 * serial — so the four "coach flow" tests each ran in a different worker, each re-evaluated
 * the module-level `coach_${Date.now()}@test.local`, and every test after the first tried to
 * sign in as an account that had been created in a different worker under a different
 * address. The real signup wizard is exercised end to end in sponsor-domain-gating.spec.ts;
 * duplicating it here bought nothing but four failures.
 *
 * What is actually valuable — and what this file now covers — is the lifecycle AFTER an
 * account exists, which nothing else covers end to end. It runs serially against the seeded
 * verified coach and admin, and cleans up the submission it creates.
 *
 * Requires SUPABASE_LOCAL plus scripts/seed-test-accounts.mjs.
 */

import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { Database } from '../../lib/supabase/types'
import { signIn, gotoStable } from '../helpers/clerk-auth'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

const COACH_EMAIL = process.env.COACH_EMAIL ?? 'coach+clerk_test@example.com'
const COACH_PASSWORD = process.env.COACH_PASSWORD ?? 'CoachTest123!'
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin+clerk_test@example.com'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'AdminTest123!'
const SPONSOR_COMPANY = 'dev testing'

const ALIGNMENT =
  'Your engineering apprenticeship program is the reason we applied to you first — two of ' +
  'our mentors came through it, and we want our students to see that same path.'
const NEEDS =
  'We need $2,400 for competition registration, $900 for the drivetrain rebuild, and ' +
  '$700 for travel to the regional qualifier in March.'

test.describe.serial('Golden Path — pitch lifecycle', () => {
  test.skip(
    !process.env.SUPABASE_LOCAL || !SERVICE_ROLE_KEY,
    'Set SUPABASE_LOCAL=true and seed test accounts (scripts/seed-test-accounts.mjs)'
  )

  let admin: ReturnType<typeof createClient<Database>>
  let sponsorId: string
  let teamId: string

  test.beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY)

    const { data: sponsor } = await admin
      .from('sponsors')
      .select('id')
      .eq('company_name', SPONSOR_COMPANY)
      .single()
    sponsorId = sponsor!.id

    const { data: coach } = await admin
      .from('profiles')
      .select('id')
      .eq('email', COACH_EMAIL)
      .single()
    const { data: team } = await admin
      .from('teams')
      .select('id')
      .eq('owner_id', coach!.id)
      .limit(1)
      .single()
    teamId = team!.id

    /**
     * Give the team a funding ask. `saveSubmission` refuses to move a pitch to `pending`
     * while `teams.financial_ask_cents` is 0 — approval reserves that amount against the
     * sponsor's cap, so a $0 ask could never be dispatched. The seeded team has none, which
     * blocked the submit step with an inline banner rather than any failure of the flow
     * under test.
     */
    await admin
      .from('teams')
      .update({
        financial_ask_cents: 400_000,
        budget_items: [
          { label: 'Competition registration', amount_cents: 240_000 },
          { label: 'Drivetrain rebuild', amount_cents: 90_000 },
          { label: 'Regional travel', amount_cents: 70_000 },
        ],
      } as never)
      .eq('id', teamId)

    // One active submission per (team, sponsor) is enforced by a unique index, so clear
    // whatever a previous run left on this pair before the coach drafts a new one.
    await clearSubmissionsForPair()
  })

  test.afterAll(async () => {
    await clearSubmissionsForPair()
  })

  async function clearSubmissionsForPair() {
    const { data: rows } = await admin
      .from('submissions')
      .select('id')
      .eq('team_id', teamId)
      .eq('sponsor_id', sponsorId)
    for (const row of rows ?? []) {
      await admin.from('submission_access_tokens').delete().eq('submission_id', row.id)
      await admin.from('notifications').delete().eq('submission_id', row.id)
      await admin.from('transactions_ledger').delete().eq('submission_id', row.id)
      await admin.from('submissions').delete().eq('id', row.id)
    }
  }

  test('1. a verified coach can open the pitch composer', async ({ page }) => {
    await signIn(page, COACH_EMAIL, COACH_PASSWORD)
    await gotoStable(page, '/submissions/new')

    await expect(page.getByText('Create Submission')).toBeVisible()
    await expect(page.getByRole('button', { name: /select a sponsor/i })).toBeVisible()
  })

  test('2. the coach drafts a pitch and it is stored as a draft', async ({ page }) => {
    await signIn(page, COACH_EMAIL, COACH_PASSWORD)
    await gotoStable(page, '/submissions/new')

    await page.getByRole('button', { name: /select a sponsor/i }).click()
    // Two sponsors match "dev testing" ("dev testing" and "dev testing 2"), so anchor exactly.
    await page.getByRole('menuitem', { name: SPONSOR_COMPANY, exact: true }).click()
    await page.getByLabel('Custom Pitch Alignment').fill(ALIGNMENT)
    await page.getByLabel('Specific Needs Statement').fill(NEEDS)

    await page.getByRole('button', { name: /save as draft/i }).click()
    await expect(page.getByText(/saved/i).first()).toBeVisible({ timeout: 20_000 })

    const { data: draft } = await admin
      .from('submissions')
      .select('id, status, custom_pitch_alignment')
      .eq('team_id', teamId)
      .eq('sponsor_id', sponsorId)
      .maybeSingle()
    expect(draft?.status).toBe('draft')
    expect(draft?.custom_pitch_alignment).toContain('engineering apprenticeship')
  })

  test('3. the coach submits the draft for review', async ({ page }) => {
    const { data: draft } = await admin
      .from('submissions')
      .select('id')
      .eq('team_id', teamId)
      .eq('sponsor_id', sponsorId)
      .single()

    await signIn(page, COACH_EMAIL, COACH_PASSWORD)
    await gotoStable(page, `/submissions/${draft!.id}/edit`)

    await page.getByRole('button', { name: /submit for review/i }).click()
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 })

    const { data: submitted } = await admin
      .from('submissions')
      .select('status')
      .eq('id', draft!.id)
      .single()
    expect(submitted?.status).toBe('pending')
  })

  test('4. the pitch appears in the admin moderation queue', async ({ page }) => {
    await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    await gotoStable(page, '/moderation')

    await expect(page.getByText(`Submission to ${SPONSOR_COMPANY}`).first()).toBeVisible({
      timeout: 20_000,
    })
  })

  test('5. an admin approves it, which is what dispatches it to the sponsor', async ({ page }) => {
    await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    await gotoStable(page, '/moderation')

    await page.getByRole('button', { name: /approve & dispatch to sponsor/i }).first().click()

    // Dispatch is irreversible, so the queue button only opens a preview of the sponsor
    // email, the capacity deduction, and the coach notification. The dispatch itself needs
    // the explicit confirmation below.
    await expect(page.getByText('Approve & Dispatch Preview')).toBeVisible()
    await page.getByRole('button', { name: /confirm — approve & dispatch/i }).click()

    /**
     * The mandate is that approval — and only approval — releases a pitch to a sponsor, so
     * the assertion is on the row, not on the toast: status leaves the queue and `sent_at`
     * is stamped, which is what `submissions_select_sponsor` keys off.
     */
    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from('submissions')
            .select('status, sent_at')
            .eq('team_id', teamId)
            .eq('sponsor_id', sponsorId)
            .maybeSingle()
          return data?.status ?? null
        },
        { timeout: 25_000 }
      )
      .not.toBe('pending')

    const { data: dispatched } = await admin
      .from('submissions')
      .select('status, sent_at, reserved_amount_cents')
      .eq('team_id', teamId)
      .eq('sponsor_id', sponsorId)
      .single()
    expect(dispatched?.sent_at).toBeTruthy()
  })

  test('6. the analytics page renders with the activity', async ({ page }) => {
    await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    await gotoStable(page, '/analytics')

    await expect(page.getByRole('heading', { name: /analytics/i }).first()).toBeVisible({
      timeout: 20_000,
    })
    // At least one currency-formatted stat renders. `.first()` because the page shows
    // several — an unanchored locator here is a strict-mode violation, not an assertion.
    await expect(page.locator('text=/\\$[0-9]/').first()).toBeVisible()
  })
})
