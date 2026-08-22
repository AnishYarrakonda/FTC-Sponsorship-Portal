# A-08 — Accessibility (WCAG 2.2 AA), static pass

**Lane A (static — parallel-safe).** Audit id `A-08`.
**Outputs:** `prompts/audits/findings/A-08-findings.md` · `prompts/audits/handoff/A-08-claude-prompt.md`

> Read `prompts/audits/_CONTEXT-AUDIT.md` in full first.
> Prompt 18 shipped an accessibility pass and `docs/accessibility-audit.md` records it. Your
> job is to find what that pass missed and what has regressed since — **do not simply
> re-confirm the existing document.** Note that `B-04` runs the live axe sweep; you audit the
> markup, and anything you cannot decide statically, hand to `B-04` explicitly.

---

## You own

Every component and page in `app/**` and `components/**` (if present), `app/globals.css`, the
shadcn/Radix primitives in use, and `docs/accessibility-audit.md`.

WCAG 2.2 AA is the bar. Corporate and public-sector sponsors increasingly require a VPAT.

## Investigate

1. **Semantics.** Landmarks on every page (`main`, `nav`, `header`), one `h1`, no skipped
   heading levels, lists as lists, tables with `<th>`/`scope`/caption. Find every `<div>` with
   an `onClick` that should be a `<button>`, and every `<a>` used as a button.
2. **Names and labels.** Every input has a programmatic label; every icon-only button has an
   accessible name; every image has meaningful `alt` (or `alt=""` when decorative); every link
   text makes sense out of context ("click here", "view" repeated ten times in a table).
3. **Focus.** Visible focus indicators (check they survive the Tailwind reset), logical DOM
   order, focus moved into dialogs and returned on close, focus not trapped anywhere it should
   not be, and focus managed after route changes and after a mutation re-renders a list.
   Note the one skipped dialog-focus test in the E2E suite and determine whether the underlying
   behavior is actually correct or the test was skipped around a real defect.
4. **Dynamic content.** Every toast, inline validation error, async result, and status change:
   is it announced? Look for `aria-live`, `role="status"`, `role="alert"`, and `aria-busy`.
   A form that fails silently for a screen-reader user is a P1.
5. **Color and contrast.** Read the token definitions in `app/globals.css` and
   `lib/site-config.ts` accent colors. Compute contrast ratios for text, placeholder text,
   disabled text, borders on inputs, focus rings, and status badges — in **both** light and
   dark themes. Report each failing pair with its computed ratio and the required threshold.
   Also find every place color alone conveys meaning (status dots, chart series, required
   fields).
6. **WCAG 2.2 specifically** — the newer criteria are the ones most often missed: target size
   (2.5.8, 24×24 CSS px minimum), dragging alternatives (2.5.7), focus not obscured by sticky
   headers or toasts (2.4.11), consistent help placement (3.2.6), redundant entry (3.3.7), and
   accessible authentication (3.3.8) — the last matters for the signup wizard and the email
   code entry.
7. **Motion and preferences.** `prefers-reduced-motion` respected, no auto-playing motion, no
   content that depends on hover alone, and text that survives 200% zoom and 400% reflow
   (check for fixed heights and `overflow: hidden`).
8. **Forms under error.** After a failed submit, is the error programmatically associated with
   the field (`aria-describedby`, `aria-invalid`), and is focus moved to the first error?
9. **The documents themselves.** Generated PDFs/receipts and the impact report: tagged, with a
   language and title, or at minimum an accessible HTML alternative. Untagged PDFs fail
   procurement checklists.

## Done when

Findings are grouped by WCAG criterion with the file and line for each, contrast failures carry
computed ratios for both themes, and anything requiring a running browser is listed in an
explicit `## Hand to B-04` section.
