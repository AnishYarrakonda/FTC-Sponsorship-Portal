# A-07 — UI/UX & information architecture

**Lane A (static — parallel-safe).** Audit id `A-07`.
**Outputs:** `prompts/audits/findings/A-07-findings.md` · `prompts/audits/handoff/A-07-claude-prompt.md`

> Read `prompts/audits/_CONTEXT-AUDIT.md` in full first.
> The bar for this audit is not "does it look fine". It is: **would a director of corporate
> giving at a Fortune 500 company trust this with a $50,000 decision?**

---

## You own

Every route group — `app/(account|admin|auth|coach|public|sponsor)`, plus `app/legal`,
`app/sponsors`, `app/sponsor-view`, `app/receipts`, `app/agreement-records`, the root
`page.tsx`, `error.tsx`, `not-found.tsx`, `loading` boundaries — and `lib/site-config.ts`.
Static reading only; the live sweep is `B-04`.

## Investigate

1. **Map the IA per role.** For coach, sponsor member (each role), platform admin, and
   anonymous: every reachable page, how it is reached, and what the primary action on it is.
   Then find the orphans — pages reachable only by typing a URL — and the dead ends: a page
   with no path back and no next step. Say what the "home" of each role is and whether it
   answers "what do I need to do right now?" above the fold.
2. **The four states, everywhere.** For every list, table, and data panel, check **empty,
   loading, error, and partial**. Name each component that has no empty state (a brand-new
   sponsor with zero submissions sees a blank rectangle), no loading treatment (layout shift),
   or no error boundary. A first-run experience that looks broken is a P1 for a product being
   sold to enterprises.
3. **Destructive and irreversible actions.** Every one of them: is it confirmed, is the
   confirmation specific about consequences, is it undoable, and is the button styled to match
   its danger? A decline, a cancellation, or a void with a one-word confirm is a finding.
4. **Forms.** Long forms (the signup wizard, the pitch composer, the portfolio editor, W-9,
   agreement signing): is work preserved on navigation away or a failed submit, are errors
   shown inline next to the field and summarized at the top, is the submit button disabled
   during flight, is double submit prevented in the UI as well as the server, and are the
   server's max lengths reflected in the input?
5. **Money and dates.** Every amount rendered: consistent currency formatting, no floats, no
   truncated cents. Every timestamp: a stated time zone or a relative format, consistently
   applied. Inconsistency here reads as amateurism to a finance reviewer.
6. **Status vocabulary.** Collect every status label shown to a user across submissions,
   fulfillments, appeals, agreements, and awards. Are the same underlying states named the same
   way everywhere? Does the user ever see a raw enum (`changes_requested`), an internal id, or
   a database error string? Would a coach understand what to do next from the label alone?
7. **Cross-role coherence.** Follow one submission through every screen that shows it — coach,
   admin queue, sponsor view, public sponsor-view link, receipt, impact report — and check that
   the same facts are presented consistently. Contradictions between two screens are the kind
   of thing that ends a corporate pilot.
8. **Trust surface.** The public marketing pages and `lib/site-config.ts`: are any stats,
   sponsor logos, or testimonials static fixtures presented as real? Shipping a fabricated
   claim to a corporate prospect is a serious finding regardless of severity elsewhere. Also
   check the legal pages exist and are linked from where they are legally needed.
9. **Responsiveness and density, read from the markup.** Tables that will overflow on a laptop,
   fixed widths, long-content overflow (a 200-character team name, a 12-digit amount), and
   whether the admin queue works at realistic row counts.

## Enterprise lens

Multiple employees share one sponsor account. Does every screen make it clear **who** did
something and **on whose behalf**? Is there anywhere a viewer sees an action they cannot
perform, with no explanation of why it is disabled? Is there any way to hand a colleague a link
to exactly what you are looking at?

## Done when

Every role's IA map is in the report, every missing empty/loading/error state is named with its
file, the status vocabulary table is complete, and the trust-surface check has a verdict.
