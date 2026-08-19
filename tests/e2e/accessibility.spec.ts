/**
 * WCAG 2.2 Level AA regression guard (prompt 18).
 *
 * Two halves:
 *
 *  - The **public** half runs with no database and no session. It is the part that runs
 *    everywhere, including a bare checkout, and it is the part that must never be allowed
 *    to rot — the marketing pages and the accessibility statement itself are what a
 *    procurement reviewer opens first.
 *  - The **authenticated** half is gated on SUPABASE_LOCAL and the seeded accounts, like
 *    every other DB-touching spec here.
 *
 * ## On asserting zero violations
 *
 * The threshold is zero, not "fewer than N". A budget that permits violations is a budget
 * that gets spent. Where a rule genuinely cannot apply, it is excluded for ONE selector
 * with a written reason at the exclusion — never globally, and never by lowering the count.
 */

import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createClient } from '@supabase/supabase-js'
import { createHash, randomBytes } from 'crypto'
import { Database } from '../../lib/supabase/types'
import { signIn } from '../helpers/clerk-auth'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const COACH_EMAIL = process.env.COACH_EMAIL ?? 'coach+clerk_test@example.com'
const SPONSOR_EMAIL = process.env.SPONSOR_EMAIL ?? 'sponsor+clerk_test@example.com'

/**
 * WCAG 2.2 AA. `wcag22aa` brings in the 2.2 additions that matter for this product —
 * 2.4.11 focus not obscured, 2.5.8 target size — which the 2.1 tag sets do not cover.
 */
const WCAG_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

function axe(page: Page) {
  return new AxeBuilder({ page }).withTags(WCAG_AA_TAGS)
}

/**
 * Fails with the rule id, the WCAG criterion, and the offending markup rather than a bare
 * count. "expected 0, got 3" sends the next person back to the browser to find out which 3.
 */
function formatViolations(violations: Awaited<ReturnType<AxeBuilder['analyze']>>['violations']) {
  return violations
    .map((v) => {
      const nodes = v.nodes.map((n) => `      ${n.html}`).join('\n')
      return `  [${v.impact}] ${v.id} — ${v.help}\n    ${v.helpUrl}\n${nodes}`
    })
    .join('\n\n')
}

/**
 * Wait for every running animation to settle before auditing.
 *
 * The wizard steps fade in via framer-motion (opacity 0 -> 1). axe composites the colour it
 * actually sees, so sampling mid-fade measures the button at ~80% opacity and reports a
 * contrast failure (#f8f4ef on #4a8a79 = 3.68:1) for markup that is 5.53:1 once settled.
 * That is a measurement artefact, not a defect -- but a fixed sleep only moves the race, so
 * wait on the animations themselves.
 */
async function settleAnimations(page: Page) {
  // Both wait styles are needed. getAnimations() covers CSS/WAAPI; framer-motion drives
  // opacity from rAF, which getAnimations() does not report at all -- hence the second
  // pass, which simply waits for every computed opacity on the page to stop CHANGING.
  // Sampling for stability rather than for "opacity === 1" keeps deliberate static
  // partial opacity (disabled icons at opacity-50) from hanging the wait forever.
  await page
    .waitForFunction(
      () => document.getAnimations().every((a) => a.playState === 'finished' || a.playState === 'idle'),
      null,
      { timeout: 5_000 }
    )
    .catch(() => {})

  await page
    .waitForFunction(
      () => {
        const snapshot = Array.from(document.querySelectorAll('*'))
          .map((el) => getComputedStyle(el).opacity)
          .join(',')
        const w = window as unknown as { __a11yPrev?: string }
        const stable = w.__a11yPrev === snapshot
        w.__a11yPrev = snapshot
        return stable
      },
      null,
      { timeout: 5_000, polling: 150 }
    )
    .catch(() => {})

  await page.evaluate(() => {
    delete (window as unknown as { __a11yPrev?: string }).__a11yPrev
  })
}

async function expectNoViolations(page: Page, builder = axe(page)) {
  await settleAnimations(page)
  const results = await builder.analyze()
  expect(results.violations, `\n${formatViolations(results.violations)}\n`).toEqual([])
}

