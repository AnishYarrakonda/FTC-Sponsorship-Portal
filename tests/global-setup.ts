/**
 * Playwright global setup.
 *
 * Runs once before all test suites. Auth is now Clerk, so this:
 *   1. Bootstraps Clerk for the test run via `clerkSetup()` (loads the Clerk
 *      publishable/secret keys + provisions Testing Tokens).
 *   2. When SUPABASE_LOCAL=true, verifies the local Supabase instance is reachable
 *      (Supabase still backs Postgres + Storage).
 *   3. If an admin test account is configured, signs in with Clerk's test helper
 *      and saves the authenticated storage state to disk so individual tests can
 *      reuse a logged-in session without re-driving the login UI.
 *
 * Required env:
 *   CLERK_PUBLISHABLE_KEY / NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY
 *     — consumed by `clerkSetup()` to talk to the Clerk Frontend/Backend APIs.
 *   ADMIN_EMAIL — the seeded admin's Clerk email (e.g. admin+clerk_test@example.com);
 *     used to mint a server-side session token (no password needed).
 *   SUPABASE_LOCAL / NEXT_PUBLIC_SUPABASE_URL — optional local Supabase reachability check.
 */

import { chromium, type FullConfig } from '@playwright/test'
import { clerkSetup } from '@clerk/testing/playwright'
import { establishSession } from './helpers/clerk-auth'

/**
 * Start every local run from zero capacity drift.
 *
 * `appeals` and `recognition-tiers` both assert `detect_capacity_drift()` returns nothing —
 * a genuinely valuable global invariant, and the reason a capacity bug would be caught at
 * all. But a suite that crashes part-way leaves a `transactions_ledger` row behind, and
 * `transactions_ledger.submission_id` is `ON DELETE SET NULL`, so deleting the submission
 * orphans the row instead of removing it. The next run then opens with real drift and those
 * two tests fail while pointing at the product rather than at the debris.
 *
 * Only ORPHANS are removed here — rows whose submission is already gone. Anything still
 * attached to a live submission is left alone, so this cannot paper over a real leak.
 */
async function clearOrphanedFixtureMoney(supabaseUrl: string) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) return

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  }
  const rest = (path: string, init: RequestInit = {}) =>
    fetch(`${supabaseUrl}/rest/v1${path}`, { ...init, headers })

  const orphanFulfillments = (await (
    await rest('/funding_fulfillments?submission_id=is.null&select=id')
  ).json()) as Array<{ id: string }>
  for (const f of orphanFulfillments) {
    await rest(`/funding_fulfillment_events?fulfillment_id=eq.${f.id}`, { method: 'DELETE' })
  }
  await rest('/funding_fulfillments?submission_id=is.null', { method: 'DELETE' })
  await rest('/transactions_ledger?submission_id=is.null', { method: 'DELETE' })

  // Re-sync every sponsor's counter with what the ledger and open reservations now say.
  const sponsors = (await (await rest('/sponsors?select=id')).json()) as Array<{ id: string }>
  for (const s of sponsors) {
    const settled = (await (
      await rest(`/transactions_ledger?sponsor_id=eq.${s.id}&select=amount_cents`)
    ).json()) as Array<{ amount_cents: number }>
    const reserved = (await (
      await rest(
        `/submissions?sponsor_id=eq.${s.id}&status=in.(dispatched,changes_requested)&select=reserved_amount_cents`
      )
    ).json()) as Array<{ reserved_amount_cents: number | null }>

    const total =
      settled.reduce((n, r) => n + (r.amount_cents ?? 0), 0) +
      reserved.reduce((n, r) => n + (r.reserved_amount_cents ?? 0), 0)

    await rest(`/sponsors?id=eq.${s.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ funding_used_cents: total }),
    })
  }

  console.log('✓ Capacity bookkeeping re-synced (orphaned fixture rows cleared)')
}

async function globalSetup(config: FullConfig) {
  // Bootstrap Clerk testing for the whole run (loads keys, provisions Testing Tokens).
  // This is required before any Clerk test helper (clerk.signIn / setupClerkTestingToken)
  // can be used in the specs.
  await clerkSetup()

  if (process.env.SUPABASE_LOCAL) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    if (!supabaseUrl) {
      throw new Error('NEXT_PUBLIC_SUPABASE_URL must be set when SUPABASE_LOCAL=true')
    }

    // Quick reachability check — if Supabase is down, fail fast with a clear message
    const res = await fetch(`${supabaseUrl}/rest/v1/`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '' },
    }).catch(() => null)

    if (!res || !res.ok) {
      throw new Error(
        `Local Supabase is not reachable at ${supabaseUrl}. Run \`supabase start\` first.`
      )
    }

    console.log('✓ Local Supabase reachable')
    await clearOrphanedFixtureMoney(supabaseUrl)
  }

  // Save an authenticated admin Clerk session to disk so individual tests can reuse
  // it without re-driving the login UI (speeds up the suite significantly).
  // Sign-in goes through the shared ticket helper: a password attempt on this Clerk
  // instance stalls at `needs_client_trust` and never completes. See tests/helpers/clerk-auth.ts.
  if (process.env.ADMIN_EMAIL) {
    const baseURL = config.projects[0].use.baseURL ?? 'http://localhost:3000'
    const browser = await chromium.launch()
    const page = await browser.newPage({ baseURL })

    await establishSession(page, process.env.ADMIN_EMAIL)

    // Land on an admin-only page to confirm the session took.
    await page.goto('/moderation')
    await page.waitForURL(/\/moderation/, { timeout: 15_000 }).catch(() => {})

    await page.context().storageState({ path: 'tests/.auth/admin.json' })
    await browser.close()
    console.log('✓ Admin Clerk session saved to tests/.auth/admin.json')
  }
}

export default globalSetup
