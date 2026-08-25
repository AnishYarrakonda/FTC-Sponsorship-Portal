# Next session

**Written 2026-08-25.** This file is the live handoff. Read it before anything else.

---

## Where the project stands

**The application is finished.** No feature work is outstanding. 591 unit tests pass,
typecheck and lint are clean, the build is green, `verify-backlog` is **41 pass / 1 fail /
0 skip** (the one failure is DMARC, which needs a DNS record nobody can add from here), and the
current code is deployed and smoke-tested in production.

**The product is a matchmaker.** Coach pitches → admin moderates → sponsor accepts, in full or
for a smaller amount → both sides get each other's contact details → everything after that
happens off-platform. The platform never touches money and tracks nothing after acceptance.

Migration `0111_strip_post_match_pipeline.sql` removed the e-signature layer, the payment state
machine, W-9/payout profiles, tax receipts and recognition tiers — 11 tables, 24 functions,
6 enum types, 2 storage buckets, ~100 files. **This reversed two decisions previously recorded
as locked** ("e-sign is in-house", "pledge-and-track"). `CLAUDE.md` records the reversal.
`prompts/revamp/05-*` and `06-*` describe removed layers and are history, not a spec.

**Everything that remains is money, accounts, DNS and dashboards.** It is enumerated in
**`docs/LAUNCH-CHECKLIST.md`**, which is the authoritative list. Two supporting docs:
`docs/GO-LIVE-CUTOVER.md` (the ordered DNS/Clerk sequence) and `docs/PURCHASE-CHECKLIST.md`
(the version to hand a team captain).

---

## Start here — check state before doing anything

The right work depends entirely on what the user has done manually since 2026-08-25. **Do not
assume.** Run these first:

```bash
git log --oneline -1 && git branch --show-current
git fetch origin --quiet   # ALWAYS fetch first; the count below reads a local cache
git rev-list --count origin/main..HEAD                     # 0 = main is in sync and deployable
dig +short pitfund.exodiusftc.com CNAME                    # empty = DNS not done
dig +short _dmarc.exodiusftc.com  TXT                      # empty = DMARC not done
curl -s https://ftc-sponsorship-portal.vercel.app/login | grep -o 'pk_test_[A-Za-z0-9]*\|pk_live_[A-Za-z0-9]*'
node scripts/verify-backlog.mjs 2>&1 | tail -3
```

Then branch on what you find:

| Finding | Do this |
|---|---|
| `git rev-list --count origin/main..HEAD` is **non-zero** | Work has diverged since 2026-08-25. Fetch first, then see §0 — `main` must stay at or ahead of `0111` to be deployable |
| `pitfund` CNAME is empty | The user has not done §3. Nothing downstream can proceed; say so plainly rather than working around it |
| Still serving `pk_test_` | Clerk production (§4) has not happened. It is the last real launch blocker |
| `pk_live_` is being served | Cutover happened — run §8 verification and help debug whatever broke |
| `verify-backlog` shows a **new** failure | Something regressed. Investigate that before anything else |

---

## The formerly-urgent thing — now closed

On 2026-08-25 everything existed only on Anish's laptop, and `main` was pre-`0111` (it queried
eleven dropped tables, so deploying it would have broken the site instantly). **Both are fixed.**
`main` and `feat/strip-post-match-pipeline` point at the same commit, and it is what production
runs. `main` is safe to deploy again.

If the probe above returns non-zero, something has diverged since — **`git fetch` first**, then
re-check, then read §0 of `docs/LAUNCH-CHECKLIST.md`. **Ask before pushing** — the user's
standing instruction is to commit and push only when asked.

---

## Things that will bite you

These are all learned the hard way in this repo. Violating any one of them has caused a real
incident.

