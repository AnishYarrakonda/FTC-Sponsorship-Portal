# Launch checklist — everything left before this is a real, running product

**Status as of 2026-08-25.** The application itself is finished: 591 unit tests pass,
typecheck and lint are clean, the build is green, `verify-backlog` is 41 pass / 1 fail / 0 skip,
and the current code is deployed and smoke-tested in production. **No feature work remains.**

Everything below is money, accounts, DNS, and dashboards. It is ordered so that nothing blocks
on something later in the list.

**Total cost: $0.** There is nothing to buy. See §2.

| Section | What | Who | Time |
|---|---|---|---|
| §0 | ~~Push the code~~ ✅ done — **but `main` still needs the fast-forward** | Anish | 1 min |
| §1 | Team identity, vault, ownership | captain + mentor | 30 min |
| §2 | Purchases | nobody — $0 | — |
| §3 | DNS records at GoDaddy | GoDaddy holder | 10 min + wait |
| §4 | Clerk production instance | Anish | 15 min + wait |
| §5 | Vercel environment + redeploy | Anish | 5 min |
| §6 | Clear production test data | Anish | 5 min |
| §7 | Optional services | Anish | 20 min |
| §8 | Verification | Anish | 30 min |
| §9 | Ongoing ownership | mentor | forever |
| §10 | Deliberately deferred | — | — |

---

## §0 — The code exists in more than one place — ✅ PUSHED 2026-08-25

Everything was on one laptop and nothing had been pushed. **Both pushes are now done**:
`main` and `feat/strip-post-match-pipeline` are on GitHub. If the laptop is lost, the product
survives. Re-check the current gap at any time with:

```bash
git rev-list --count origin/main..HEAD    # 0 once the merge below is done
```

### ⚠️ Still outstanding: `main` is not yet the code that runs

`main` on GitHub is **pre-migration-`0111`** — it queries eleven tables that no longer exist in
the production database. **Deploying `main` today breaks the site immediately.** Deploys are
manual, so `git checkout main && vercel deploy --prod` remains an easy and fatal mistake. The
only branch compatible with the live database is `feat/strip-post-match-pipeline`.

Fix it by fast-forwarding `main` onto the branch (verified as a clean fast-forward — no merge
commit, no conflicts):

```bash
git checkout main
git merge --ff-only feat/strip-post-match-pipeline
git push exodius main
git checkout feat/strip-post-match-pipeline
```

**Verify** `main` now contains the strip:

```bash
git show main:supabase/migrations/0111_strip_post_match_pipeline.sql | head -3
```

Until that is done, treat `main` as unsafe to deploy.

Good news: the repo is under the **ExodiusFTC organisation**, not a personal account, so
ownership already survives Anish leaving. That is one succession problem you do not have.

---

## §1 — Team identity and ownership (the part that actually decides survival)

Every service is currently registered to **Anish personally**. When he leaves for college the
project dies with his access. That is the default outcome unless it is changed.

Do this **before** creating anything new, because redoing it later is much harder:

1. **A team email address** — `tech@exodiusftc.com` or a dedicated Gmail. Nobody's personal
   login. The domain already exists, so a mailbox on it is straightforward.
2. **A password vault** — Bitwarden is free. Every credential and every recovery code goes in.
3. **Access for two current students plus one adult mentor.** The mentor is the load-bearing
   part: students turn over every year, the mentor is the only continuity the team has.
4. **Re-register or add the team identity as a second owner on every service in §9.** Any
   service with exactly one owner is a countdown timer.
5. **Find out who controls the GoDaddy account**, since §3 cannot happen without it. Check the
   domain's renewal date and that the card on file is valid.

---

## §2 — What to buy: nothing

| Thought | Reality |
|---|---|
| Buy a domain (~$12/yr) | **The team already owns `exodiusftc.com`.** The app goes at `pitfund.exodiusftc.com` — a subdomain, free |
| Verify an email sending domain | **Already done.** SPF, DKIM and SES feedback MX are live and production email works today |
| Vercel Pro | Not needed. Hobby covers this scale — see §10 |
| Supabase Pro | Not yet — see §10 |
| Payment processing | Never. The platform does not touch money by design |
| E-signature | Never. Removed in `0111` |

