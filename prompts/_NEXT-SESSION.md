# Next session — start here

**Written:** 2026-08-23, at the end of the session that executed the P0 **and P1** sweeps of
the Gemini audit pack.
**Branch:** `main`. PRs #5–#10 merged and deployed.
**Production:** all code from both sweeps is deployed and smoke-tested (`/api/health` reports
`db: "ok"`, protected routes 307, `/api/*` 401). **Migrations `0098`–`0105` are NOT applied to
production** — see "What is actually owed" below. Until `0098` lands, anyone holding the public
anon key can forge notifications to any user.

---

## State of the world

The 18 revamp prompts are shipped, audited, and covered by a green E2E suite. The 16-part
Gemini audit pack has been **run in full** (102 findings: 9 P0, 48 P1, 30 P2, 16 P3) and its
**P0 and P1 tiers are both closed** — 48 fixed, 5 phantoms, 4 deliberately not built. See
`prompts/audits/_ORCHESTRATOR-STATE.md` for the per-finding record.

Gate at close: typecheck ✅ · lint **0 errors** ✅ · **550/550** Vitest ✅ · build ✅.

The audit's own `findings/` and `handoff/` output is **deliberately gitignored** — those files
enumerate 93 still-unfixed findings with working repro steps, which is the same document class
as the `*QA-REPORT*` / `*REMEDIATION*` patterns already excluded. The audit *prompts* stay
committed; the evidence does not.

### The E2E sweep is DONE — do not re-litigate it

It ran clean on 2026-08-20 against the **local** Docker Supabase stack at migration `0097`.
Seven harness defects had to be fixed first; they are catalogued in `revamp/_AUDIT-11-18.md` →
"The owed E2E sweep". WebKit is permanently excluded — it cannot reach Clerk's FAPI at all.

---

## What is actually owed

### 1. Three migrations, unapplied in production — start here

`prompts/audits/_RESUME-AFTER-RESTART.md` is the runbook — now covering **`0098`–`0105`**.
It is not optional reading: `0099`, `0100` and `0101` are `CREATE OR REPLACE` bodies
authored from **local** dumps, so they must be
diffed against the **production** `pg_get_functiondef` output before they are applied.
Replacing a drifted body has silently deleted later fixes three times in this repo.

Production DB access is blocked by the auto-mode classifier regardless of the `Bash(psql *)`
allow-rule. `npx supabase migration list --linked` is the one read path that survives it, and
it reports the ledger stopping at **0075** — but that ledger is not evidence, because
`psql -f` never stamps it.

### 2. The P1 tier is CLOSED

All 48 worked in seven groups, merged as PRs #6–#10 and deployed: **41 fixed, 3 phantoms,
4 deliberately not built.** Per-finding verdicts are in
`prompts/audits/_ORCHESTRATOR-STATE.md`.

What remains of the pack is **P2 (30) and P3 (16)** — untouched.

**Reproduce before fixing.** Across P0+P1 the pack produced 3 phantoms and 3 findings whose
stated mechanism was wrong. One of them, `A-08-02`, would have *introduced* the WCAG
failure it claimed to fix if applied as written.

### 3. Nothing else in `prompts/revamp/` is owed

Every prompt `01`–`18` is implemented. What remains there is the registrar/dashboard/counsel
list below.

## Re-running the E2E suite (the recipe, already paid for)

**Run ONE project per invocation** — `--project=chromium` and `--project=firefox` as two
separate commands. Combining them in a single command runs global setup (and therefore
`clearOrphanedFixtureMoney`) only once, so the first project's settled `sponsor-approvals`
ledger rows survive as orphans (`transactions_ledger.submission_id` is `ON DELETE SET NULL`)
and eat into `dev testing`'s $5,000 cap. The second project's `golden-path` step 5 then fails:
approve-and-dispatch is refused and the submission never leaves `pending`. Verified, not
theorised — it happened on 2026-08-21.

Clerk also throttles a repeated sweep: three full runs inside ~50 minutes made
`sponsor-domain-gating`'s `createClerkAccount` time out and cascade into 401s, with per-test
wall clock roughly doubling. Restart the dev server and space runs out rather than chasing it.

1. Start Docker Desktop. If `docker info` hangs with `com.docker.backend` running but no
   `com.docker.virtualization`, that is the stuck-launch signature:
   `pkill -9 -f com.docker && open -a Docker`.