- **Never judge a Postgres function by the migration that created it.** Dump the live body with
  `pg_get_functiondef` first — including when deciding whether a change affects it at all.
  Reading `0084` alone said `detect_capacity_drift()` was unaffected by `0111`; the live body
  had a third term added by `0095` that would have thrown on every call, **silently disabling
  the Capacity Integrity check.** Separately, the live `sponsor_decide_submission_atomic`
  carries an `is_trusted_server_context()` branch from `0101` (a P0 tenant-takeover fix) that is
  absent from `0100` — rebuilding from the file would delete it.
- **`DROP FUNCTION IF EXISTS` matches on the argument list.** Wrong arity is a silent no-op.
  Find functions via `pg_proc`, never by name pattern — a name sweep missed
  `record_benefit_delivery` and `void_benefit_proof`.
- **`CREATE OR REPLACE` does not preserve REVOKE/GRANT.** Re-issue them every time.
- **Apply migrations with `psql -f`, never the Supabase CLI** — its splitter mishandles files
  defining multiple `$$`-quoted functions.
- **`dig` takes one record type per query.** `dig name TXT CNAME A` treats the extra types as
  hostnames and returns misleading results. This produced a wrong conclusion in this project on
  2026-08-25 (I claimed email was broken; it was fine).
- **A preview returning 200 is not proof it renders** — error boundaries return 200. Check the
  browser console.
- **`DATABASE_URL` in `.env.local` points at PRODUCTION.** Verify before running anything that
  writes. `scripts/seed-test-accounts.mjs` has **no production guard** and deletes rows.
- **A check that always skips is worse than no check.** Eight E2E suites sat green-by-skipping
  here for months. Gate on what the suite needs, and never trust a skip's stated reason.
- **Vercel Hobby runs only 2 cron entries** and silently ignores extras. New jobs go inside the
  `daily-maintenance` dispatcher, not `vercel.json`.
- **Deploys are manual.** Pushing to `main` deploys nothing. `vercel deploy --prod --yes`.

---

## What NOT to do

- **Do not strip more features.** `appeals.ts` (789 lines), `messages.ts`, and sponsor
  organisations were all built against zero traffic and are obvious deletion candidates.
  Leave them. Tested code nobody visits costs approximately nothing; another destructive
  migration has real risk, and `0111` nearly disabled the capacity check. The reasoning is
  recorded in §10 of the launch checklist.
- **Do not change the stack.** Vercel + Supabase + Clerk + Resend is correct for this scale and
  for handing the project to a non-programmer. Free tiers have 60–100× headroom at the target
  of dozens of teams. This was analysed in full; do not relitigate.
- **Do not reintroduce** MFA, rate limiting / Upstash, e-signatures, payment tracking, W-9s,
  receipts, or recognition tiers. All were deliberately removed.
- **Do not run another audit pass.** All 102 findings from the 16-prompt Gemini pack are closed
  and shipped. `prompts/audits/` is history, not a queue, and there is no Gemini subagent here.
  The app has been audited far more than it has been used.
- **Do not delete from `transactions_ledger`.** It is append-only; a reversal is a compensating
  negative row via `void_match_atomic`. The single exception is the pre-launch fixture wipe in
  §6, which is explicitly scoped.

---

## If the user asks "what's left?"

Answer from `docs/LAUNCH-CHECKLIST.md`, and lead with these three:

1. **Clerk production instance** (§4) — the last true launch blocker. Dev accounts cannot be
   migrated, so it must precede the first real signup. Zero users today means zero cost; that
   only goes up.
2. **Ownership** (§1) — every account is in Anish's personal name, and he leaves for college.
3. **DNS at GoDaddy** (§3) — the `pitfund` CNAME and the two DMARC records. Nothing downstream
   of the domain can be verified until these exist.

§0 is closed: the code is pushed and `main` is deployable.

**It costs $0.** The team already owns `exodiusftc.com` (GoDaddy DNS, team website on Netlify at
the apex), and Resend is already verified on it. What is needed is the GoDaddy login, not a
credit card. **Never move that domain's nameservers** — it would take the team website down.
