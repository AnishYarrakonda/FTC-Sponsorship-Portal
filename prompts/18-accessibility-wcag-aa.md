# Prompt 18 — Accessibility: WCAG 2.2 Level AA

> **Prerequisites:** None (but run it late — it audits surfaces earlier prompts build)
> **Reserved migration:** None — no schema changes
> **Scope:** large · ~15 files
> **Leaves the repo:** green and shippable on its own

## Why this exists

A corporate sponsor's procurement or compliance team will ask whether this tool meets WCAG
2.2 AA, and increasingly will ask for an accessibility conformance statement in writing.
Visible failures — an unlabelled icon button, a form error only conveyed by red text, a modal
that traps nothing and announces nothing — read as amateur to anyone who checks. More
practically: a sponsor's employee using a screen reader or keyboard-only navigation has to be
able to fund a team, and today nobody has verified they can.

## Current state (verified)

**What exists**

- **Playwright** at `playwright.config.ts`, `testDir: './tests'`, three browser projects
  (chromium, firefox, webkit), `globalSetup: './tests/global-setup.ts'`, `baseURL`
  `http://localhost:3000`, and a `webServer` block running `npm run dev`.
- Ten E2E specs in `tests/e2e/`: `auth`, `denial-flow`, `fulfillment-transitions`,
  `fulfillment-ui`, `golden-path`, `not-found`, `payout-w9`, `portfolio-sections`,
  `public-pages`, `receipts`.
- **Radix UI** primitives (`@radix-ui/react-dialog`, `-dropdown-menu`, `-popover`,
  `-tabs`, `-checkbox`, `-radio-group`, `-progress`, `-label`, `-separator`) and
  `@base-ui/react`. These ship good keyboard and ARIA behavior **by default**, which means
  most violations will be in our own composition, not the primitives.
- **framer-motion** ^12 — animation that must honour `prefers-reduced-motion`.
- **Tailwind v4** with theme tokens in `app/globals.css`, plus `next-themes` for dark mode.
  Contrast must be checked in **both** themes.
- Vitest with `@testing-library/react` and `@testing-library/jest-dom` for unit-level checks.

**What is missing**

`grep -iE "axe|lighthouse|jest-axe" package.json` returns nothing. There is no automated
accessibility check, no manual audit on record, no accessibility statement page, and no
regression guard. Nothing prevents the next PR from adding a new violation.

## What you are building

1. An automated axe-core pass wired into the existing Playwright suite.
2. A manual audit of four priority journeys, with findings recorded.
3. Fixes for the violations found in those four journeys.
4. A committed accessibility statement page.
5. A regression guard so new violations fail the test run instead of accumulating.

**Scope this honestly.** "Fix the top violations in four priority journeys and add the guard"
is achievable in one session. "Make the entire app perfect" is not. If you find more than you
can fix, fix the blockers, log the rest in the audit document, and say so in your report.

## Data model

**None — no schema changes.**

## Priority journeys

Fix these four first, in this order. Everything else is secondary.

1. **`/sponsor-view/[token]`** — highest stakes. This is the page a corporate user sees
   *first*, often before they have any account, and it is where they accept or decline
   funding. It must be fully operable by keyboard and screen reader. Note it renders the
   decision panel (`components/sponsor/sponsor-decision-panel.tsx`) including a partial-amount
   input, which is a classic accessible-form-error case.
2. **Coach signup wizard** (`app/(auth)/signup/`) — multi-step, file upload, inline Clerk
   email-code verification. Multi-step forms are where focus management fails: after
   advancing a step, focus must move somewhere sensible and the step change must be announced.
3. **Pitch submission form** (`app/(coach)/submissions/`) — long form, rich text (Tiptap),
   validation errors. Tiptap editors need an accessible name and a documented keyboard escape
   path, or keyboard users get trapped in the editor.
4. **Sponsor review and decision flow** (`app/(sponsor)/sponsor/submissions/[id]/`,
   `components/sponsor/review-shell.tsx`) — the logged-in counterpart to journey 1.

## Automated pass

Add `@axe-core/playwright` as a devDependency. Justification: it is the standard integration
for the test runner already in the project, adds no runtime weight, and is the only new
dependency this prompt introduces.

- Create `tests/e2e/accessibility.spec.ts` covering the four priority journeys plus the
  public pages already exercised by `public-pages.spec.ts`.
