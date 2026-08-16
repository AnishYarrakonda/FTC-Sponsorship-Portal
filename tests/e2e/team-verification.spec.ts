/**
 * Official FIRST team verification — enforcement UI, admin override, and RLS/RPC
 * security boundaries.
 *
 * The cron-auth checks run unconditionally (no DB dependency). Everything else needs a
 * local Supabase (SUPABASE_LOCAL) plus the seeded accounts from
 * scripts/seed-test-accounts.mjs. To keep the scoring outcome deterministic (no live
 * FIRST/FTCScout network calls in CI), each scenario pre-seeds a FRESH ftc_teams_cache
 * row for a throwaway team number — resolveTeamRecord always prefers a fresh cache hit,
 * so the graduation/verification flow never has to actually reach the network.
 */

import { test, expect, type Page } from '@playwright/test'
import { signIn, evaluateStable } from '../helpers/clerk-auth'
import { createClient } from '@supabase/supabase-js'
import { Database } from '../../lib/supabase/types'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

const COACH_EMAIL = process.env.COACH_EMAIL ?? 'coach+clerk_test@example.com'
const COACH_PASSWORD = process.env.COACH_PASSWORD ?? 'CoachTest123!'
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin+clerk_test@example.com'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'AdminTest123!'
const SPONSOR_EMAIL = process.env.SPONSOR_EMAIL ?? 'sponsor+clerk_test@example.com'
const SPONSOR_PASSWORD = process.env.SPONSOR_PASSWORD ?? 'SponsorTest123!'


