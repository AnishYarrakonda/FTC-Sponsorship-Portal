# `/prompts` — Enterprise-readiness prompt pack

Eighteen sequential, self-contained session prompts that take FTC Pitfund from "working
product" to "a Fortune 500 legal and finance team can say yes to this."

Run them one at a time, in a fresh agent session each, in the order below.

---

## Start here

1. Read **[`_CONTEXT.md`](_CONTEXT.md)** — the verified ground truth about this codebase.
   Every prompt assumes it. It encodes the traps that actually cause bugs here
   (`auth.uid()` is NULL under Clerk, SECURITY DEFINER defaults to PUBLIC, the
   `submissions` column allowlist fails closed, the anon key has no `sub`).
2. Read **[`_RUNNER.md`](_RUNNER.md)** — copy the launcher block, fill in two blanks, paste
   into Claude / Codex / Gemini / Cursor. It carries the execution contract that forces
   verification instead of "should work."
3. Run prompt `01`. Then `02`. And so on.

```
Execute prompts/01-funding-fulfillment-state-machine.md.
Additional directions: <anything specific to your run>
<+ the execution contract from _RUNNER.md>
```

---

## What this pack fixes

An external review found ~15 gaps. Three of them turned out to be **wrong** on inspection,
and that matters — rebuilding working code is how you introduce bugs:

| Audit claim | Reality |
|---|---|
| "No refund/capacity release logic" | **Already built.** `release_submission_reservation` (0047), the delete trigger (0067), the bounce path, and the nightly expiry cron all release reserved capacity. Prompt `11` *verifies* it and adds a drift detector. Do not rebuild it. |
| "Team legitimacy isn't verified" | **Half built.** `lib/ftc-roster.ts` already queries FTCScout and caches into `ftc_teams_cache`. Missing: the official FIRST source, a name/org cross-check, and enforcement. Prompt `07`. |
| "No rate limiting/CAPTCHA on sponsor apply" | **Already limited.** A honeypot plus the in-Postgres `check_throttle` RPC (3/hr per IP, 2/day per email). Prompt `16` hardens with BotID; it does not start from zero. |

The rest are confirmed real. The two that genuinely block showing this to anyone:

- **Money flow is undefined.** `transactions_ledger` records a *commitment*, not a payment.
  The sponsor funding page labels those rows "Confirmed disbursements" — currently untrue.
  Nothing in the system ever learns whether money moved. → prompts `01`–`04`
- **No legal agreement layer.** No corporation wires $5–50k on a pitch and a click.
  → prompts `05`–`06`

---

## Locked decisions

These were settled before the pack was written. Prompts assume them; don't relitigate
inside a session.

| Decision | Choice | Why it matters |
|---|---|---|
| **Money flow** | Pledge + track. The platform **never touches funds**. | No Stripe, no escrow, no PCI scope, no money-transmitter exposure. Sponsors pay teams directly; the app tracks state, collects the W-9, issues receipts. |
| **E-sign** | In-house, ESIGN/UETA-valid | Typed name + consent + IP + UA + UTC timestamp + SHA-256 of the displayed document, stored immutably. Behind a provider interface so a vendor can be swapped in later. |
| **Sponsor multi-user** | Clerk Organizations | Orgs, invitations, and SAML/OIDC come with the platform we already pay for. Mirrored to `sponsor_members` so Postgres RLS can key off it. |
| **FTC verification** | Official FIRST API primary, FTCScout fallback | Extends the existing `ftc_teams_cache`. |
| **Production data** | Pre-launch, none | Reshaping is safe. Migrations stay idempotent anyway. |

---

## Progress

| Status | Prompts |
|---|---|
| ✅ Shipped | `01` fulfillment machine · `02` payout profiles + W-9 · `03` fulfillment UI · `04` receipts & acknowledgment letters · `05` sponsorship agreement templates · `06` e-sign capture flow · `07` official FIRST team verification · `08` sponsor organizations · `09` org roles & approver workflow · `10` enterprise SSO |
| 🚧 Partial | `07` — code/migration/tests shipped and deployed, but `FIRST_API_USERNAME` / `FIRST_API_TOKEN` are **not yet set in Vercel** (nobody has registered at ftc-events.firstinspires.org/services/API). The system runs correctly on the FTCScout fallback in the meantime; set both vars whenever the credentials arrive — no code changes needed. |
| 🚧 Partial | `10` — the code half (least-privilege JIT provisioning, idempotent role reconciliation, the read-only SSO panel, `docs/enterprise-sso-runbook.md`) is shipped. **No enterprise connection has been created in Clerk**, because none has been asked for and the Clerk plan gate (Pro/Business on production) is unconfirmed. Follow the runbook when the first sponsor's IT team asks. |
| 🚧 Partial | `11` — the code half (reviewer/super-admin split, `requireSuperAdmin()`, admin team + capacity pages, drift detector wiring, tests) is written and green. **Migration `0084` has NOT been applied**, so nothing is live yet: apply it with `psql -f`, then run `SUPABASE_LOCAL=1 npm run verify:capacity` against a scratch database and the `rls-auditor` agent over `profiles`/`sponsors`/`sponsor_applications`. Roll the code back BEFORE the migration if you ever revert — dropping `admin_level` while `requireSuperAdmin()` is deployed fails every super-admin action. |
| ⬜ Not started | `12`–`18` |