2. `npx supabase start` (the DB container may need a second invocation while it goes healthy).
3. Export **local** Supabase env in the shell *before* starting anything — dotenv does not
   override already-set shell vars, and that is the only thing keeping the suite off
   production. Derive the keys from `npx supabase status -o json`; never write them to a file.
   Also export `SUPABASE_LOCAL=1`, a throwaway `PAYOUT_ENCRYPTION_KEY`, and the nine
   `*+clerk_test@example.com` account emails. No `*_PASSWORD` — sign-in is ticket-based.
4. Start the dev server yourself with that env. `playwright.config.ts` has
   `reuseExistingServer: true`, so a stray production-env server on :3000 is silently reused.
5. **Verify before running:** the `next-server` process must have no external connections, and
   local `xact_commit` must move when you curl the app.
6. `npx playwright test --project=chromium` / `--project=firefox`.

Gotchas already paid for: Clerk e2e sign-in needs a **minted sign-in token** (password sign-in
returns `needs_client_trust`); **WebKit cannot reach Clerk**; axe needs animations settled,
since `opacity: 0` elements are skipped entirely and mid-fade gives phantom contrast failures;
an aborted run leaves the fixture team as `incubator`, which makes the *next* run's
`portfolio-sections` fail on a heading that is correctly absent — re-run rather than chase it.

---

## Not mine — registrar / dashboard / counsel

1. **Publish DMARC** at `_dmarc.exodiusftc.com`. The single failing automated check (17.3).
   Record to paste: `docs/email-deliverability.md` §3.1.
2. **Subscribe the Resend webhook to `email.complained`.** The handler is shipped and tested;
   the event is simply not subscribed.
3. **Set `FIRST_API_USERNAME` / `FIRST_API_TOKEN` in Vercel** once registered at
   ftc-events.firstinspires.org/services/API. No code change needed.
4. **Create the Clerk enterprise connection** when the first sponsor's IT team asks — follow
   `docs/enterprise-sso-runbook.md`. Confirm the Clerk plan gate (Pro/Business) first.
5. **Legal review** of receipt and agreement copy: `RECEIPT_COPY_REVIEWED_AT`,
   `needs_legal_review`, and the governing-law jurisdiction.
6. **mail-tester ≥ 9/10** and Google Postmaster, after DMARC is live.
7. Optional: `npm i -g vercel@latest` (CLI 54.20.1 → 59.3.0).

---

## Rules that must not be relearned the hard way

- **`.env.local` points at PRODUCTION Supabase and PRODUCTION Clerk. There is no staging.**
  Every DB write from this repo is a production write.
- **NEVER run `node scripts/seed-test-accounts.mjs`** — its `wipeUsers()` truncates
  `submissions`, `teams`, `profiles`, `transactions_ledger` and more. It has no prod guard.
- **Never run `supabase db reset` or `db push`.** Apply migrations with `psql -f`
  (psql at `/opt/homebrew/opt/libpq/bin`, `DATABASE_URL` in `.env.local`).
- **Never rebuild a function body from an older migration file.** Dump the **live** body with
  `pg_get_functiondef` and edit that. Three of the worst defects here — `0093`, `0094`, `0096`
  (a P0 tenant takeover) — were `CREATE OR REPLACE` silently deleting later fixes. The same
  class bit the test harness too: two copies of `detect_capacity_drift()`'s arithmetic, both
  drifted from the live body.
- **Deploys are manual.** Pushing to `main` deploys nothing: `vercel deploy --prod --yes`.
- Agents (`action-reviewer`, `rls-auditor`) report false positives. **Re-verify every finding
  independently before acting on it.** Evidence or it didn't happen.
- Latest migration is **`0097`** (applied to production and to the local stack). Confirm with
  `ls supabase/migrations | tail -3`.
- A fixture that inserts a submission must set `reserved_amount_cents: 0` unless it also does
  the capacity bookkeeping. `release_reservation_before_submission_delete` refunds a *live*
  reservation on DELETE, so a non-zero fixture reservation hands the sponsor capacity it never
  spent and shows up as global drift in `appeals` / `recognition-tiers`.
- Never write a token/JWT/credential to a file. Never read the OS keychain.