**What you need instead of a credit card is the GoDaddy login.**

---

## §3 — DNS at GoDaddy

⚠️ **Do not let GoDaddy or Vercel move the domain's nameservers.** Vercel's own CLI suggests
it. The team's public website runs on Netlify from the same DNS zone — moving nameservers takes
the team site offline until every record is rebuilt. **Add individual records only.**

GoDaddy → My Products → exodiusftc.com → DNS → Manage Zones. Add three records:

| Type | Name / Host | Value | TTL |
|---|---|---|---|
| `CNAME` | `pitfund` | `d0b957cc64a8c9ba.vercel-dns-017.com.` | 1 hour |
| `TXT` | `_dmarc` | `v=DMARC1; p=none; rua=mailto:exodiusftc@gmail.com; fo=1; adkim=r; aspf=r` | **600** |
| `TXT` | `_dmarc.send` | `v=DMARC1; p=none; rua=mailto:exodiusftc@gmail.com; fo=1; adkim=r; aspf=r` | **600** |

**Both DMARC records are required** — a policy on `send.` does not protect the parent apex, and
an apex with no DMARC is a spoofing target regardless. `p=none` means monitor-only, which is
deliberate: a misconfiguration must not silently bin real mail. Keep TTL at 600 during the ramp
so rollback is fast. The staged ramp to `p=quarantine` then `p=reject` is in
`docs/email-deliverability.md` §3 and §11.

Verify — **one record type per `dig` query**, or it silently returns misleading results:

```bash
dig +short pitfund.exodiusftc.com      CNAME
dig +short _dmarc.exodiusftc.com       TXT
dig +short _dmarc.send.exodiusftc.com  TXT
curl -sI https://pitfund.exodiusftc.com | head -1   # expect HTTP/2 200
curl -sI https://exodiusftc.com        | head -1   # team site must still be alive
```

---

## §4 — Clerk production instance

**This must happen before the first real coach signs up.** Development-mode accounts
**cannot be migrated** to production — everyone who signs up beforehand has to sign up again.
Right now that number is zero, so the cost is zero. It only goes up.

Clerk creates production instances **through the dashboard only**; there is no API, so this
step can never be automated.

1. Clerk dashboard → instance dropdown (top-left, says "Development") → **Create production
   instance** → **Clone settings from development**.
2. Application domain: **`pitfund.exodiusftc.com`**.
3. Clerk's **Domains** page lists ~5 DNS records — hosts like `clerk`, `accounts`, `clkmail`,
   `clk._domainkey`, `clk2._domainkey`. **Values are unique to your instance — copy them from
   the dashboard.** Add each at GoDaddy.
4. Wait for **verified**. Usually under an hour; Clerk warns up to 48.
5. **Re-set the password policy — it does not clone.** 12+ chars, upper, lower, number. The
   app's Zod schemas deliberately do not validate passwords; Clerk owns that rule, so skipping
   this silently downgrades to Clerk's weaker default.
6. **Register the new instance with Supabase** → Supabase dashboard → Authentication →
   Third-party auth → add the **production** Clerk instance.
   **This is the step that goes wrong.** Skip it and every page loads but renders empty,
   because RLS rejects every row. It looks exactly like a data bug and is a config bug.
7. **Create the webhook** → endpoint `https://pitfund.exodiusftc.com/api/webhooks/clerk`,
   events **`user.deleted`** and **`user.updated`**. Copy the new `whsec_…` for §5.

---

## §5 — Vercel environment and redeploy

Four variables. All four, or the app half-switches and breaks.

| Variable | New value |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_live_…` |
| `CLERK_SECRET_KEY` | `sk_live_…` |
| `CLERK_WEBHOOK_SIGNING_SECRET` | `whsec_…` from §4.7 |
| `NEXT_PUBLIC_APP_URL` | `https://pitfund.exodiusftc.com` |

