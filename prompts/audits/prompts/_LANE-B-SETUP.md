# Lane B setup & teardown — read this before any `B-*` audit

**Only one Lane B audit runs at a time.** There is one Docker Supabase stack, one dev server on
`:3000`, and one Clerk test tenant on this machine, and the Clerk tenant throttles.

## The single rule that keeps this off production

`.env.local` points at **production** Supabase and **production** Clerk. dotenv does **not**
override variables already set in the shell — so exporting local values in the shell *before*
starting anything is the only thing standing between this audit and a production write.

## Startup

1. **Docker.** Start Docker Desktop. If `docker info` hangs with `com.docker.backend` running
   but no `com.docker.virtualization`, that is the stuck-launch signature:
   `pkill -9 -f com.docker && open -a Docker`.
2. **Supabase.** `npx supabase start` (the database container may need a second invocation
   while it goes healthy). Confirm the schema is at the latest migration —
   `ls supabase/migrations | tail -3`.
3. **Export local env in the shell, before anything else starts.** Derive the URL and keys from
   `npx supabase status -o json`. **Never write them to a file, never echo them into a
   finding.** Export at least:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
     — all pointing at the **local** stack
   - `SUPABASE_LOCAL=1`
   - a throwaway `PAYOUT_ENCRYPTION_KEY` and a throwaway `CRON_SECRET`
   - the nine test account emails, all `*+clerk_test@example.com`: `ADMIN_EMAIL`, `COACH_EMAIL`,
     `DENIAL_COACH_EMAIL`, `SPONSOR_EMAIL`, `SPONSOR2_EMAIL`, `SPONSOR_MEMBER_EMAIL`,
     `REVIEWER_EMAIL` (see `playwright.config.ts` and `tests/global-setup.ts` for the full set)
   - **no `*_PASSWORD`** — sign-in is ticket-based; password sign-in against Clerk returns
     `needs_client_trust` and will fail.
4. **Start the dev server yourself in that same shell.** `playwright.config.ts` sets
   `reuseExistingServer: true`, so a stray production-env server already on `:3000` is silently
   reused and everything you do lands in production. Kill anything on `:3000` first.
5. **Verify before you run anything.** Both checks, every time:
   - the `next-server` process has **no external connections** (`lsof -p <pid> -i` shows only
     loopback);
   - local `xact_commit` moves when you curl the app (`SELECT xact_commit FROM pg_stat_database
     WHERE datname = 'postgres';` before and after).
   If either check fails, **stop**. Do not proceed on a hunch.

## Running Playwright

- **One project per invocation.** `npx playwright test --project=chromium` and
  `--project=firefox` as two separate commands. Combining them shares a single global setup, so
  the first project's settled `sponsor-approvals` ledger rows survive as orphans
  (`transactions_ledger.submission_id` is `ON DELETE SET NULL`) and eat the fixture sponsor's
  $5,000 cap; the second project's `golden-path` step 5 then fails, because approve-and-dispatch
  is refused and the submission never leaves `pending`. This is observed behavior, not theory.
- **WebKit is permanently excluded** — it cannot reach Clerk's FAPI at all.
- **Clerk throttles.** Three full sweeps inside ~50 minutes made `createClerkAccount` time out
  and cascade into 401s, with per-test wall clock roughly doubling. Space runs out and restart
  the dev server rather than chasing it.
- **A fixture that inserts a submission must set `reserved_amount_cents: 0`** unless it also
  does the capacity bookkeeping — `release_reservation_before_submission_delete` refunds a live
  reservation on DELETE, so a non-zero fixture reservation hands the sponsor capacity it never
  spent and shows up as global drift.
- **An aborted run** leaves the fixture team as `incubator`, which makes the next run's
  `portfolio-sections` fail on a heading that is correctly absent. Re-run; don't chase it.
- **Never run `node scripts/seed-test-accounts.mjs`.** Its `wipeUsers()` truncates
  `submissions`, `teams`, `profiles`, and `transactions_ledger`, and it has no production guard.

## Teardown — mandatory before the next Lane B audit

1. Stop the dev server and any Playwright process you started.
2. Delete every fixture row your audit created, in child-before-parent order, and confirm the
   fixture sponsor's remaining capacity is back to its starting value (orphaned ledger rows are
   the failure mode — check `transactions_ledger` for rows with a null `submission_id`).
3. Leave the local stack in a state the next audit can start from, and say in your findings
   exactly what you left behind.
