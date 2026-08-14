/**
 * Vercel BotID + corporate email domain gating on the sponsor path (0090).
 *
 * Everything here runs against the real Clerk instance and the real Supabase project:
 * signups are driven through the actual UI, the domain rules are written through the
 * actual admin surface, and the resulting rows are read back with a service-role client.
 *
 * BotID is invisible and `checkBotId()` returns HUMAN in development, so these tests
 * exercise the same code path a real browser does without needing a bypass. (If this suite
 * is ever pointed at a PREVIEW deployment, add a Vercel WAF bypass rule for the runner —
 * never a code-level bypass.)
 *
 * ## Two things about this app's real signup flow that shape every test here
 *
 * 1. `/signup` and `/sponsors/apply` are BOTH in middleware's `isAuthPage` matcher, so the
 *    instant Clerk's `setActive()` activates the session the router refresh is bounced to
 *    /dashboard and on to `/complete-profile`. That is by design (P0-13). The wizard's
 *    steps 2–3 are therefore completed on `/complete-profile`, which renders the same
 *    fields and calls the same actions (`completeCoachProfile` / `createSponsorApplication`).
 * 2. The Clerk instance answers a password sign-in with `needs_client_trust`, which the
 *    custom `/login` page does not implement. Test sign-ins therefore use a Backend-API
 *    sign-in TOKEN (the `ticket` strategy), which skips first factors entirely.
 *
 * Isolation: every test mints a unique email + domain, so the three Playwright browser
 * projects never contend for the same Clerk user or the same `email_domain_rules` row.
 * `gmail.com` is only ever READ (it is blocked by the 0090 seed), never toggled.
 */

import { test, expect, type Locator, type Page } from '@playwright/test'
import { clerk, setupClerkTestingToken } from '@clerk/testing/playwright'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY ?? ''

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin+clerk_test@example.com'
const COACH_EMAIL = process.env.COACH_EMAIL ?? 'coach+clerk_test@example.com'
const SPONSOR_EMAIL = process.env.SPONSOR_EMAIL ?? 'sponsor+clerk_test@example.com'

const SUPPORT_EMAIL = 'exodiusftc@gmail.com' // lib/site-config.ts
const TEST_PASSWORD = 'E2eDomainGate123!'
const CLERK_TEST_CODE = '424242' // Clerk's static code for any +clerk_test address

/** Unique per test + per browser project, so nothing collides. */
function uid(project: string) {
  return `${project}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`.toLowerCase()
}

// ── service-role helpers (bypass RLS; setup / assertions / cleanup only) ──────

async function rest(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
  })
}

async function applicationsFor(email: string) {
  const res = await rest(`/sponsor_applications?contact_email=eq.${encodeURIComponent(email)}&select=*`)
  return (await res.json()) as Array<Record<string, unknown>>
}

async function auditRows(action: string) {
  const res = await rest(`/audit_log?action=eq.${action}&select=*&order=created_at.desc&limit=30`)
  return (await res.json()) as Array<Record<string, unknown>>
}

async function domainRule(domain: string) {
  const res = await rest(`/email_domain_rules?domain=eq.${encodeURIComponent(domain)}&select=*`)
  return ((await res.json()) as Array<Record<string, unknown>>)[0]
}

/**
 * Zero the per-IP application bucket.
 *
 * The live path throttles /sponsors/apply at 3 per hour per IP
 * (`check_throttle`, 0055). Every test in this file submits from 127.0.0.1, so without
 * this the fourth sponsor test of the run gets "Too many applications" instead of
 * exercising the gate. This resets only the sponsor-apply keys.
 */
async function resetSponsorThrottle() {
  await rest('/request_throttle?key=like.sponsor-apply*', { method: 'DELETE' })
}

