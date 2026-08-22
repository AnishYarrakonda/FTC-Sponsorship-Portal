# B-04 — Accessibility & responsive behavior, live

**Lane B (live stack — run alone).** Audit id `B-04`.
**Outputs:** `prompts/audits/findings/B-04-findings.md` · `prompts/audits/handoff/B-04-claude-prompt.md`

> Read `prompts/audits/_CONTEXT-AUDIT.md` **and** `_LANE-B-SETUP.md` in full first.
> Run after `A-08`; start from its `## Hand to B-04` section, which lists everything the static
> pass could not decide.

---

## You own

The running application measured with real tooling, across viewports and themes, with a
keyboard and a screen reader.

**The one trap that invalidates results here:** axe must run with **animations settled**.
Elements at `opacity: 0` are skipped entirely, and a mid-fade element produces phantom contrast
failures. Wait for animations to complete before every scan, and treat any contrast failure you
cannot reproduce after a settle as noise — say so rather than reporting it.

## Run these

1. **Automated sweep.** Run axe (via the existing Playwright setup or `@axe-core/playwright`)
   on every authenticated and public page, for **each** role, in **both** light and dark themes,
   at 1440px, 1024px, 768px, and 375px. Report violations grouped by rule with the affected
   selector and page. Distinguish "new" from "already recorded in `docs/accessibility-audit.md`".
2. **Interactive states — the part automation misses.** Open every dialog, drawer, dropdown,
   combobox, tooltip, toast, and date picker and scan **that state**. Most real violations live
   in components that are not in the initial DOM. Include every confirmation dialog on a
   destructive action.
3. **Keyboard only.** Unplug the mouse, metaphorically. Complete these entirely by keyboard:
   coach sign-up, composing and submitting a pitch, admin approving from the queue, sponsor
   deciding, and signing an agreement. Record every trap, every unreachable control, every place
   focus is lost after an action, and every place the focus ring is invisible. A destructive
   action reachable only by mouse is a P1.
4. **Focus after mutation.** Submit a form, delete a row, close a dialog, change a filter —
   where does focus go each time? Is the result announced?
5. **Screen reader spot checks.** With VoiceOver, walk the sponsor dashboard, the admin queue,
   and the pitch composer. Are statuses, table relationships, and validation errors conveyed?
   Is anything announced that should not be, or announced twice?
6. **Zoom and reflow.** 200% zoom and a 320px-wide viewport on every primary page: content
   clipped, horizontal scrolling, controls off-screen, sticky headers covering focus.
7. **Reduced motion and forced colors.** Enable `prefers-reduced-motion` and Windows
   high-contrast / forced-colors emulation, and record what breaks or disappears.
8. **Real contrast.** With animations settled, measure the pairs `A-08` flagged, plus every
   status badge, disabled control, placeholder, and focus ring, in both themes. Report computed
   ratios, not impressions. Confirm hover states darken rather than lighten past the threshold.
9. **The skipped test.** The E2E suite skips one dialog-focus a11y test. Determine by hand
   whether the behavior is actually correct or the test was skipped around a real defect, and
   say which.

## Done when

Every page has been scanned in both themes at four viewports **and** in its interactive states,
the five keyboard journeys are complete, each finding names a WCAG criterion, and teardown is
complete per `_LANE-B-SETUP.md`.
