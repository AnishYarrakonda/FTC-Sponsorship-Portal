# `_RUNNER-AUDIT.md` — how to run the audit pack

Sixteen audits. Twelve are static and run in parallel; four need the live stack and run one
at a time. Each produces a findings report and a **paste-ready fix prompt for Claude Code**.

---

## The loop

1. Open a Gemini agent (Antigravity) on this repo.
2. Paste this launch line, substituting the audit file:

   > Read `prompts/audits/_CONTEXT-AUDIT.md` in full, then execute
   > `prompts/audits/prompts/A-01-auth-identity.md`. Obey the output contract exactly:
   > write both files, then print the handoff prompt as one fenced block and nothing else.

3. Copy the fenced block it prints at the end.
4. Paste it into a fresh Claude Code terminal. That session fixes the findings and
   independently re-verifies each one before touching anything.

---

## The audits

### Lane A — static. Run as many at once as you like.

| ID | Audit | Owns |
|---|---|---|
| `A-01` | Auth & identity bridge | Clerk↔`profiles`, guards, middleware, role trust |
| `A-02` | RLS & tenant isolation | policies, `current_sponsor_ids()`, cross-sponsor leakage, COPPA |
| `A-03` | Server-action conformance | the 5-step shape, validation, audit trail, races |
| `A-04` | Capacity, funding & ledger integrity | reservations, drift, the fulfillment state machine |
| `A-05` | Email & notification pipeline | the dispatch gate, Resend, webhooks, templates |
| `A-06` | Storage & documents | bucket paths, W-9/credential retention, receipts, e-sign artifacts |
| `A-07` | UI/UX & information architecture | enterprise credibility, states, navigation, copy |
| `A-08` | Accessibility — static pass | WCAG 2.2 AA in the markup |
| `A-09` | Performance, scale & tier limits | indexes, N+1, bundle, **free tier vs Pro** |
| `A-10` | Security posture | secrets, IDOR, SSRF, BotID, tokens, headers, abuse |
| `A-11` | Observability & failure recovery | Sentry, cron, retries, idempotency, runbooks |
| `A-12` | Enterprise gap analysis | seats, offboarding, delegation, procurement, SSO, CSR |

### Lane B — live stack. Strictly one at a time.

| ID | Audit | Owns |
|---|---|---|
| `B-01` | Auth flows, live | signup, email verification, password reset, session lifetime |
| `B-02` | Sponsor organizations, live | invites, roles, the approver workflow, domain gating |
| `B-03` | Full journeys, live | pitch → moderation → decision → fulfillment → receipt → e-sign → export |
| `B-04` | A11y & responsive, live | axe with animations settled, keyboard, viewport sweep |

### A sensible order

Run all of Lane A at once first — it is free, parallel, and it tells the Lane B audits where
to look. Then run `B-01 → B-02 → B-03 → B-04`, one at a time, tearing down between them.

You do not have to fix between audits. Collect the handoff prompts and work through them
P0-first across the whole pack; `A-02`, `A-04`, and `A-10` are the ones most likely to
produce something that should be fixed immediately.

---

## Lane B ground rules — the parts that have already cost a day

- **One project per Playwright invocation.** `--project=chromium` and `--project=firefox` in a
  single command share one global setup, so the first project's settled ledger rows survive as
  orphans and eat the fixture sponsor's cap; the second project's golden path then fails at
  approve-and-dispatch. Two commands, always.
- **WebKit is permanently excluded** — it cannot reach Clerk's FAPI at all.
- **Clerk throttles.** Three full sweeps inside ~50 minutes made account creation time out and
  cascade into 401s. Space the runs out; restart the dev server rather than chasing it.
- **Export local Supabase env in the shell before starting anything.** dotenv does not override
  already-set shell vars, and that is the only thing keeping the suite off production. Derive
  keys from `npx supabase status -o json`; never write them to a file.
- **`reuseExistingServer: true`** — a stray production-env dev server on `:3000` is silently
  reused. Verify `next-server` has no external connections before you trust a run.
- **A fixture that inserts a submission must set `reserved_amount_cents: 0`** unless it also
  does the capacity bookkeeping, or it hands the sponsor capacity it never spent.
- **An aborted run** leaves the fixture team as `incubator`, which makes the *next* run's
  `portfolio-sections` fail on a heading that is correctly absent. Re-run, don't chase it.

The full startup recipe lives in `prompts/_NEXT-SESSION.md` and is restated inside each
Lane B prompt.

---

## Output layout

```
prompts/audits/
  _CONTEXT-AUDIT.md          the contract every audit obeys
  _RUNNER-AUDIT.md           this file
  prompts/                   the 16 audit prompts
  findings/                  <ID>-findings.md      full evidence, written by Gemini
  handoff/                   <ID>-claude-prompt.md the paste-ready fix prompt
```
