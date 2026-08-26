# Next session

**Rewritten 2026-08-26.** This file is the live handoff. Read it before anything else.

---

## Where the project stands

**The application is finished.** No feature work is outstanding. Verified 2026-08-26:
typecheck **0 errors**, **591/591** unit tests passing, lint **0 errors** (194 `any` warnings),
production build green, `knip` reporting **no dead files and no unused dependencies**, every
production deployment `Ready`, live health `{"ok":true,"service":"up","db":"ok"}`.

**The product is a matchmaker.** Coach pitches → admin moderates → sponsor accepts, in full or
for a smaller amount → both sides get each other's contact details → everything after that
happens off-platform. The platform never touches money and tracks nothing after acceptance.

Migration `0111_strip_post_match_pipeline.sql` removed the e-signature layer, the payment state
machine, W-9/payout profiles, tax receipts and recognition tiers. **This reversed two decisions
previously recorded as locked** ("e-sign is in-house", "pledge-and-track"). `prompts/revamp/05-*`
and `06-*` describe removed layers and are history, not a spec.

**Everything remaining is accounts, DNS and dashboards**, in **`docs/LAUNCH-CHECKLIST.md`** —
the SINGLE launch doc. `GO-LIVE-CUTOVER.md` and `PURCHASE-CHECKLIST.md` were folded into it and
deleted on 2026-08-26, because three documents that could disagree with each other was itself
the problem. It is structured Part A (test now) / Part B (purchase day) / Part C (ongoing) — not
numbered sections; older references to "§3" or "§6" are stale.

---

## The domain question — read this before saying anything about DNS

**The app gets its OWN domain.** `pitfund.org` was the pick ($8.49/yr, `pitfund.com` is taken).

**`exodiusftc.com` is the team's WEBSITE and is NOT the app's domain.** A previous session
inferred the opposite from `RESEND_FROM_EMAIL=noreply@exodiusftc.com` and built an entire launch
plan on it — subdomain, DNS records, a "$0 launch". All of it was wrong and had to be undone.
**A config value shows what the app is wired to, not what the team intends.** Ask.

**Vercel Pro is required by Vercel's terms**, not by capacity: their fair-use policy restricts
Hobby to "non-commercial personal use" and explicitly lists **"Asking for Donations"** as
commercial. $20/mo flat, one deploying seat, **free unlimited viewer seats**.

Staying on **Supabase Free** and **Clerk Free** and **Resend Free** — deliberate, cost-driven,
with the limits documented in Part C.

---

## Start here — check state before doing anything

The right work depends entirely on what Anish has done manually since 2026-08-26. **Do not
assume.**

```bash
git log --oneline -1 && git branch --show-current
git fetch origin --quiet   # ALWAYS fetch first; the count below reads a local cache
git rev-list --count origin/main..HEAD    # 0 = main is in sync and deployable
curl -s https://ftc-sponsorship-portal.vercel.app/api/health
curl -s https://ftc-sponsorship-portal.vercel.app/login | grep -o 'pk_test_[A-Za-z0-9]*\|pk_live_[A-Za-z0-9]*'
npm run verify:all
```

Once a domain exists, substitute it here (one record type per `dig` query — see the traps below):

```bash
dig +short <the-app-domain> CNAME
dig +short _dmarc.<the-app-domain> TXT
```

| Finding | Do this |
|---|---|
| `git rev-list` is **non-zero** | Work diverged. Fetch first, then reconcile — `main` must stay at or ahead of `0111` to be deployable |
| Still serving `pk_test_` | The Clerk production instance does not exist yet. It is the last real launch blocker, and it cannot be created before the domain is bought |
| `pk_live_` is being served | Cutover happened. Run Part B7 verification and help debug whatever broke |
| `verify:all` shows a **new** failure | Something regressed. Investigate that before anything else |
| DB checks all SKIP | Almost certainly a network blocking outbound **port 5432**, not an outage. The skip message says so |

---

## Testing accounts exist and deliver real email

Nine seeded accounts, all aliases of **anish.yarrakonda456@gmail.com**, listed with passwords in
Part A1 of the launch checklist. Four of them are the **same sponsor company** at different
permission ranks (`org_admin` / `approver` / `submitter` / `viewer`) — that is the sponsor
multi-user feature, and it is testable.

Re-seed with:

```bash
I_UNDERSTAND_THIS_IS_PRODUCTION=1 \
TEST_EMAIL_BASE=anish.yarrakonda456@gmail.com \
node scripts/seed-test-accounts.mjs
```

Without `TEST_EMAIL_BASE` it reverts to `+clerk_test@example.com` addresses, which is what the
automated tests need — **but `example.com` is RFC-2606 reserved and receives no mail**, so no
email flow can be observed in that mode. That gap is why manual QA was impossible until now.

