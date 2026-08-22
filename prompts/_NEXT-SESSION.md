# Next session — start here

**Written:** 2026-08-21, at the end of the session that deployed and closed the `qa-thread` gap.
**Branch:** `main`. Working tree clean, **pushed to `origin/main`**.
**Production is current** — deployed 2026-08-21 (`dpl_5Rkqdx7GgLMD9nDavPHhn8XgbjfQ`), aliased
to `ftc-sponsorship-portal.vercel.app`. `verify-backlog` against it: **65 pass / 1 fail**, the
one failure being DMARC (registrar-side, item 1 below).

---

## State of the world

All 18 prompts in this folder are **shipped, audited, and now covered by a green E2E suite.**
Both audit sweeps (`_AUDIT-01-10.md`, `_AUDIT-11-18.md`) are closed except three rows:

| Row | Why it is still open |
|---|---|
| `F-02` approver rejection doesn't decline the submission | **By design.** An internal org decision is not a submission decline; capacity releases at the 14-day expiry. Only reopen if the product decision changes. |
| `F-11` `as never` casts on `.update()` | Documented Supabase-types workaround (`team.ts:153`). Cosmetic. |
| `F-15` FIRST API credentials | Yours — see the checklist below. Running correctly on the FTCScout fallback. |

Gate at close: typecheck ✅ · lint **0 errors / 340 warnings** ✅ · **419/419** Vitest ✅ ·
build ✅ · **E2E 174 passed / 0 failed / 2 skipped** (chromium, 176 total, 5.7m).

CI at `.github/workflows/ci.yml` runs the same four-command gate on every push and PR with
inert placeholder env. It deliberately does **not** run the E2E job — that needs Docker.

### The E2E sweep is DONE — do not re-litigate it

It ran clean on 2026-08-20 against the **local** Docker Supabase stack at migration `0097`.
Seven harness defects had to be fixed first; they are catalogued in `_AUDIT-11-18.md` →
"The owed E2E sweep". WebKit is permanently excluded — it cannot reach Clerk's FAPI at all.

---

## What is actually left

### 1. Nothing is owed in code

Both former items are closed. Production is deployed and verified, and the `qa-thread`
coverage gap is shut: `tests/e2e/qa-thread.spec.ts` now seeds its own world in `beforeAll`
and tears it down in `afterAll`, so `0085`'s database enforcement actually executes.
The remaining **2** skips are legitimate: one dialog-focus a11y test, one reviewer
funding-cap test.

### 2. Nothing else in `prompts/` is owed

Every prompt `01`–`18` is implemented. What remains is not engineering — it is the
registrar/dashboard/counsel list below.

---

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