async function cleanupApplicant(email: string) {
  await rest(`/sponsor_applications?contact_email=eq.${encodeURIComponent(email)}`, { method: 'DELETE' })

  const res = await rest(`/profiles?email=eq.${encodeURIComponent(email)}&select=id`)
  for (const row of (await res.json()) as Array<{ id: string }>) {
    await rest(`/notifications?recipient_id=eq.${row.id}`, { method: 'DELETE' })
    await rest(`/teams?coach_id=eq.${row.id}`, { method: 'DELETE' })
    await rest(`/profiles?id=eq.${row.id}`, { method: 'DELETE' })
  }

  if (!CLERK_SECRET_KEY) return
  const list = await fetch(
    `https://api.clerk.com/v1/users?email_address=${encodeURIComponent(email)}`,
    { headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` } }
  )
  if (!list.ok) return
  for (const u of (await list.json()) as Array<{ id: string }>) {
    await fetch(`https://api.clerk.com/v1/users/${u.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` },
    })
  }
}

// ── auth helpers ─────────────────────────────────────────────────────────────

/** Mint a Clerk sign-in token for a seeded account (skips first factors). */
async function signInTicket(email: string): Promise<string> {
  const list = await fetch(
    `https://api.clerk.com/v1/users?email_address=${encodeURIComponent(email)}`,
    { headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` } }
  )
  const users = (await list.json()) as Array<{ id: string }>
  expect(users.length, `Clerk user missing for ${email} — run scripts/seed-test-accounts.mjs`).toBe(1)

  const res = await fetch('https://api.clerk.com/v1/sign_in_tokens', {
    method: 'POST',
    headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: users[0].id, expires_in_seconds: 600 }),
  })
  const json = (await res.json()) as { token?: string }
  expect(json.token, 'Clerk did not return a sign-in token').toBeTruthy()
  return json.token as string
}

/**
 * Firefox aborts a `page.goto` that starts while Clerk's own post-sign-in navigation is
 * still in flight (`NS_BINDING_ABORTED`). Retrying once is enough and is not papering over
 * an app bug — the second navigation lands normally.
 */
async function gotoStable(page: Page, url: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(url)
      return
    } catch (e) {
      if (!/NS_BINDING_ABORTED|frame was detached/.test((e as Error).message) || attempt === 2) throw e
      await page.waitForTimeout(750)
    }
  }
}

/**
 * Clerk's JS has to load before anything here can run.
 *
 * The Playwright-bundled WebKit on this macOS build cannot complete a TLS handshake with
 * `*.clerk.accounts.dev` ("A TLS error caused the secure connection to fail"), which breaks
 * every Clerk-dependent spec in the repo on that project — it is a browser/environment
 * issue, unrelated to this feature. Detect it and skip rather than report a false failure.
 * Chromium and Firefox run the whole suite.
 */
async function requireClerk(page: Page) {
  await setupClerkTestingToken({ page })
  await gotoStable(page, '/')
  const loaded = await page
    .waitForFunction(
      () => Boolean((window as unknown as { Clerk?: { loaded?: boolean } }).Clerk?.loaded),
      undefined,
      { timeout: 20_000 }
    )
    .then(() => true)
    .catch(() => false)
  test.skip(!loaded, 'Clerk frontend API is unreachable from this browser (TLS handshake failure)')
}

async function signIn(page: Page, email: string) {
  const ticket = await signInTicket(email)
  await requireClerk(page)
  await clerk.signIn({ page, signInParams: { strategy: 'ticket', ticket } })
}

/** Read a table with the signed-in user's OWN Clerk token, so RLS is what answers. */
async function restAs(page: Page, path: string, init: { method?: string; body?: unknown } = {}) {
  return page.evaluate(
    async ({ path, init, url, anonKey }) => {
      const w = window as unknown as {
        Clerk?: { session?: { getToken: () => Promise<string | null> } }
      }
      const token = await w.Clerk?.session?.getToken()
      const res = await fetch(`${url}/rest/v1${path}`, {
        method: init.method ?? 'GET',
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
      })
      return { hasToken: Boolean(token), status: res.status, text: await res.text() }
    },
    { path, init, url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY }
  )
}

// ── signup helpers ───────────────────────────────────────────────────────────

/**
 * Step 1 of either wizard: create the Clerk user and clear the email-code
 * sub-step. Lands on /complete-profile (see the header note).
 */
async function createClerkAccount(page: Page, path: '/signup' | '/sponsors/apply', email: string) {
  await requireClerk(page)
  await gotoStable(page, path)

  const nameLabel = path === '/signup' ? 'Full Name' : 'Representative Name'
  const emailLabel = path === '/signup' ? 'Email Address' : 'Work Email Address'
  await expect(page.getByLabel(nameLabel)).toBeVisible({ timeout: 30_000 })

  if (path === '/sponsors/apply') {
    // The work-email hint is a hint, never a client-side gate.
    await expect(page.getByText(/please use your work email/i)).toBeVisible()
  }

  await fillStable(page.getByLabel(nameLabel), 'E2E Domain Gate')
  await fillStable(page.getByLabel(emailLabel), email)
  await fillStable(page.getByLabel('Password', { exact: true }), TEST_PASSWORD)
  await fillStable(page.getByLabel('Confirm Password'), TEST_PASSWORD)
  await page.getByRole('button', { name: /^next$/i }).click()

  const code = page.getByPlaceholder('123456')
  await expect(code).toBeVisible({ timeout: 30_000 })
  await code.fill(CLERK_TEST_CODE)
  await page.getByRole('button', { name: /verify email/i }).click()

  await page.waitForURL(/\/complete-profile/, { timeout: 45_000 })
}

/**
 * Fill a react-hook-form input and prove the value stuck.
 *
 * A `fill()` that lands between paint and hydration is silently discarded — the field looks
 * filled to the DOM but React never saw the change, and the form then fails validation on a
 * value the test clearly typed. Retrying until the value reads back removes that race.
 */
async function fillStable(field: Locator, value: string) {
  await expect(field).toBeVisible({ timeout: 30_000 })
  await expect(async () => {
    await field.fill(value)
    await expect(field).toHaveValue(value)
  }).toPass({ timeout: 20_000 })
}

async function pickState(page: Page, index: number, stateName: string) {
  await page.getByRole('combobox').nth(index).click()
  await page.getByPlaceholder('Search state...').fill(stateName)
  await page.getByRole('option', { name: new RegExp(`^${stateName} `, 'i') }).first().click()
}

/** Fill the sponsor company + sponsorship form on /complete-profile. */
async function fillSponsorApplication(page: Page, companyName: string, website: string) {
  await page.getByRole('radio', { name: /sponsor representative/i }).click()
  await expect(page.getByLabel('Company Name')).toBeVisible({ timeout: 30_000 })

  await fillStable(page.getByLabel('Representative Name'), 'E2E Domain Gate')
  await fillStable(page.getByLabel('Company Name'), companyName)
  await page.getByRole('button', { name: /select industry/i }).click()
  await page.getByRole('menuitem', { name: 'Technology' }).click()
  await expect(page.getByRole('button', { name: 'Technology' })).toBeVisible()
  await fillStable(page.getByLabel('Website'), website)
  await fillStable(page.getByLabel('Work Phone'), '2145550131')
  await fillStable(page.getByLabel('Company Address'), '123 Corporate Blvd, Ste 100')
  await fillStable(
    page.getByLabel(/why do you want to support/i),
    'We want to fund local FTC teams and host facility tours.'
  )
  await fillStable(page.getByLabel('Geographic Preference'), 'Texas')

  // Areas of interest is a custom div, not a checkbox — clicking toggles a border class, so
  // confirm the selection took by re-reading the class rather than an aria state.
  const focus = page.locator('div').filter({ hasText: /^Engineering$/ }).last()
  await expect(async () => {
    await focus.click()
    await expect(page.locator('.border-primary').first()).toBeVisible()
  }).toPass({ timeout: 20_000 })

  // The three agreement checkboxes are the last three on the form. Each click is verified:
  // an unchecked box fails Zod on submit with a field message and no alert, which reads as
  // a mysterious hang rather than a validation error.
  const boxes = page.getByRole('checkbox')
  const count = await boxes.count()
  for (const i of [count - 3, count - 2, count - 1]) {
    const box = boxes.nth(i)
    await expect(async () => {
      await box.click()
      await expect(box).toBeChecked()
    }).toPass({ timeout: 20_000 })
  }
}

/**
 * Submit, and wait for one of the only two legitimate outcomes: a redirect to
 * /awaiting-verification, or a server-rendered alert. Anything else means the click never
 * reached the action — re-click rather than time out 60s later on a navigation that was
 * never going to happen.
 */
async function submitSponsor(page: Page) {
  // The live path throttles 3 applications/hour/IP and every test submits from 127.0.0.1.
  await resetSponsorThrottle()

  const alert = page.locator('[data-slot="alert"]')
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.getByRole('button', { name: /submit application/i }).click()
    const settled = await Promise.race([
      page.waitForURL(/\/awaiting-verification/, { timeout: 25_000 }).then(() => true).catch(() => false),
      alert.first().waitFor({ state: 'visible', timeout: 25_000 }).then(() => true).catch(() => false),
    ])
    if (settled) return
  }
  throw new Error('Sponsor application submit neither navigated nor surfaced an alert')
}

// ─────────────────────────────────────────────────────────────────────────────
// THE MANDATORY TEST. Coaches are unpaid volunteers and a very large share of them
// legitimately sign up with a personal Gmail/Yahoo/school address. If this test is
// removed or skipped by a future change, that change is wrong.
// ─────────────────────────────────────────────────────────────────────────────

test('coach signup accepts a gmail address — volunteers use personal email', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000)
  const email = `coach-gate-${uid(testInfo.project.name.slice(0, 2))}+clerk_test@gmail.com`

  try {
    await createClerkAccount(page, '/signup', email)

    // Coach branch is preselected; fill the coach profile + incubator team (an
    // incubator team needs no FIRST registry lookup).
    await expect(page.getByLabel('Date of Birth')).toBeVisible({ timeout: 30_000 })
    await page.getByLabel('Full Name').fill('E2E Gmail Coach')
    await page.getByLabel('Date of Birth').fill('1988-05-04')
    await page.getByLabel('Phone Number').fill('2145550199')
    await page.getByLabel('Street Address').fill('120 Robotics Way')
    await page.getByLabel('City', { exact: true }).fill('Plano')
    await pickState(page, 0, 'Texas')
    await page.getByLabel('Zip Code').fill('75024')
    await page.setInputFiles('input[type="file"]', {
      name: 'photo-id.png',
      mimeType: 'image/png',
      // Real 1x1 PNG — lib/file-validation checks magic bytes, not the extension.
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
        'base64'
      ),
    })
    for (const box of await page.getByRole('checkbox').all()) await box.click()

    await page.getByText('Incubator (New Team)').click()
    await page.getByLabel('Team Name').fill('E2E Gate Testers')
    await page.getByLabel('Team City').fill('Plano')
    await pickState(page, 1, 'Texas')
    await page
      .getByLabel('Mission Statement')
      .fill('We are starting a new FTC team so students in our district get hands-on engineering experience.')
    await page.getByLabel('Community Interest').fill('Twenty students signed up at the interest meeting.')
    await page.getByLabel('Sustainability Plan').fill('District funding plus local sponsors from year two.')
    await page.getByLabel('Seed Funding Goal (USD)').fill('1500')

    await page.getByRole('button', { name: /^complete profile$/i }).click()

    // The whole point: it completes, and no domain copy appears anywhere.
    await page.waitForURL(/\/awaiting-verification/, { timeout: 60_000 })
    await expect(page.getByText(/company email address/i)).toHaveCount(0)
    await expect(page.getByText(/could not verify this request/i)).toHaveCount(0)

    const res = await rest(`/profiles?email=eq.${encodeURIComponent(email)}&select=role`)
    expect(await res.json()).toEqual([{ role: 'coach' }])
  } finally {
    await cleanupApplicant(email)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// Sponsor gating
// ─────────────────────────────────────────────────────────────────────────────

test('a sponsor on a blocked consumer domain is refused and writes no application row', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000)
  const email = `sponsor-blocked-${uid(testInfo.project.name.slice(0, 2))}+clerk_test@gmail.com`

  try {
    await createClerkAccount(page, '/sponsors/apply', email)
    await fillSponsorApplication(page, 'E2E Blocked Co', 'https://e2e-blocked-co.com')
    await submitSponsor(page)

    // `[data-slot="alert"]`, not `[role="alert"]` — Next's route announcer also carries
    // role="alert" and would make the locator ambiguous.
    const alert = page.locator('[data-slot="alert"]')
    await expect(alert).toContainText(/company email address/i, { timeout: 30_000 })
    await expect(alert).toContainText(SUPPORT_EMAIL)

    expect(await applicationsFor(email)).toHaveLength(0)

    // Audited by DOMAIN only — audit_log is what /api/admin/export dumps to CSV.
    const blocked = (await auditRows('sponsor_application_blocked')).filter(
      (a) => (a.metadata as { email_domain?: string })?.email_domain === 'gmail.com'
    )
    expect(blocked.length).toBeGreaterThan(0)
    expect(JSON.stringify(blocked)).not.toContain(email)
    expect((blocked[0].metadata as { rule_category?: string }).rule_category).toBe('consumer')
  } finally {
    await cleanupApplicant(email)
  }
})

test('an allow rule added through the admin surface unblocks the same applicant with no redeploy', async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000)
  const slug = uid(testInfo.project.name.slice(0, 2))
  const domain = `e2e-gate-${slug}.com`
  const email = `sponsor-allow-${slug}+clerk_test@${domain}`

  const adminContext = await browser.newContext()
  const adminPage = await adminContext.newPage()
  const applicantContext = await browser.newContext()
  const applicantPage = await applicantContext.newPage()

  try {
    // 1. An admin blocks the domain through the real admin surface.
    await signIn(adminPage, ADMIN_EMAIL)
    await gotoStable(adminPage, '/admin/domains')
    await expect(adminPage.getByLabel('Domain')).toBeVisible({ timeout: 30_000 })
    await adminPage.getByLabel('Domain').fill(domain)
    await adminPage.getByRole('button', { name: 'Block', exact: true }).click()
    await adminPage.getByLabel('Reason (optional)').fill('e2e gating fixture')
    await adminPage.getByRole('button', { name: /^save$/i }).click()
    await expect(adminPage.getByText(domain).first()).toBeVisible({ timeout: 30_000 })
    expect(await domainRule(domain)).toMatchObject({ rule: 'block', category: 'manual' })

    // 2. The applicant is refused.
    await createClerkAccount(applicantPage, '/sponsors/apply', email)
    await fillSponsorApplication(applicantPage, 'E2E Gate Co', `https://${domain}`)
    await submitSponsor(applicantPage)
    await expect(applicantPage.locator('[data-slot="alert"]')).toContainText(
      /company email address/i,
      { timeout: 30_000 }
    )
    expect(await applicationsFor(email)).toHaveLength(0)

    // 3. The admin flips it to allow. A data change — no deploy, no restart.
    await adminPage.getByLabel('Domain').fill(domain)
    await adminPage.getByRole('button', { name: 'Allow', exact: true }).click()
    await adminPage.getByRole('button', { name: /^save$/i }).click()
    await expect
      .poll(async () => (await domainRule(domain))?.rule, { timeout: 30_000 })
      .toBe('allow')

    // 4. The SAME page and the SAME session resubmit, and now succeed.
    await submitSponsor(applicantPage)
    await applicantPage.waitForURL(/\/awaiting-verification/, { timeout: 60_000 })

    const rows = await applicationsFor(email)
    expect(rows).toHaveLength(1)
    // An allowlisted applicant has no meaningful domain to compare against.
    expect(rows[0].domain_match).toBe('unknown')

    const audited = (await auditRows('set_email_domain_rule')).filter(
      (a) => (a.metadata as { domain?: string })?.domain === domain
    )
    expect(audited.length).toBeGreaterThanOrEqual(2)
    expect(audited.map((a) => (a.metadata as { rule?: string }).rule)).toContain('allow')
    expect(JSON.stringify(audited)).not.toContain(email)
  } finally {
    await rest(`/email_domain_rules?domain=eq.${encodeURIComponent(domain)}`, { method: 'DELETE' })
    await cleanupApplicant(email)
    await adminContext.close()
    await applicantContext.close()
  }
})