---

## Things that will bite you

Every one of these has caused a real incident here.

- **Never judge a Postgres function by the migration that created it.** Dump the live body with
  `pg_get_functiondef` first. Reading `0084` alone said `detect_capacity_drift()` was unaffected
  by `0111`; the live body had a third term from `0095` that would have thrown on every call,
  **silently disabling the Capacity Integrity check.** The live
  `sponsor_decide_submission_atomic` likewise carries an `is_trusted_server_context()` branch
  from `0101` (a P0 tenant-takeover fix) absent from `0100`.
- **`DROP FUNCTION IF EXISTS` matches on the argument list.** Wrong arity is a silent no-op.
  Find functions via `pg_proc`, never by name pattern.
- **`CREATE OR REPLACE` does not preserve REVOKE/GRANT.** Re-issue them every time.
- **Apply migrations with `psql -f`, never the Supabase CLI** — its splitter mishandles files
  defining multiple `$$`-quoted functions.
- **`dig` takes one record type per query.** `dig name TXT CNAME A` treats the extras as
  hostnames and returns misleading results. On 2026-08-25 this produced a confident, wrong
  claim that production email was broken. It was fine.
- **A 200 is not proof a page rendered** — error boundaries return 200. Check the browser console.
- **`git add -A` silently skips ignored paths and still exits 0.** `/docs/*` is ignored with an
  `!` allowlist; four handoff docs sat untracked across two sessions while three commit messages
  claimed to have shipped them. After committing a NEW file, run `git ls-files <path>` to prove
  it landed.
- **`git rev-list --count origin/main..HEAD` reads a local cache, not GitHub.** Straight after a
  push it reported a 23-commit gap that did not exist. **`git fetch` first, every time.**
- **`DATABASE_URL` in `.env.local` points at PRODUCTION.** The seeder now refuses a hosted target
  without `I_UNDERSTAND_THIS_IS_PRODUCTION=1` and prints the rows it will delete — but the
  variable still points at production, so think before setting it.
- **A check that always skips is worse than no check.** Eight E2E suites sat green-by-skipping
  for months. Gate on what the suite needs, and never trust a skip's stated reason.
- **Vercel Hobby runs only 2 cron entries** and silently ignores extras. New jobs go inside the
  `daily-maintenance` dispatcher, not `vercel.json`. **This cap lifts on Pro** — once Pro is
  bought, splitting them back out is safe.
- **Deploys are manual.** Pushing to `main` deploys nothing. `vercel deploy --prod --yes`.

---

## What NOT to do

- **Do not strip more features.** `appeals.ts` (789 lines), messaging, and sponsor organisations
  were built against zero traffic and look like deletion candidates. Leave them. Tested code
  nobody visits costs ~nothing; another destructive migration has real risk, and `0111` nearly
  disabled the capacity check. Anish confirmed this scope on 2026-08-26: **provably-dead code
  only**, which has now been done — knip reports zero unused files and zero unused dependencies.
- **Do not change the stack.** Vercel + Supabase + Clerk + Resend is right for this scale and for
  handing to a non-programmer. Analysed in full; do not relitigate.
- **Do not reintroduce** MFA, rate limiting / Upstash, e-signatures, payment tracking, W-9s,
  receipts, or recognition tiers. All deliberately removed.
- **Do not run another audit pass.** All 102 findings from the 16-prompt Gemini pack are closed.
  `prompts/audits/` is history, not a queue, and there is no Gemini subagent here. **The app has
  been audited far more than it has been used** — the remaining value is in Anish walking the
  flows by hand, not in another sweep. Run `npm run verify:all` instead.
- **Do not delete from `transactions_ledger`.** Append-only; a reversal is a compensating
  negative row via `void_match_atomic`. The single exception is the pre-launch fixture wipe in
  Part B6, which is explicitly scoped.
- **Do not refactor the landing page to be static.** It would cut a one-time ~2.3s cold start,
  but requires moving auth redirects into middleware — the most breakage-prone area here.
  UptimeRobot solves it for free. Warm TTFB is already 0.09–0.29s across every route.

---

## If Anish asks "what's left?"

Answer from `docs/LAUNCH-CHECKLIST.md`:

1. **Part A** — walk the 13 test flows. Free, needs no card, and is the highest-value
   verification left.
2. **Part B** — buy Vercel Pro ($20/mo) and the domain (~$9), then the Clerk production
   instance. Clerk is dashboard-only with no API, and **dev-instance users cannot be migrated**,
   so it must precede the first real signup.
3. **Part C** — UptimeRobot, FIRST API credentials, the Resend complaint webhook.

The meeting where the card appears is ~2 weeks out from 2026-08-26.