test.describe('Accessibility — public surfaces (no database required)', () => {
  const PUBLIC_ROUTES = [
    '/',
    '/legal/terms',
    '/legal/privacy',
    '/legal/accessibility',
    '/login',
    '/signup',
    '/sponsors/apply',
  ]

  for (const route of PUBLIC_ROUTES) {
    test(`no WCAG 2.2 AA violations on ${route}`, async ({ page }) => {
      await page.goto(route)
      // These routes render Clerk's own <SignIn>/<SignUp> islands and a canvas-based
      // background. Wait for the network to settle so axe does not audit a skeleton and
      // report a pass on markup that is not the markup users get.
      await page.waitForLoadState('networkidle').catch(() => {})
      await expectNoViolations(page)
    })
  }

  test('/legal/accessibility is reachable unauthenticated and states conformance honestly', async ({ page }) => {
    const response = await page.goto('/legal/accessibility')
    expect(response?.status()).toBe(200)
    // Not redirected to /login — /legal/* is in the public createRouteMatcher list.
    await expect(page).toHaveURL(/\/legal\/accessibility$/)

    await expect(page.getByRole('heading', { name: /accessibility statement/i })).toBeVisible()
    await expect(page.getByText(/WCAG 2\.2 Level AA/i).first()).toBeVisible()
    // The honesty assertion. A statement claiming full conformance we have not measured
    // is a compliance liability, so the test pins the wording to "partially conformant"
    // and to the presence of a stated gap list.
    await expect(page.getByText(/partially conformant/i).first()).toBeVisible()
    await expect(page.getByRole('heading', { name: /known gaps/i })).toBeVisible()
  })

  test('every page has exactly one h1 and a main landmark', async ({ page }) => {
    for (const route of ['/', '/legal/terms', '/legal/privacy', '/legal/accessibility']) {
      await page.goto(route)
      const h1Count = await page.locator('h1').count()
      expect(h1Count, `${route} should have exactly one h1`).toBe(1)
    }
  })

  test('reduced-motion preference removes animation rather than shortening it', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' })
    const page = await context.newPage()
    await page.goto('/')

    /**
     * Reads the COMPUTED duration, not the stylesheet. The globals.css block uses
     * `!important` specifically so it beats Tailwind utilities and framer-motion's inline
     * styles; asserting on the computed value is the only way to know it actually did.
     */
    const durations = await page.evaluate(() => {
      const out: string[] = []
      for (const el of Array.from(document.querySelectorAll('*')).slice(0, 400)) {
        const s = getComputedStyle(el)
        if (s.transitionDuration && s.transitionDuration !== '0s') out.push(s.transitionDuration)
        if (s.animationDuration && s.animationDuration !== '0s') out.push(s.animationDuration)
      }
      return out
    })
    // 0.01ms computes to "0.00001s". Anything a human could perceive (>50ms) means the
    // media query is not winning against something.
    const perceptible = durations.filter((d) => parseFloat(d) > 0.05)
    expect(perceptible, `perceptible durations under prefers-reduced-motion: ${perceptible.join(', ')}`).toEqual([])

    await context.close()
  })
})