// Real Clerk-authenticated REST calls, driven from inside the signed-in browser page —
// the same accessToken path lib/supabase/client.ts uses in production (window.Clerk
// .session.getToken()). This is what actually proves an RLS/PostgREST boundary, as
// opposed to asserting against the admin (service-role) client.
async function restAs(
  page: Page,
  path: string,
  init: { method?: string; body?: unknown; prefer?: string } = {}
) {
  return evaluateStable(
    page,
    async ({ path, init, url, anonKey }) => {
      const token = await window.Clerk?.session?.getToken()
      const res = await fetch(`${url}/rest/v1${path}`, {
        method: init.method ?? 'GET',
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${token ?? ''}`,
          'Content-Type': 'application/json',
          ...(init.prefer ? { Prefer: init.prefer } : {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
      })
      let body: unknown = null
      try {
        body = await res.json()
      } catch {
        // empty body is fine
      }
      return { status: res.status, body }
    },
    { path, init, url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY }
  )
}

test.describe('refresh-ftc-roster cron auth', () => {
  test('no Authorization header -> 401', async ({ request }) => {
    const res = await request.get('/api/cron/refresh-ftc-roster')
    expect(res.status()).toBe(401)
  })

  test('wrong bearer token -> 401', async ({ request }) => {
    const res = await request.get('/api/cron/refresh-ftc-roster', {
      headers: { Authorization: 'Bearer not-the-real-secret' },
    })
    expect(res.status()).toBe(401)
  })
})

test.describe.serial('Official FIRST team verification', () => {
  test.skip(
    !process.env.SUPABASE_LOCAL || !process.env.ADMIN_EMAIL,
    'Set SUPABASE_LOCAL=true and seed test accounts (scripts/seed-test-accounts.mjs) to enable this suite'
  )

  let adminClient: ReturnType<typeof createClient<Database>>
  let coachProfileId: string
  let teamId: string

  const REJECTED_NUMBER = 88801
  const NEEDS_REVIEW_NUMBER = 88802

  test.beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    const { data: coach } = await adminClient.from('profiles').select('id').eq('email', COACH_EMAIL).single()
    coachProfileId = coach!.id

    const { data: team } = await adminClient
      .from('teams')
      .select('id')
      .eq('owner_id', coachProfileId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .single()
    teamId = team!.id

    // Fresh cache rows for two throwaway team numbers, so resolveTeamRecord (lib/
    // ftc-roster.ts) resolves from cache without ever calling the real FIRST/FTCScout
    // APIs — this suite's outcomes must not depend on network availability.
    const now = new Date().toISOString()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (adminClient as any).from('ftc_teams_cache').upsert([
      {
        team_number: REJECTED_NUMBER,
        team_name: 'Iron Panthers',
        official_team_name: 'Iron Panthers',
        organization: 'Roosevelt Academy',
        source: 'first_api',
        verified_at: now,
        last_synced: now,
      },
      {
        team_number: NEEDS_REVIEW_NUMBER,
        team_name: 'The Gearheads',
        official_team_name: 'The Gearheads',
        organization: 'Roosevelt Academy',
        source: 'first_api',
        verified_at: now,
        last_synced: now,
      },
    ])

    // Start each scenario from 'incubator' so the "Ready to graduate?" flow is reachable.
    await adminClient.from('teams').update({ status: 'incubator', ftc_team_number: null } as never).eq('id', teamId)
  })

  test('graduating with a name that does not match the official roster is rejected, team stays incubator', async ({ page }) => {
    await signIn(page, COACH_EMAIL, COACH_PASSWORD)
    await page.goto('/dashboard')

    await page.getByRole('button', { name: /i have a team now/i }).click()
    await page.getByLabel(/new ftc team number/i).fill(String(REJECTED_NUMBER))
    await page.getByLabel(/official team name/i).fill('')
    await page.getByLabel(/official team name/i).fill('Something Completely Different')
    await page.getByRole('button', { name: /graduate team/i }).click()

    await expect(page.getByText(/team number could not be verified/i)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Iron Panthers')).toBeVisible()

    const { data: team } = await adminClient.from('teams').select('status, ftc_team_number').eq('id', teamId).single()
    expect(team?.status).toBe('incubator')
    expect(team?.ftc_team_number).toBeNull()

    const { data: record } = await adminClient
      .from('team_verification_records')
      .select('outcome')
      .eq('team_id', teamId)
      .eq('ftc_team_number', REJECTED_NUMBER)
      .order('checked_at', { ascending: false })
      .limit(1)
      .single()
    expect(record?.outcome).toBe('rejected')
  })

  test('graduating with a near-miss name succeeds but is flagged needs_review, and an admin can override it', async ({ page }) => {
    await signIn(page, COACH_EMAIL, COACH_PASSWORD)
    await page.goto('/dashboard')

    await page.getByRole('button', { name: /i have a team now/i }).click()
    await page.getByLabel(/new ftc team number/i).fill(String(NEEDS_REVIEW_NUMBER))
    await page.getByLabel(/official team name/i).fill('')
    await page.getByLabel(/official team name/i).fill('Gear Heads')
    await page.getByRole('button', { name: /graduate team/i }).click()

    /**
     * Not blocked — the team graduates immediately despite the mismatch.
     *
     * Asserted on the post-graduation page rather than on the success toast: the handler
     * calls `window.location.reload()` on the same tick it raises the toast, so the toast
     * is frequently torn down before it can be observed. The banner disappearing is the
     * durable, user-visible signal that the team is no longer an incubator.
     */
    await expect(page.getByText(/ready to graduate\?/i)).toHaveCount(0, { timeout: 20_000 })

    const { data: record } = await adminClient
      .from('team_verification_records')
      .select('id, outcome')
      .eq('team_id', teamId)
      .eq('ftc_team_number', NEEDS_REVIEW_NUMBER)
      .order('checked_at', { ascending: false })
      .limit(1)
      .single()
    expect(record?.outcome).toBe('needs_review')
    const recordId = record!.id

    // Admin sees the pending-review block and can override it.
    await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    await page.goto('/coaches')
    await expect(page.getByText(/needs review/i).first()).toBeVisible({ timeout: 15_000 })

    const overrideButtons = page.getByRole('button', { name: /^override$/i })
    await overrideButtons.first().click()

    const reasonBox = page.getByLabel(/reason for override/i)

    /**
     * A reason under 20 characters cannot be submitted.
     *
     * This block used to strip the button's `disabled` attribute and expect the SERVER to
     * reject the short reason. It cannot: `handleOverride` in coach-verification-card.tsx
     * returns early on the same length check before it ever calls the action, so no request
     * is made no matter what the DOM says — the test was asserting a server round-trip that
     * this UI can never produce. What the browser can honestly prove is the client guard and
     * that nothing was written; `lib/__tests__` covers the zod `min(20)` in the action, which
     * is the layer a curl request would actually meet.
     */
    await reasonBox.fill('too short')
    await expect(page.getByText('9/20 characters minimum')).toBeVisible()
    await expect(page.getByRole('button', { name: /confirm override/i })).toBeDisabled()

    const { data: stillPending } = await adminClient
      .from('team_verification_records')
      .select('outcome')
      .eq('id', recordId)
      .single()
    expect(stillPending?.outcome).toBe('needs_review')

    // A 25-character reason succeeds.
    await reasonBox.fill('')
    await reasonBox.fill('Confirmed by phone call.')
    await page.getByRole('button', { name: /confirm override/i }).click()
    await expect(page.getByText(/^overridden$/i).first()).toBeVisible({ timeout: 10_000 })

    const { data: overridden } = await adminClient
      .from('team_verification_records')
      .select('outcome, override_reason, overridden_by')
      .eq('id', recordId)
      .single()
    expect(overridden?.outcome).toBe('overridden')
    expect(overridden?.override_reason).toBe('Confirmed by phone call.')
    expect(overridden?.overridden_by).toBeTruthy()

    const { data: auditRow } = await adminClient
      .from('audit_log')
      .select('id')
      .eq('action', 'override_team_verification')
      .eq('entity_id', recordId)
      .limit(1)
      .maybeSingle()
    expect(auditRow).toBeTruthy()
  })

  test.describe('Security boundaries (RLS + RPC, real Clerk-authenticated sessions)', () => {
    let foreignRecordId: string

    test.beforeAll(async () => {
      // A verification record that belongs to neither the seeded coach nor sponsor —
      // proves tvr_select_own only returns the caller's own rows, not "any authenticated
      // user."
      const { data } = await adminClient
        .from('team_verification_records')
        .insert({
          team_id: null,
          profile_id: null,
          ftc_team_number: 55555,
          claimed_team_name: 'Nobody Owns This',
          source: 'none',
          outcome: 'unavailable',
        })
        .select('id')
        .single()
      foreignRecordId = data!.id
    })

    test('a coach SELECT on team_verification_records returns only their own rows', async ({ page }) => {
      await signIn(page, COACH_EMAIL, COACH_PASSWORD)
      await page.goto('/dashboard')

      const own = await restAs(page, `/team_verification_records?team_id=eq.${teamId}`)
      expect(own.status).toBe(200)
      expect(Array.isArray(own.body) ? own.body.length : 0).toBeGreaterThan(0)

      const foreign = await restAs(page, `/team_verification_records?id=eq.${foreignRecordId}`)
      expect(foreign.status).toBe(200)
      expect(foreign.body).toEqual([])
    })

    test('a sponsor SELECT on team_verification_records returns 0 rows — no sponsor branch exists', async ({ page }) => {
      await signIn(page, SPONSOR_EMAIL, SPONSOR_PASSWORD)
      await page.goto('/sponsor/dashboard')

      const result = await restAs(page, `/team_verification_records?team_id=eq.${teamId}`)
      expect(result.status).toBe(200)
      expect(result.body).toEqual([])
    })

    test('a coach cannot INSERT / UPDATE / DELETE team_verification_records — no policy admits it', async ({ page }) => {
      await signIn(page, COACH_EMAIL, COACH_PASSWORD)
      await page.goto('/dashboard')

      const insert = await restAs(page, '/team_verification_records', {
        method: 'POST',
        body: { team_id: teamId, ftc_team_number: 1, claimed_team_name: 'x', source: 'none', outcome: 'unavailable' },
      })
      expect(insert.status).toBeGreaterThanOrEqual(400)

      /**
       * INSERT is refused outright (401/403 — no policy grants it), but UPDATE and DELETE
       * are refused by making the row set empty: PostgREST answers 204 "0 rows changed",
       * not an error. Asserting 4xx on those two therefore fails against a correctly
       * locked-down table. Ask for the affected rows back and assert none came.
       */
      const update = await restAs(page, `/team_verification_records?team_id=eq.${teamId}`, {
        method: 'PATCH',
        body: { outcome: 'overridden' },
        prefer: 'return=representation',
      })
      expect(update.body ?? []).toEqual([])

      const del = await restAs(page, `/team_verification_records?id=eq.${foreignRecordId}`, {
        method: 'DELETE',
        prefer: 'return=representation',
      })
      expect(del.body ?? []).toEqual([])

      // Untouched — the foreign row (which the coach cannot even see) still exists.
      const { data: stillThere } = await adminClient
        .from('team_verification_records')
        .select('id')
        .eq('id', foreignRecordId)
        .maybeSingle()
      expect(stillThere).toBeTruthy()
    })

    test('a coach cannot UPDATE ftc_teams_cache — no write policy exists on that table', async ({ page }) => {
      await signIn(page, COACH_EMAIL, COACH_PASSWORD)
      await page.goto('/dashboard')

      // Denied by RLS, so 0 rows change and PostgREST reports success — the assertion that
      // matters is below: the cached official name is untouched.
      const update = await restAs(page, `/ftc_teams_cache?team_number=eq.${REJECTED_NUMBER}`, {
        method: 'PATCH',
        body: { team_name: 'Hijacked Name' },
        prefer: 'return=representation',
      })
      expect(update.body ?? []).toEqual([])

      const { data: row } = await adminClient
        .from('ftc_teams_cache')
        .select('team_name')
        .eq('team_number', REJECTED_NUMBER)
        .single()
      expect(row?.team_name).toBe('Iron Panthers')
    })

    test('the /coaches admin override surface is unreachable as a coach (role redirect)', async ({ page }) => {
      // overrideTeamVerification is gated by requireAdmin() at the action layer, and its
      // only UI trigger lives on this admin-only route — app/(admin)/layout.tsx redirects
      // any non-admin away before the override dialog can ever render, which is the same
      // "permission-denied" boundary the prompt's guardrail describes.
      await signIn(page, COACH_EMAIL, COACH_PASSWORD)
      await page.goto('/coaches')
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 })
    })
  })
})
