# Runbook

**Who this is for:** whoever is responsible for this app right now, whether or not they can
code. If you inherited this project and have no idea what any of it is, start here and read
top to bottom once. It is shorter than it looks.

**The single most useful thing in this document** is [Rollback](#rollback-when-something-just-broke).
If the site is broken and you remember nothing else, remember that.

---

## What this app is

Coaches of FIRST Tech Challenge robotics teams write sponsorship pitches. An admin reads every
pitch before it goes anywhere. Approved pitches are emailed to a sponsor, who accepts (in full
or for a smaller amount) or declines. When a sponsor accepts, both sides get an email with each
other's contact details and **everything after that happens off the platform**.

The app never touches money. It is an introduction service with a moderation queue.

---

## Where everything lives

| Thing | Service | What breaks if it's down |
|---|---|---|
| The website | **Vercel** | Everything |
| The database | **Supabase** | Everything |
| Logins | **Clerk** | Nobody can sign in |
| Email | **Resend** | Pitches stop reaching sponsors; nobody is told why |
| Error alerts | **Sentry** | You stop finding out about problems |
| The domain | **Vercel** (the app's own domain) | The app becomes unreachable |

**The app has its own domain, bought through Vercel**, so its DNS is self-contained and there
are no nameservers to move. `exodiusftc.com` is the team's **public website** (Netlify) and is
unrelated to this app — changes here cannot affect it, and vice versa. That separation is
deliberate: an earlier plan put the app on a subdomain of the team site, which coupled the two
for no benefit.

Credentials belong in the team password vault. If they are not there, fix that today.
**`docs/LAUNCH-CHECKLIST.md` is the single launch document** — what to buy, how to cut over, and
how to keep it running.

---

## Rollback — when something just broke

**This fixes about 90% of emergencies and takes 30 seconds.**

1. Go to **Vercel → the project → Deployments**.
2. Find the deployment from **before** things broke (they are listed newest first, with times).
3. Click the `⋯` menu on that row → **Promote to Production**.
4. Done. The site is back on the older version.

You do not need to understand what broke to do this. Do it first, work out why afterwards.

**When rollback will NOT help:** if a database change caused the problem, rolling back the
website alone may not fix it. Symptoms: the site loads but pages are empty, or everything
errors in the same way. See [Symptom → fix](#symptom--fix).

---

## Deploying

**Deploys are manual. Pushing to `main` does nothing.** There is no Git connection on the
Vercel project — this surprises everyone, including people who have worked on this before.

```bash
vercel deploy --prod --yes
```

Before deploying, from the project folder:

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

If any of those fail, do not deploy. They take about a minute total.

---

## Applying a database change (a "migration")

Migration files live in `supabase/migrations/`, numbered in order. To apply one:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0111_strip_post_match_pipeline.sql
```

**Use `psql -f`. Do not use the Supabase CLI for this.** The CLI splits SQL files incorrectly
and fails on any file that defines more than one function, with a confusing error about
"prepared statements". This has bitten this project repeatedly.

Migrations are written to be safe to run twice. If you are unsure whether one was applied, just
run it again.

**`DATABASE_URL` is in `.env.local`.** `psql` is at `/opt/homebrew/opt/libpq/bin/psql` on a Mac
with Homebrew.

**If `psql` hangs with `timeout expired`, the network is blocking outbound port 5432** — common
on school, corporate and some home ISP networks. It is not a Supabase outage: the website keeps
working, because the app reaches Supabase over HTTPS, not 5432. **Use the Supabase dashboard's
SQL editor instead**, or switch networks (a phone hotspot usually works).

---

## Adding an admin

Admins are the people who read and approve pitches. There is no UI for promoting someone —
deliberately, because it is the highest-privilege action in the app.

1. Have the person sign up normally on the site.
2. Then run:

```sql
UPDATE profiles SET role = 'admin' WHERE email = 'their-email@example.com';
```

Run it from the Supabase dashboard's SQL editor, or via `psql` as above.

Confirm it worked: they should see admin navigation on the left after signing out and back in.

---

## THE CRON JOB IS ALSO THE DATABASE KEEPALIVE — NEVER DISABLE IT

`vercel.json` schedules two jobs:

| Job | Time (UTC) | What it does |
|---|---|---|
| `/api/cron/expire-submissions` | 02:00 | Expires stale pitches, releases the capacity they were holding, purges coach ID photos past retention |
| `/api/cron/daily-maintenance` | 04:00 | Refreshes FIRST team data and rebuilds impact stats |

**The 02:00 job is load-bearing for a second, non-obvious reason.** Supabase pauses free
projects with no database traffic for 7 days. This job's daily database hit is what keeps the
project alive. **If it stops running, the entire site goes down a week later**, and the failure
is completely silent — no error, no alert, just a dead site the following Tuesday.

If you ever need to disable it, set up something else that touches the database daily first.

**Vercel Hobby only runs 2 scheduled jobs.** Extra entries in `vercel.json` are *silently
ignored* — this is how three jobs sat dead in production for months. That is why
`daily-maintenance` is a wrapper that calls several jobs in sequence. **A new scheduled job goes
inside that wrapper, not into `vercel.json`**, unless the project is on Vercel Pro.

---

## Symptom → fix

| What you see | Most likely cause | What to do |
|---|---|---|
| **Site is completely down** | Bad deploy | [Rollback](#rollback-when-something-just-broke) |
| **Site down, and it had been fine for days** | Supabase paused the project | Supabase dashboard → un-pause. Then check the 02:00 cron is running |
| **Every page loads but is empty; no errors** | Clerk is no longer registered with Supabase as an auth provider | Supabase dashboard → Authentication → third-party auth. Re-add Clerk. This looks like a data bug and is a config bug |
| **Nobody can sign in** | Clerk keys wrong or expired | Vercel → Settings → Environment Variables. Check `CLERK_SECRET_KEY` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` |
| **Emails stopped sending** | Resend limit or unverified domain | Resend dashboard. Free tier is 3,000/month and **100/day** — the daily cap is the one that bites |
| **Sponsors say pitch links are broken (404)** | `NEXT_PUBLIC_APP_URL` doesn't match the real domain | Vercel → env vars. Every emailed link is built from this |
| **A sponsor is stuck "at capacity" but shouldn't be** | A dead match still holding their cap | `/admin/capacity` → find the match → **Void match**. Never edit the number in the database by hand |
| **The site is slow on first load** | Cold start on an idle project | Normal. An uptime monitor pinging every 5 minutes keeps it warm |
| **`psql` times out but the website is fine** | Your network blocks outbound port 5432 | Not an outage. Use the Supabase dashboard SQL editor, or a phone hotspot |

---

## Monthly, five minutes

- Open **Sentry**. Any new errors?
- Open **`/admin/capacity`**. It should say zero drift. If it doesn't, that means the money
  numbers disagree with each other — do not fix it by editing numbers; ask someone technical.
- Check the domain hasn't drifted toward expiry and the card on file is still valid.

## Yearly

- `lib/site-config.ts` has a `CURRENT_SEASON` value that must be bumped each FTC season.
- Confirm the domain auto-renewed.
- Confirm whoever is named as the adult owner is still involved with the team.

---

## If nobody on the team can code

**Then do nothing, and that is a legitimate strategy.** A correctly configured app that nobody
touches keeps running for years. The things that will actually kill it are, in order:

1. The domain expiring. (It is shared with the team website, so this kills both at once.)
2. Everyone losing access because the accounts were in one student's name.
3. The 02:00 cron being disabled or its secret rotated, and Supabase pausing a week later.
4. A dead payment card.

None of those require a programmer to prevent. All four are covered in Part C of
`docs/LAUNCH-CHECKLIST.md`.

**Do not accept automated dependency-update pull requests** if nobody can evaluate them.
Merging one can break the build. The version running today will keep serving indefinitely.

---

## For a developer picking this up

- Read `CLAUDE.md` first, then `.claude/rules/`. They cover architecture, the auth model, and
  the conventions every server action follows.
- `docs/GO-LIVE-AND-HANDOFF.md` has the longer operational and succession detail.
- The one rule that has caused real incidents more than once: **when changing a Postgres
  function, dump the live body first** (`pg_get_functiondef`) and edit that. Never rebuild it
  from an old migration file — later fixes live only in the live body, and rebuilding silently
  deletes them.