test('a domain mismatch is accepted, stored, and badged for the admin reviewer', async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000)
  const slug = uid(testInfo.project.name.slice(0, 2))
  const mailHost = `e2e-mail-${slug}.com`
  const siteHost = `e2e-site-${slug}.com`
  const email = `sponsor-mismatch-${slug}+clerk_test@${mailHost}`

  const applicantContext = await browser.newContext()
  const applicantPage = await applicantContext.newPage()
  const adminContext = await browser.newContext()
  const adminPage = await adminContext.newPage()

  try {
    await createClerkAccount(applicantPage, '/sponsors/apply', email)
    await fillSponsorApplication(applicantPage, `E2E Mismatch ${slug}`, `https://www.${siteHost}/about`)
    await submitSponsor(applicantPage)
    await applicantPage.waitForURL(/\/awaiting-verification/, { timeout: 60_000 })

    const rows = await applicationsFor(email)
    expect(rows).toHaveLength(1)
    expect(rows[0].website).toBe(`https://www.${siteHost}/about`)
    expect(rows[0].email_domain).toBe(mailHost)
    expect(rows[0].website_domain).toBe(siteHost)
    expect(rows[0].domain_match).toBe('mismatch')

    // The admins' in-app notification carries the heads-up line.
    const notes = await rest(
      `/notifications?title=eq.New%20Sponsor%20Application&select=body&order=created_at.desc&limit=10`
    )
    const bodies = ((await notes.json()) as Array<{ body: string }>).map((n) => n.body)
    expect(bodies.some((b) => b?.includes('does not match') && b.includes(mailHost))).toBe(true)

    await signIn(adminPage, ADMIN_EMAIL)
    await gotoStable(adminPage, '/applications')
    await expect(adminPage.getByText(`E2E Mismatch ${slug}`)).toBeVisible({ timeout: 30_000 })
    await expect(
      adminPage.getByText(/email domain doesn.t match company website/i).first()
    ).toBeVisible()
    await expect(adminPage.getByRole('link', { name: new RegExp(siteHost) }).first()).toBeVisible()
  } finally {
    await cleanupApplicant(email)
    await applicantContext.close()
    await adminContext.close()
  }
})