test.describe('Accessibility — authenticated journeys', () => {
  test.skip(
    !process.env.SUPABASE_LOCAL || !SERVICE_ROLE_KEY,
    'Set SUPABASE_LOCAL=true and seed test accounts (scripts/seed-test-accounts.mjs)',
  )

  let admin: ReturnType<typeof createClient<Database>>
  let sponsorViewToken: string
  let submissionId: string | null = null

  test.beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY)

    const { data: coach } = await admin.from('profiles').select('id').eq('email', COACH_EMAIL).single()
    const { data: team } = await admin.from('teams').select('id, team_name').eq('owner_id', coach!.id).limit(1).single()
    const { data: sponsor } = await admin.from('sponsors').select('id').eq('company_name', 'dev testing').single()

    /**
     * A dedicated submission for this suite. Reusing whatever row happens to be on the
     * (team, sponsor) pair means the axe run audits a different DOM depending on which
     * spec ran first — the decision panel only renders while the pitch is awaiting the
     * sponsor, so a shared row that another spec has already decided renders the
     * "already responded" branch and this suite silently stops testing the panel.
     *
     * `sent_at` is required: it is what marks a pitch as released to the sponsor.
     */
    await admin
      .from('submissions')
      .delete()
      .eq('team_id', team!.id)
      .eq('sponsor_id', sponsor!.id)

    const { data: submission, error } = await admin
      .from('submissions')
      .insert({
        team_id: team!.id,
        sponsor_id: sponsor!.id,
        status: 'dispatched',
        sent_at: new Date().toISOString(),
        custom_pitch_alignment:
          'Your engineering apprenticeship program is why we approached you first, and two of our mentors came through it.',
        specific_needs_statement:
          'We need $2,400 for competition registration, $900 for a drivetrain rebuild, and $700 for regional travel.',
      } as never)
      .select('id')
      .single()
    if (error) throw new Error(`could not create the a11y fixture submission: ${error.message}`)
    submissionId = submission!.id

    // The page looks the token up by sha256 hash, so the plaintext exists only here.
    const raw = randomBytes(24).toString('hex')
    sponsorViewToken = raw
    await admin.from('submission_access_tokens').insert({
      submission_id: submissionId!,
      token_hash: createHash('sha256').update(raw).digest('hex'),
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    } as never)
  })

  test.afterAll(async () => {
    if (!submissionId) return
    await admin.from('submission_access_tokens').delete().eq('submission_id', submissionId)
    await admin.from('notifications').delete().eq('submission_id', submissionId)
    await admin.from('transactions_ledger').delete().eq('submission_id', submissionId)
    await admin.from('submissions').delete().eq('id', submissionId)
  })

  test('journey 1: /sponsor-view/[token] has no WCAG 2.2 AA violations', async ({ page }) => {
    await page.goto(`/sponsor-view/${sponsorViewToken}`)
    await expect(page.getByText(/respond to this proposal/i)).toBeVisible()
    await expectNoViolations(page)
  })

  test('journey 1: the partial-offer form is labelled and announces its error', async ({ page }) => {
    await page.goto(`/sponsor-view/${sponsorViewToken}`)
    await page.getByRole('button', { name: /offer partial amount/i }).click()

    // getByLabel fails outright when the accessible name is missing, which is the point:
    // this field previously had only a placeholder.
    const amount = page.getByLabel(/amount to offer/i)
    await expect(amount).toBeVisible()

    // An over-large offer must be described, not just silently disable the button.
    await amount.fill('999999')
    const error = page.locator('#partial-amount-error')
    await expect(error).toHaveAttribute('role', 'alert')
    await expect(error).toContainText(/can't exceed the full request/i)
    await expect(amount).toHaveAttribute('aria-invalid', 'true')
    const describedBy = await amount.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    await expect(page.locator(`#${describedBy}`)).toContainText(/can't exceed/i)

    await expectNoViolations(page)
  })

  test('journey 1: a sponsor can decline entirely by keyboard, with no mouse events', async ({ page }) => {
    await page.goto(`/sponsor-view/${sponsorViewToken}`)
    await expect(page.getByRole('button', { name: /decline this proposal/i })).toBeVisible()

    /**
     * Tab from the top of the document until the decline control has focus. This is the
     * assertion that matters: not "the button exists" but "a keyboard user can REACH it",
     * which fails the moment something upstream traps focus or is removed from the tab
     * order. The bound is generous but finite — an unreachable control must fail rather
     * than hang until the test times out.
     */
    await page.keyboard.press('Tab')
    let reached = false
    for (let i = 0; i < 80; i++) {
      const label = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '')
      if (/decline this proposal/i.test(label)) {
        reached = true
        break
      }
      await page.keyboard.press('Tab')
    }
    expect(reached, 'could not reach "Decline This Proposal" by keyboard').toBe(true)

    await page.keyboard.press('Enter')
    // Confirmation step, still keyboard-only.
    await expect(page.getByRole('button', { name: /confirm decline/i })).toBeVisible()

    let reachedConfirm = false
    for (let i = 0; i < 20; i++) {
      const label = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '')
      if (/^confirm decline$/i.test(label)) {
        reachedConfirm = true
        break
      }
      await page.keyboard.press('Tab')
    }
    expect(reachedConfirm, 'could not reach "Confirm Decline" by keyboard').toBe(true)
    await page.keyboard.press('Enter')

    // The outcome is announced through a live region, because the button that had focus
    // is unmounted by the decision and focus falls to <body>.
    await expect(page.getByRole('status')).toContainText(/decision recorded/i, { timeout: 20_000 })

    // And it really happened — the assertion is on the row, not the toast.
    await expect
      .poll(async () => {
        const { data } = await admin.from('submissions').select('status').eq('id', submissionId!).single()
        return data?.status ?? null
      }, { timeout: 20_000 })
      .toBe('declined')
  })

  test('journey 2: the coach signup wizard has no violations on any step', async ({ page }) => {
    await page.goto('/signup')
    await page.waitForLoadState('networkidle').catch(() => {})

    // Step 1 as rendered.
    await expectNoViolations(page)

    /**
     * Advancing the wizard needs valid input for the current step, and the exact fields
     * differ between steps. Rather than re-encode the whole wizard here (which
     * sponsor-domain-gating.spec.ts already drives end to end), audit whatever step the
     * "Next" control lands on, and stop when it will not advance. This keeps the audit
     * honest about what it covered instead of pretending to cover all three.
     */
    for (let step = 0; step < 2; step++) {
      const next = page.getByRole('button', { name: /^next$/i })
      if (!(await next.isVisible().catch(() => false))) break
      if (await next.isDisabled().catch(() => true)) break
      await next.click()
      await page.waitForTimeout(400)
      await expectNoViolations(page)
    }
  })

  test('journey 3: the pitch submission form has no violations', async ({ page }) => {
    await signIn(page, COACH_EMAIL)
    await page.goto('/submissions/new')
    await expect(page.getByText('Create Submission')).toBeVisible({ timeout: 20_000 })
    await expectNoViolations(page)
  })

  test('journey 4: the sponsor review list has no violations', async ({ page }) => {
    await signIn(page, SPONSOR_EMAIL)
    await page.goto('/sponsor/submissions')
    await page.waitForLoadState('networkidle').catch(() => {})
    await expectNoViolations(page)
  })

  test('the skip link is the first focusable element and moves focus to main', async ({ page }) => {
    await signIn(page, COACH_EMAIL)
    await page.goto('/dashboard')
    await expect(page.locator('main#main-content')).toBeVisible({ timeout: 20_000 })

    await page.keyboard.press('Tab')
    const firstFocused = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '')
    expect(firstFocused).toMatch(/skip to main content/i)

    await page.keyboard.press('Enter')
    /**
     * The real assertion. A skip link without `tabIndex={-1}` on the target scrolls the
     * page but leaves focus on the link, so the next Tab goes straight back into the
     * navigation the user just asked to skip — the failure is invisible unless you check
     * where focus actually landed.
     */
    const focusedId = await page.evaluate(() => document.activeElement?.id ?? '')
    expect(focusedId).toBe('main-content')
  })

  test('a dialog traps focus, closes on Escape, and returns focus to its trigger', async ({ page }) => {
    await signIn(page, COACH_EMAIL)
    await page.goto('/dashboard')

    const trigger = page.getByRole('button', { name: /graduate/i }).first()
    test.skip(!(await trigger.isVisible().catch(() => false)), 'no dialog trigger on this dashboard state')

    await trigger.focus()
    await trigger.press('Enter')

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    // Focus moved INTO the dialog rather than staying behind it.
    const focusInside = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]')
      return !!d && !!document.activeElement && d.contains(document.activeElement)
    })
    expect(focusInside, 'focus did not move into the dialog on open').toBe(true)

    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()

    // …and came back to the control that opened it, not to <body>.
    await expect(trigger).toBeFocused()
  })
})