```bash
for v in NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY CLERK_SECRET_KEY \
         CLERK_WEBHOOK_SIGNING_SECRET NEXT_PUBLIC_APP_URL; do
  vercel env rm "$v" production --yes && vercel env add "$v" production
done
vercel deploy --prod --yes
```

`NEXT_PUBLIC_APP_URL` is load-bearing: **every link in every outgoing email is built from it.**
Env changes do not take effect until you redeploy, and there is no Git integration — pushing to
`main` deploys nothing.

---

## §6 — Clear the production test data

Production currently holds **only test data**: one `admin+clerk_test@example.com` profile linked
to a *development* Clerk id that will be meaningless after §4, three "dev testing" sponsors, and
one orphaned `transactions_ledger` row for **$2,000** with `submission_id = NULL` that
`void_match_atomic` cannot reverse (a void needs a submission to point at).

**Supabase Free has no automatic backups. Dump first.**

```bash
/opt/homebrew/opt/libpq/bin/pg_dump "$DATABASE_URL" > ~/pitfund-preLaunch-$(date +%F).sql
```

> **If `psql`/`pg_dump` hangs with `timeout expired`, you are probably on a network that blocks
> outbound port 5432.** This is common on school, corporate and some home ISP networks, and it
> happened on this project on 2026-08-25. Confirm it in one command — if 443 succeeds and 5432
> times out against the *same host*, it is the network, not Supabase:
>
> ```bash
> curl -sS --connect-timeout 8 telnet://aws-1-us-east-1.pooler.supabase.com:5432 ; echo "5432 exit=$?"
> curl -sS --connect-timeout 8 https://aws-1-us-east-1.pooler.supabase.com >/dev/null ; echo "443 exit=$?"
> ```
>
> Exit `28` means timeout. **Workaround: use the Supabase dashboard's SQL editor**, which runs
> over HTTPS and is unaffected. Everything in this section works there — but the dashboard
> cannot `pg_dump`, so take the backup from a different network (phone hotspot works) before
> running the deletes.

```sql
BEGIN;
DELETE FROM transactions_ledger;
UPDATE sponsors SET funding_used_cents = 0;
DELETE FROM sponsors WHERE company_name ILIKE 'dev testing%';
DELETE FROM notifications;
DELETE FROM profiles WHERE email LIKE '%clerk_test@example.com';
SELECT count(*) AS drift_rows FROM detect_capacity_drift();  -- must be 0
COMMIT;
```

`transactions_ledger` is append-only **by design** — a reversal is a compensating negative row,
never a delete. This is the one legitimate exception: clearing fixtures before launch, not
reversing a business record. After this, the rule is absolute.

Then create the real admin — sign up normally at `/signup`, then:

```sql
UPDATE profiles SET role = 'admin' WHERE email = 'you@exodiusftc.com';
```

---

## §7 — Services that are not blocking but should be done

| # | What | Why | Effort |
|---|---|---|---|
| 1 | **FIRST API credentials** — register at `frc-events.firstinspires.org`, set `FIRST_API_USERNAME` + `FIRST_API_TOKEN` in Vercel | Neither is set today, so coach verification runs entirely on the **FTCScout fallback**. Both are optional in `lib/env.ts`, so nothing errors — it just quietly uses the less authoritative source | 15 min |
| 2 | **Resend webhook → `email.complained`** | The handling code is already written and **inert** until Resend actually sends the event. Until then a spam complaint is invisible | 5 min |
| 3 | **UptimeRobot** on `https://pitfund.exodiusftc.com/api/health` | Free. Tells you the site is down before a sponsor does, and the 5-minute ping keeps the app warm | 5 min |
| 4 | **Watch Sentry** | Already wired. Someone has to actually look at it | ongoing |

---

## §8 — Verification before announcing it to anyone

```bash
npm run typecheck && npm run lint && npm test && npm run build
node scripts/verify-backlog.mjs     # 17.3 (DMARC) should now pass → 42/42
curl -s https://pitfund.exodiusftc.com/api/health
```

Then by hand, on the real domain:

1. Coach: sign up → verify email → build a team → submit a pitch.
2. Admin: approve → dispatch. **Confirm the sponsor email arrives and its links point at
   `pitfund.exodiusftc.com`**, not `vercel.app`.
