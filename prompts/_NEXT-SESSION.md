# Next session — start here

**Written:** 2026-08-20, at the end of the session that closed the 11–18 sweep.
**Branch:** `feat/agreement-templates`, fast-forwarded into `main`. Working tree clean.
**Deployed:** yes — `dpl_E3x5obYDAqsCtGRNUVC4KyqCnPYV`, production, `/api/health` 200.

---

## State of the world

All 18 prompts in this folder are **shipped, deployed and audited**. Both audit sweeps
(`_AUDIT-01-10.md`, `_AUDIT-11-18.md`) are closed except three rows that are deliberate or
outside the repo:

| Row | Why it is still open |
|---|---|
| `F-02` approver rejection doesn't decline the submission | **By design.** An internal org decision is not a submission decline; capacity releases at the 14-day expiry. Only reopen if the product decision changes. |
| `F-11` `as never` casts on `.update()` | Documented Supabase-types workaround (`team.ts:153`). Cosmetic. |
| `F-15` FIRST API credentials | Yours — see the checklist below. Running correctly on the FTCScout fallback. |

Gate at close: typecheck ✅ · lint **0 errors / 340 warnings** ✅ · **419/419** Vitest ✅ ·
build ✅ · `verify-backlog.mjs` against production **65 pass / 1 fail** (the one failure is
DMARC, registrar-side).

CI now exists at `.github/workflows/ci.yml` and runs the same four-command gate on every push
and PR with inert placeholder env. It deliberately does **not** run the E2E job.

---

## The one piece of engineering work still owed

### The `SUPABASE_LOCAL` E2E sweep has never run since prompt 11

22 spec files are gated behind `SUPABASE_LOCAL` and have not executed since prompt 11 landed.
They are the only coverage for the authenticated journeys.

**It is blocked on disk, not on code.** `/System/Volumes/Data` has **3.0 GiB free of 460 GiB
(100 %)**. That is the exact condition that corrupted the previous attempt. The local Supabase
stack needs Docker plus image pulls; starting it at this level will fail or corrupt.

Measured, nothing deleted (deletion was blocked by the permission classifier, and by the
standing "delete nothing without my say-so" rule):

| Path | Size | Safe to clear? |
|---|---|---|
| `~/.npm/_cacache` | **9.2 G** | Yes — fully regenerable (`npm cache clean --force`) |
| `~/Library/Developer/CoreSimulator` | **15 G** | Mostly — old/unavailable simulators (`xcrun simctl delete unavailable`) |
| `~/Library/Caches` | 15 G | Mostly, app-by-app |
| `~/Library/Developer/Xcode/DerivedData` | 901 M | Yes — fully regenerable |
| `~/.cache` | 2.1 G | Yes |
| `~/Library/Containers/com.docker.docker/Data` | 27 G | `docker system prune -a` (Docker must be **running** first) |
| `~/Library/Application Support` | 52 G | **No** — do not touch blind |

Target ≥ 40 GiB free before starting. Then:

1. Start Docker Desktop, `supabase start`, apply migrations with **`psql -f`** (never
   `db reset`/`db push` — the CLI splitter mangles `$$`-quoted bodies).
2. `SUPABASE_LOCAL=1 npx playwright test`.
3. Three gotchas already paid for: Clerk e2e sign-in needs a **minted sign-in token**
   (password sign-in returns `needs_client_trust`); **WebKit cannot reach Clerk at all** — skip
   that project; axe needs animations settled, since `opacity: 0` elements are skipped entirely
   and mid-fade gives phantom contrast failures.

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
  (a P0 tenant takeover) — were `CREATE OR REPLACE` silently deleting later fixes.
- **Deploys are manual.** Pushing to `main` deploys nothing: `vercel deploy --prod --yes`.
- Agents (`action-reviewer`, `rls-auditor`) report false positives. **Re-verify every finding
  independently before acting on it.** Evidence or it didn't happen.
- Latest migration is **`0097`** (applied). Confirm with `ls supabase/migrations | tail -3`.
