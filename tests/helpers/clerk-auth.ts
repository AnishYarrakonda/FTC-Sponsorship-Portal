/**
 * Shared Clerk sign-in for the E2E suite.
 *
 * Every spec used to carry its own copy of a password sign-in:
 *
 *     clerk.signIn({ page, signInParams: { strategy: 'password', identifier, password } })
 *
 * That does not work on this Clerk instance. Clerk answers a password attempt with
 * `status: "needs_client_trust"`, and neither `@clerk/testing` nor the app's own headless
 * `/login` page has a handler for that status — the attempt just never completes, so the
 * test ends up asserting against a logged-out page and fails for a reason that has nothing
 * to do with what it was testing.
 *
 * The supported path for automation is a Backend-API **sign-in token** used with the
 * `ticket` strategy: it stands in for all first factors, so client trust never enters the
 * picture. `password` is still accepted below purely so call sites read unchanged; it is
 * deliberately unused.
 *
 * Requires CLERK_SECRET_KEY (already needed by scripts/seed-test-accounts.mjs).
 */

import { expect, test, type Page } from '@playwright/test'
import { clerk, setupClerkTestingToken } from '@clerk/testing/playwright'

/**
 * Read lazily, never at module load. `clerkSetup()` is what loads `.env.local` into the
 * process, and it runs in global setup — after this module has been imported. A top-level
 * `process.env.CLERK_SECRET_KEY ?? ''` therefore captures an empty string, and every
 * Backend-API call below comes back unauthorized with an error object instead of a user list.
 */
const clerkSecret = () => process.env.CLERK_SECRET_KEY ?? ''