test('a matching domain is stored as match and shows no badge', async ({ browser }, testInfo) => {
  test.setTimeout(240_000)
  const slug = uid(testInfo.project.name.slice(0, 2))
  const host = `e2e-match-${slug}.com`
  const email = `sponsor-match-${slug}+clerk_test@${host}`

  const applicantContext = await browser.newContext()
  const applicantPage = await applicantContext.newPage()
  const adminContext = await browser.newContext()
  const adminPage = await adminContext.newPage()

  try {
    await createClerkAccount(applicantPage, '/sponsors/apply', email)
    await fillSponsorApplication(applicantPage, `E2E Match ${slug}`, `https://www.${host}`)
    await submitSponsor(applicantPage)
    await applicantPage.waitForURL(/\/awaiting-verification/, { timeout: 60_000 })

    const rows = await applicationsFor(email)
    expect(rows).toHaveLength(1)
    expect(rows[0].domain_match).toBe('match')

    await signIn(adminPage, ADMIN_EMAIL)
    await gotoStable(adminPage, '/applications')
    const card = adminPage.locator('[data-slot="card"]').filter({ hasText: `E2E Match ${slug}` })
    await expect(card).toBeVisible({ timeout: 30_000 })
    await expect(card.getByText(/email domain doesn.t match/i)).toHaveCount(0)
  } finally {
    await cleanupApplicant(email)
    await applicantContext.close()
    await adminContext.close()
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// Security boundaries, asserted at the DATABASE layer with each user's own Clerk
// token — PostgREST itself must deny, not just the server action.
// ─────────────────────────────────────────────────────────────────────────────

test.describe('email_domain_rules RLS', () => {
  test('a coach reads zero rows and cannot write', async ({ page }) => {
    await signIn(page, COACH_EMAIL)

    const read = await restAs(page, '/email_domain_rules?select=domain')
    expect(read.hasToken).toBe(true)
    expect(read.status).toBe(200)
    expect(JSON.parse(read.text)).toEqual([])

    const insert = await restAs(page, '/email_domain_rules', {
      method: 'POST',
      body: { domain: 'coach-should-fail.com', rule: 'allow' },
    })
    expect(insert.status).toBeGreaterThanOrEqual(400)

    const update = await restAs(page, '/email_domain_rules?domain=eq.gmail.com', {
      method: 'PATCH',
      body: { rule: 'allow' },
    })
    // Either an explicit denial, or a no-op because the row is invisible.
    expect(update.status === 200 ? JSON.parse(update.text) : 'denied').not.toContain('gmail.com')

    const del = await restAs(page, '/email_domain_rules?domain=eq.gmail.com', { method: 'DELETE' })
    expect(del.status === 200 ? JSON.parse(del.text) : 'denied').not.toContain('gmail.com')

    // The table is untouched.
    expect(await domainRule('gmail.com')).toMatchObject({ rule: 'block' })
    expect(await domainRule('coach-should-fail.com')).toBeUndefined()
  })

  test('a coach reads zero sponsor_applications', async ({ page }) => {
    await signIn(page, COACH_EMAIL)
    const read = await restAs(page, '/sponsor_applications?select=id,domain_match')
    expect(read.status).toBe(200)
    expect(JSON.parse(read.text)).toEqual([])
  })

  test('a sponsor reads zero rows', async ({ page }) => {
    await signIn(page, SPONSOR_EMAIL)
    const read = await restAs(page, '/email_domain_rules?select=domain')
    expect(read.status).toBe(200)
    expect(JSON.parse(read.text)).toEqual([])
  })

  test('an admin reads the seeded rows but still cannot write directly', async ({ page }) => {
    await signIn(page, ADMIN_EMAIL)

    const read = await restAs(page, '/email_domain_rules?select=domain&limit=200')
    expect(read.status).toBe(200)
    const rows = JSON.parse(read.text) as Array<{ domain: string }>
    expect(rows.length).toBeGreaterThanOrEqual(30)
    expect(rows.map((r) => r.domain)).toContain('gmail.com')

    // There is NO write policy — admins write through the server action, which uses the
    // admin client. A direct write must be denied even for them.
    const insert = await restAs(page, '/email_domain_rules', {
      method: 'POST',
      body: { domain: 'admin-should-fail.com', rule: 'allow' },
    })
    expect(insert.status).toBeGreaterThanOrEqual(400)
    expect(await domainRule('admin-should-fail.com')).toBeUndefined()

    const del = await restAs(page, '/email_domain_rules?domain=eq.gmail.com', { method: 'DELETE' })
    expect(del.status === 200 ? JSON.parse(del.text) : 'denied').not.toContain('gmail.com')
    expect(await domainRule('gmail.com')).toMatchObject({ rule: 'block' })
  })

  test('a coach cannot reach the admin domains surface', async ({ page }) => {
    await signIn(page, COACH_EMAIL)
    await gotoStable(page, '/admin/domains')
    await expect(page.getByLabel('Domain')).toHaveCount(0)
  })
})