Migrations applied so far: `0076`, `0077`, `0078`, `0079`, `0080`, `0081`, `0082`, `0083`.
`0084` is written but **not yet applied**.
Prompt `10` added no migration. Real head is always `ls supabase/migrations | tail -3` —
trust that over this table.

**Do not re-run `01`–`11`.** Their "Current state (verified)" sections were regenerated after
the implementations landed, so they now describe finished work rather than the gap they were
written to close.

---

## The 18 prompts

Migration numbers are **reserved** — each prompt tells the agent to confirm the number is
still free before writing.

### Money — the blocking set
| # | Prompt | Needs | Migration |
|---|---|---|---|
| 01 | [Funding fulfillment state machine](01-funding-fulfillment-state-machine.md) | — | `0076` |
| 02 | [Team payout profile: W-9 & tax docs](02-team-payout-profile-w9.md) | — | `0077` |
| 03 | [Fulfillment UI & admin reconciliation](03-fulfillment-ui-and-reconciliation.md) | 01, 02 | — |
| 04 | [Receipts & acknowledgment letters](04-receipts-and-acknowledgment-letters.md) | 01, 02 | `0078` |

### Legal — the other blocking set
| # | Prompt | Needs | Migration |
|---|---|---|---|
| 05 | [Sponsorship agreement templates & versioning](05-sponsorship-agreement-templates.md) | — | `0079` |
| 06 | [E-sign capture flow](06-esign-capture-flow.md) | 05, 01 | `0080` |

### Identity & access
| # | Prompt | Needs | Migration |
|---|---|---|---|
| 07 | [Official FIRST team verification](07-first-official-team-verification.md) | — | `0081` |
| 08 | [Sponsor organizations (Clerk Orgs)](08-sponsor-organizations.md) | — | `0082` |
| 09 | [Org roles & approver workflow](09-org-roles-and-approver-workflow.md) | 08 | `0083` |
| 10 | [Enterprise SSO (SAML/OIDC)](10-enterprise-sso.md) | 08 | — |

### Governance & engagement
| # | Prompt | Needs | Migration |
|---|---|---|---|
| 11 | [Admin roles + capacity-integrity audit](11-admin-roles-and-capacity-audit.md) | — | `0084` |
| 12 | [Moderated sponsor↔coach Q&A](12-sponsor-coach-qa-thread.md) | — | `0085` |
| 13 | [Coach appeals path](13-coach-appeals-path.md) | 11 | `0086` |

### Value & polish
| # | Prompt | Needs | Migration |
|---|---|---|---|
| 14 | [Sponsor recognition tiers](14-sponsor-recognition-tiers.md) | 01 | `0087` |
| 15 | [CSR/ESG impact report export](15-csr-impact-report-export.md) | 01, 14 | `0088` |
| 16 | [BotID + corporate email gating](16-botid-and-corporate-email-gating.md) | — | `0089` |
| 17 | [Email deliverability (SPF/DKIM/DMARC)](17-email-deliverability.md) | — | — |
| 18 | [Accessibility — WCAG 2.2 AA](18-accessibility-wcag-aa.md) | — | — |

**08 is the riskiest prompt in the pack.** It rewrites how a sponsor is resolved in RLS —
today that is `profiles.sponsor_id`, written in exactly one place. Run it when you have time
to verify carefully, and make sure its `rls-auditor` acceptance criterion actually passes.

**17 is more urgent than its position suggests.** The Resend webhook drives `delivered` /
`opened` / `bounced` submission statuses, so poor deliverability doesn't just hurt inbox
placement — it corrupts the funding state machine. Consider pulling it forward.

---

## Ground rules for every session

Enforced by the contract in `_RUNNER.md`, restated here so they're impossible to miss:

- **One prompt = one shippable slice.** `typecheck`, `lint`, `build`, and `test` must all be
  green at the end. You can safely stop after any prompt.
- **Stay in scope.** No drive-by refactors, renames, or dependency bumps. Unrelated bugs get
  reported, not fixed.
- **The code wins over the prompt.** If a prompt describes a file inaccurately, stop and
  report rather than working around it.
- **Never violate a Core Mandate** — COPPA, admin-gatekept outreach, capacity integrity,
  portfolio-vs-submission separation. If a prompt seems to require it, that's a bug in the
  prompt.
- **Browser-verify before claiming done.** A report whose *Verification* section says
  "browser-verified: n/a" means the feature isn't done.
- **Deploys are manual** — `vercel deploy --prod --yes`. Pushing to `main` does nothing;
  there is no Git integration on the Vercel project.

---

## Keeping this pack honest

These prompts were written against migration `0075` and the code as it stood then. As you
work through them the codebase moves underneath the later ones.

- After each prompt, if it changed something a later prompt described, **update that later
  prompt**. Five minutes now beats an agent confidently building against a stale spec.
- If an agent bumps a migration number because of a collision, fix the tables in this README
  and in `_RUNNER.md`.
- `_CONTEXT.md` §2 (the schema map) is the highest-value thing to keep current. Prompts
  `01`–`18` all read from it.