/** Mint a Clerk sign-in token for a seeded account (stands in for all first factors). */
export async function signInTicket(email: string): Promise<string> {
  const list = await fetch(
    `https://api.clerk.com/v1/users?email_address=${encodeURIComponent(email)}`,
    { headers: { Authorization: `Bearer ${clerkSecret()}` } }
  )
  const users = (await list.json()) as Array<{ id: string }>
  expect(
    Array.isArray(users) ? users.length : `Clerk API error: ${JSON.stringify(users)}`,
    `Clerk user missing for ${email} — run scripts/seed-test-accounts.mjs`
  ).toBeGreaterThan(0)

  const res = await fetch('https://api.clerk.com/v1/sign_in_tokens', {
    method: 'POST',
    headers: { Authorization: `Bearer ${clerkSecret()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: users[0].id, expires_in_seconds: 600 }),
  })
  const json = (await res.json()) as { token?: string }
  expect(json.token, `Clerk did not return a sign-in token for ${email}`).toBeTruthy()
  return json.token as string
}

/**
 * Firefox aborts a `page.goto` that starts while Clerk's own post-sign-in navigation is
 * still in flight. One retry is enough, and it is not papering over an app bug — the
 * second navigation lands normally.
 *
 * The same race surfaces under two different messages: `NS_BINDING_ABORTED` when the
 * request is cancelled outright, and "interrupted by another navigation to /dashboard"
 * when Clerk's post-sign-in redirect wins the race instead. Both are the redirect
 * superseding our goto, so both retry; anything else still throws.
 */
export async function gotoStable(
  page: Page,
  url: string,
  options?: Parameters<Page['goto']>[1]
): ReturnType<Page['goto']> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // Returns the Response so call sites that assert on status can use this too,
      // rather than falling back to a bare page.goto that reintroduces the race.
      return await page.goto(url, options)
    } catch (e) {
      const msg = (e as Error).message
      if (!/NS_BINDING_ABORTED|frame was detached|interrupted by another navigation/.test(msg) || attempt === 2) throw e
      await page.waitForTimeout(750)
    }
  }
  throw new Error(`gotoStable: exhausted retries for ${url}`)
}

/**
 * Clerk's JS must be loaded before any helper here can run.
 *
 * This guard exists because the Playwright-bundled WebKit could not complete a TLS handshake
 * with `*.clerk.accounts.dev` ("A TLS error caused the secure connection to fail"), which
 * broke every Clerk-dependent spec on that project. It is an environment issue, not a
 * product one, so it is detected and skipped rather than reported as a false failure.
 *
 * As of the 2026-08-23 Phase 5 sweep **WebKit reaches Clerk and runs the whole suite** —
 * verified by counting skips, which were zero. The guard stays because the failure is a
 * property of the local WebKit build and can come back with the next Playwright bump; it is
 * simply no longer firing. Do not read its presence as "WebKit is excluded".
 */
export async function loadClerk(page: Page): Promise<boolean> {
  await setupClerkTestingToken({ page })
  await gotoStable(page, '/')
  return page
    .waitForFunction(
      () => Boolean((window as unknown as { Clerk?: { loaded?: boolean } }).Clerk?.loaded),
      undefined,
      { timeout: 20_000 }
    )
    .then(() => true)
    .catch(() => false)
}

/**
 * Wait until Clerk has re-initialised on the CURRENT page before reading a session token.
 *
 * Clerk boots per document, so immediately after a `page.goto` `window.Clerk` may still be
 * undefined. A helper that reads `window.Clerk?.session?.getToken()` at that moment sends
 * `Authorization: Bearer ` to PostgREST and gets a 401 — which is indistinguishable from a
 * genuine authorization failure, and is exactly how a passing RLS boundary comes out red.
 * Session tokens are also short-lived (60s), so the token must be fetched at call time, not
 * cached from sign-in.
 */
export async function waitForClerkSession(page: Page) {
  await page.waitForFunction(
    () => {
      const w = window as unknown as { Clerk?: { loaded?: boolean; session?: unknown } }
      return Boolean(w.Clerk?.loaded && w.Clerk?.session)
    },
    undefined,
    { timeout: 20_000 }
  )
}

/**
 * `page.evaluate` against a page that may still be navigating.
 *
 * The app finishes a client-side redirect a beat after `goto` resolves (Clerk's session
 * activation, then the sponsor shell's own routing). An evaluate that starts in that window
 * dies with "Execution context was destroyed" — a harness race, not a product failure, and
 * one that lands on whichever assertion happened to run first. Re-running once against the
 * new document is correct: these callers only read a session token and issue a fetch, so
 * the call is idempotent.
 */
export async function evaluateStable<R>(
  page: Page,
  // Playwright's own overloads cannot infer through a generic wrapper, so the bridge is
  // untyped here and the return type is what callers rely on.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fn: (arg: any) => R | Promise<R>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  arg: any
): Promise<R> {
  for (let attempt = 0; ; attempt++) {
    try {
      await waitForClerkSession(page)
      return (await page.evaluate(fn, arg)) as R
    } catch (e) {
      const msg = (e as Error).message
      if (attempt === 2 || !/Execution context was destroyed|frame was detached|Target closed/.test(msg)) {
        throw e
      }
      await page.waitForLoadState('domcontentloaded').catch(() => {})
      await page.waitForTimeout(500)
    }
  }
}

export async function requireClerk(page: Page) {
  const loaded = await loadClerk(page)
  test.skip(!loaded, 'Clerk frontend API is unreachable from this browser (TLS handshake failure)')
}

/**
 * Establish a session without touching `test.skip`, for use outside a running test
 * (global setup). Inside a test, prefer `signIn`, which skips cleanly on the WebKit
 * TLS failure instead of erroring.
 */
export async function establishSession(page: Page, email: string) {
  const ticket = await signInTicket(email)
  await loadClerk(page)
  await clerk.signOut({ page }).catch(() => {})
  await clerk.signIn({ page, signInParams: { strategy: 'ticket', ticket } })
  await waitForClerkSession(page)
}

/**
 * Sign in as a seeded account. `password` is accepted and ignored — see the file header.
 */
/**
 * Returns only once the Clerk session is actually live.
 *
 * `clerk.signIn()` resolves when the sign-in call completes, which is a beat BEFORE
 * `window.Clerk.session` exists. A `goto` issued in that window carries no session, so
 * `clerkMiddleware` redirects it to /login and the test then asserts against the login
 * form — failing with "element(s) not found" for whatever it expected on the real page.
 * That is why the Firefox run produced exactly one failure per run in a different spec
 * each time: the loser of the race was simply whichever test ran there. Waiting on the
 * session here fixes every call site at once.
 */
/**
 * Wait for the session cookie the SERVER reads, not just the client session object.
 *
 * `waitForClerkSession` proves `window.Clerk.session` exists — a claim about the browser.
 * `clerkMiddleware()` authorizes off the `__session` cookie, and Clerk writes that cookie a
 * beat after activating the session. Navigate inside that window and middleware sees an
 * unauthenticated request and redirects to `/login`, so the test asserts against the login
 * form and reports "element(s) not found" for whatever it was actually looking for.
 *
 * Seen on Firefox, intermittently, and on a different test each run — which is what made it
 * read as an app flake rather than a harness one. The screenshot is what settled it: a fully
 * rendered `/login` page for an account that had just signed in successfully.
 *
 * Asserted against the server rather than against the cookie jar. Checking merely that a
 * `__session` cookie EXISTS is not enough: `clerk.signOut()` above leaves the previous
 * cookie in place, so that check passes instantly on a stale value and the race is
 * unchanged. What matters is whether `clerkMiddleware()` accepts the request, so ask it.
 *
 * `page.request` shares the browser context's cookie jar, and `maxRedirects: 0` exposes the
 * redirect itself. A signed-out request to a protected route is sent to `/login`; any other
 * outcome — 200, or a role redirect to `/sponsor/dashboard` — means the session is live.
 */
async function waitForServerSession(page: Page) {
  await expect
    .poll(
      async () => {
        const res = await page.request.get('/dashboard', { maxRedirects: 0 })
        return (res.headers()['location'] ?? '').includes('/login')
      },
      {
        timeout: 15_000,
        message: 'the server still treats this session as signed out (middleware redirects to /login)',
      }
    )
    .toBe(false)
}

export async function signIn(page: Page, email: string, _password?: string) {
  const ticket = await signInTicket(email)
  await requireClerk(page)
  await clerk.signOut({ page }).catch(() => {})
  await clerk.signIn({ page, signInParams: { strategy: 'ticket', ticket } })
  await waitForClerkSession(page)
  await waitForServerSession(page)
}