3. Sponsor: accept in full. On a second pitch, **counter-offer a smaller amount**.
4. Confirm both sides get the handshake email with each other's contact details.
5. Admin: void a match at `/admin/capacity`; confirm the sponsor's capacity returns.
6. `/admin/capacity` → drift is zero.
7. Check the login page is served from **`accounts.pitfund.exodiusftc.com`**, not
   `desired-guppy-89.clerk.accounts.dev`. That is the proof §4 took effect.
8. Click every sidebar item in all three portals for dead links.
9. `mail-tester.com` — send one real message from production. **9/10 is the pass bar**; any
   point lost to SPF, DKIM, DMARC or reverse DNS is a hard fail regardless of total.

---

## §9 — Ongoing, forever

**Monthly (5 minutes):** check Sentry for new errors · check `/admin/capacity` shows zero drift
· confirm the domain is not drifting toward expiry.

**Yearly:** bump `CURRENT_SEASON` in `lib/site-config.ts` · confirm the domain auto-renewed ·
confirm the named adult owner is still involved with the team.

**Never disable the 02:00 cron.** `/api/cron/expire-submissions` releases sponsor capacity *and*
is the **Supabase keepalive** — Supabase pauses free projects after 7 days without database
traffic. If it stops, the entire site goes down a week later, silently. Vercel Hobby runs only
**2** scheduled jobs and ignores extras without warning, which is how three jobs sat dead in
production for months. **A new cron job goes inside `daily-maintenance`, not into
`vercel.json`.**

**If nobody on the team can code, do nothing — that is a legitimate strategy.** A correctly
configured app that nobody touches runs for years. **Do not accept automated dependency-update
pull requests** if nobody can evaluate them; merging one can break the build.

---

## §10 — Deliberately deferred, with the reasoning

| Item | Decision | Revisit when |
|---|---|---|
| **Supabase Pro ($25/mo)** — Free has **no automatic backups**, and we store sponsor funding commitments and an audit log | **Start free.** A weekly `pg_dump` to a private repo is a free substitute | The first real sponsorship goes through and losing the data would be a genuine incident. **This is the first thing worth paying for — ahead of Vercel Pro** |
| **Vercel Pro ($20 per member/mo)** — Hobby is nominally non-commercial, and this moves money while earning none | **Stay on Hobby.** Two owners is $40/mo = $480/yr, forty times everything else combined | Vercel objects, or the team gets a real budget |
| **Resend paid ($20/mo)** — free is 3,000/month but **100/day** | Free | A dispatch day approaches 100 emails. **This is the first hard technical ceiling in the stack** |
| **Terms §12 governing law** — still says jurisdiction "not yet fixed" | Ship as-is. It is honest, blocks no code, and is a fill-in-the-blank once the team knows its legal entity | The team formalises an entity |
| **Removing unused features** — `appeals.ts` (789 lines), `messages.ts`, sponsor orgs, all built against zero traffic | **Leave them.** Tested code nobody visits costs ~nothing; another destructive migration has real risk. `0111` nearly disabled the capacity check | Never, unless something blocks |
| **Migrating off Clerk** — the only real vendor lock-in; accounts live in Clerk and password hashes cannot be exported | **Keep Clerk.** The escape hatch is already built: `profiles` is the identity of record and `clerk_user_id` is a thin bridge | Clerk changes pricing. Swapping means one column and three SQL helpers, not a rewrite |

---

## The honest summary

The bottleneck is not the software and never was. Every pitch is read by a human admin before
dispatch — that is a core mandate, not an accident — so **the moderation queue is the real
constraint at scale**, and no infrastructure fixes it. Adding an admin is one `UPDATE`.

What can actually kill this project, in order:

1. **The laptop dying before §0 is done.**
2. The domain expiring — it takes down the team website too.
3. Everyone losing access because accounts were in one student's name.
4. The 02:00 cron being disabled, and Supabase pausing a week later.
5. A dead payment card.

None of those require a programmer to prevent.