- Configure the axe run for **WCAG 2.2 AA**: tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`,
  `wcag22aa`.
- Assert **zero violations**, not "fewer than N". A threshold that permits violations is a
  threshold that grows.
- Where a violation is a genuine false positive or a known third-party issue, disable that
  specific rule **for that specific selector**, with an inline comment explaining why. Never
  disable a rule globally.
- Run against the seeded accounts or the preview modes
  (`npm run dev:sponsor-preview` / `dev:coach-preview` / `dev:admin-preview`) so the suite does
  not depend on live data.

Also run a **Lighthouse accessibility audit** on the four journeys and record the scores in
the audit document. Lighthouse catches some things axe does not surface the same way. This is
a one-time measurement, not a CI gate.

## Manual checks — what automation cannot catch

Automated tooling finds roughly a third of WCAG issues. These require a human:

- **Keyboard-only traversal** of all three portals. Unplug the mouse. Every interactive
  element must be reachable and operable, in a logical order, with no keyboard trap.
- **Visible focus indicators** on every interactive element, in both light and dark themes.
  Tailwind's default ring is often removed by custom styles — check, do not assume.
- **Focus management in dialogs** — Radix handles trapping, but verify focus moves *into* the
  dialog on open and returns to the triggering element on close, and that `Escape` closes.
- **Accessible names on icon-only buttons** — every icon button needs an `aria-label` or
  visually-hidden text. `lucide-react` icons are decorative and need `aria-hidden`.
- **Form errors** programmatically associated with their inputs (`aria-describedby`),
  announced via a live region, and **not conveyed by colour alone**. Check the Zod error
  rendering path used across `app/actions/*` consumers.
- **Colour contrast** ≥ 4.5:1 for body text and ≥ 3:1 for large text and UI component
  boundaries, verified against `app/globals.css` tokens in **both** themes.
- **`prefers-reduced-motion`** honoured for all framer-motion usage. Animation should reduce
  to an instant state change, not merely slow down.
- **Heading hierarchy** — one `h1` per page, no skipped levels — and **landmark regions**
  (`header`, `nav`, `main`, `footer`) present so screen-reader users can skip navigation.
- **Skip-to-content link** as the first focusable element on each portal layout.
- **Page titles** unique and descriptive per route.
- **WCAG 2.2 additions specifically:** target size ≥ 24×24 CSS px (2.5.8), focus not obscured
  by sticky headers (2.4.11), and no drag-only interactions without a single-pointer
  alternative (2.5.7).

Test with a real screen reader on at least journey 1 — VoiceOver on macOS is already on the
development machine. Record what you heard, not what you expected to hear.

## Server actions

None. This slice changes presentation and markup only.

If you find that fixing an error-announcement issue requires changing what a server action
*returns*, keep the change additive — the canonical shape returns `{ error: string }` and
every existing caller depends on it. Do not restructure action return types here.

## UI

Fixes land across the component tree; the shape of the work is:

- `components/ui/*` — shared primitives. Fixing an accessible name or focus ring here fixes
  it everywhere, so start here before patching call sites.
- Portal layouts (`app/(coach)/`, `app/(sponsor)/`, `app/(admin)/`) — landmarks, skip links,
  heading structure.
- `app/globals.css` — contrast token adjustments and a `prefers-reduced-motion` block.
- The four priority journeys' own components.

**New page:** `app/legal/accessibility/page.tsx` — a VPAT-style accessibility conformance
statement. Procurement teams ask for one. It must state the standard targeted (WCAG 2.2 AA),
the current conformance level honestly including known gaps, the date last reviewed, and a
contact route for accessibility problems. Do not claim full conformance you have not verified.

It lives under `/legal`, which is **already** in the `createRouteMatcher` public list in
`middleware.ts` — so no middleware change is needed. Verify that before assuming it. Link it
from the footer alongside the existing terms and privacy links.

## Out of scope

- WCAG AAA. AA is the procurement bar.
- A full third-party accessibility audit or certification.
- Rewriting away from Radix or framer-motion.
- Fixing every violation in every admin surface. Admin is internal; prioritise the four
  journeys and log the rest.
- Any schema or server-action behavior change.

## Guardrails specific to this slice

- **Do not disable rules to make the suite pass.** A green suite achieved by suppression is
  worse than a red one, because it stops anyone looking again.
- **Do not change behavior while fixing markup.** This is the highest-risk failure mode here —
  an "accessibility fix" that alters a form's submit path can break funding flows. Keep diffs
  presentational.
- **Check both themes.** `next-themes` means every contrast fix has two answers.
- **Radix already handles most keyboard semantics.** If you are hand-rolling `role`,
  `aria-expanded`, or keydown handlers on a Radix primitive, you are probably fighting it —
  and likely breaking it.
- Preview modes are forced off in production; the axe suite must not depend on a preview-only
  DOM that real users never see. Verify at least journey 1 against a seeded real account.
- Stay in scope: no drive-by refactors, no dependency bumps beyond `@axe-core/playwright`.

## Files you will touch

**Create:**
- `tests/e2e/accessibility.spec.ts`
- `app/legal/accessibility/page.tsx`
- `docs/accessibility-audit.md` — findings, what was fixed, what was deferred, Lighthouse
  scores, screen-reader notes

**Modify:**
- `package.json` — add `@axe-core/playwright` devDependency
- `app/globals.css` — contrast tokens, `prefers-reduced-motion`
- `components/ui/*` — accessible names, focus rings (only the files that need it)
- `app/(coach)/layout.tsx`, `app/(sponsor)/layout.tsx`, `app/(admin)/layout.tsx` — landmarks
  and skip links
- `app/sponsor-view/[token]/page.tsx` and `components/sponsor/sponsor-decision-panel.tsx`
- `components/sponsor/review-shell.tsx`
- `app/(auth)/signup/` — wizard focus management
- The footer component — link the accessibility statement
- `prompts/README.md` — mark this prompt done

Do not modify a file just because it is listed. Modify what the audit shows is broken.

## Tests

**Playwright — `tests/e2e/accessibility.spec.ts`:**
- Zero axe violations at WCAG 2.2 AA on `/sponsor-view/[token]`, the coach signup wizard
  (each step), the pitch submission form, the sponsor review page, and the existing public
  pages.
- Keyboard-only completion of the sponsor decision on `/sponsor-view/[token]` — tab to the
  decision control, operate it, and confirm the outcome, with no mouse events.
- A dialog returns focus to its trigger on close and closes on `Escape`.
- The skip-to-content link is the first focusable element and moves focus to `main`.

**Vitest:**
- Icon-only buttons in `components/ui/*` render an accessible name (use
  `getByRole('button', { name })` from Testing Library, which fails when the name is absent).

**Regression guard:** the axe spec must run as part of `npx playwright test`, so a new
violation fails the suite. Note in `docs/accessibility-audit.md` that this suite is the
guard, and that suppressions require a written justification in the diff.

## Acceptance criteria

- [ ] `npx playwright test tests/e2e/accessibility.spec.ts` passes with **zero** axe
      violations across all four priority journeys and the public pages.
- [ ] The full sponsor decision on `/sponsor-view/[token]` can be completed keyboard-only,
      demonstrated by a passing test.
- [ ] Every interactive element has a visible focus indicator in **both** light and dark
      themes, verified by hand and noted in the audit doc.
- [ ] Form validation errors are announced to a screen reader and are not conveyed by colour
      alone.
- [ ] `prefers-reduced-motion: reduce` eliminates framer-motion animation rather than slowing it.
- [ ] Each priority journey has exactly one `h1`, no skipped heading levels, and `main`/`nav`
      landmarks.
- [ ] `/legal/accessibility` renders publicly without authentication and states conformance
      honestly, including known gaps.
- [ ] `docs/accessibility-audit.md` records findings, fixes, deferrals, Lighthouse scores, and
      screen-reader observations.
- [ ] No rule is globally disabled; any per-selector suppression carries an inline
      justification.
- [ ] No behavioral change to any funding, submission, or auth flow — the existing E2E specs
      (`golden-path`, `fulfillment-ui`, `receipts`, `payout-w9`, `auth`) still pass unchanged.
- [ ] `npm run typecheck && npm run lint && npm run build && npm run test` all green.

## Rollback

No migration to reverse.

- Revert the component and CSS changes with `git revert`. They are presentational and carry
  no data implications.
- Remove `@axe-core/playwright` and `tests/e2e/accessibility.spec.ts` to drop the guard.
- `app/legal/accessibility/page.tsx` can be deleted independently; nothing else depends on it
  except the footer link.

Because this slice touches many files but changes no behavior, prefer reverting individual
commits over the whole slice if one fix causes a regression.

## Commit

```
feat(a11y): WCAG 2.2 AA pass across priority journeys with axe regression guard
```
