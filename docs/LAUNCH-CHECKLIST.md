# Pitfund — the only launch document

**Rewritten 2026-08-26.** This replaces `GO-LIVE-CUTOVER.md` and `PURCHASE-CHECKLIST.md`, both
deleted. If another document disagrees with this one, this one is right.

The app is **code-complete and deployed**. Nothing on this list is programming.

|  | What | Who | When | Cost |
|---|---|---|---|---|
| **Part A** | Test every flow by hand | Anish | **now — no card needed** | $0 |
| **Part B** | Buy two things, then cut over | Anish + captain's card | the team meeting | ~$29 |
| **Part C** | Keep it alive | whoever owns it | forever | $20/mo |

---

## What you are buying, and why

| Service | Verdict | Cost |
|---|---|---|
| **Domain** (`pitfund.org`) | Required — the app needs its own | **$8.49/yr** |
| **Vercel Pro** | **Required by their terms, not by capacity** | **$20/mo** |
| Supabase | Free tier — deliberate, see Part C | $0 |
| Clerk | Free tier — 50,000 users, custom domain included | $0 |
| Resend | Free tier — 3,000 emails/mo | $0 |

**Total to launch: $28.49, then $20/month.**

**Why Vercel Pro is not optional.** Vercel's fair-use policy states that *"Hobby teams are
restricted to non-commercial personal use only"* and explicitly names **"Asking for Donations"**
as commercial usage. A platform whose purpose is soliciting sponsorship money is commercial under
that definition regardless of the platform never touching funds. Staying on Hobby risks the
account being paused — which is how a site dies silently on a Tuesday.

Pro is **$20/month flat**, including one deploying seat and $20 of usage credit. **Viewer seats
are free and unlimited**, so the mentor and other students get dashboard access at no cost. Only
add a paid seat when a second person genuinely needs to deploy.

**`exodiusftc.com` is the team website and is not involved.** The only overlap with the app is a
shared team email address used to create the admin account.

---

# PART A — Test everything now

Nothing here costs money. Do it before the meeting so the only thing left is typing a card
number.

## A1. Your nine test accounts

Already seeded and live. Every one delivers real email to
**anish.yarrakonda456@gmail.com** — filter by the `+alias` to tell them apart.

Sign in at **https://ftc-sponsorship-portal.vercel.app/login**

| Role | Email | Password |
|---|---|---|
| Coach *(verified, owns "Dev Test Team" #99999)* | `anish.yarrakonda456+coach@gmail.com` | `CoachTest123!` |
| Admin | `anish.yarrakonda456+admin@gmail.com` | `AdminTest123!` |
| Sponsor — **org_admin** of "dev testing" | `anish.yarrakonda456+sponsor@gmail.com` | `SponsorTest123!` |
| Sponsor — **submitter** | `anish.yarrakonda456+sponsor-member@gmail.com` | `SponsorMemberTest123!` |
| Sponsor — **viewer** (read-only) | `anish.yarrakonda456+sponsor-viewer@gmail.com` | `SponsorViewerTest123!` |
| Sponsor — **approver** (2nd signature) | `anish.yarrakonda456+sponsor-approver@gmail.com` | `SponsorApproverTest123!` |
| Sponsor 2 — separate company | `anish.yarrakonda456+sponsor2@gmail.com` | `Sponsor2Test123!` |
| Reviewer *(admin, limited level)* | `anish.yarrakonda456+reviewer@gmail.com` | `ReviewerTest123!` |
| Denial coach *(unverified, awaiting review)* | `anish.yarrakonda456+denial-coach@gmail.com` | `DenialCoachTest123!` |

> **Four of these are the same company on purpose.** `sponsor`, `sponsor-member`,
> `sponsor-viewer` and `sponsor-approver` all belong to **"dev testing"** at different permission
> ranks. That is the sponsor multi-user feature. `sponsor2` is a *different* company, and exists
> so you can prove one sponsor cannot see another's data.

To recreate them at any time:

```bash
I_UNDERSTAND_THIS_IS_PRODUCTION=1 \
TEST_EMAIL_BASE=anish.yarrakonda456@gmail.com \
node scripts/seed-test-accounts.mjs
```

The script refuses to run against a hosted database without that first variable, and prints the
row counts it is about to delete. Drop `TEST_EMAIL_BASE` and it reverts to
`@example.com` addresses, which receive no mail — that is the mode the automated tests need.

## A2. Walk these thirteen flows

Tick each. If one fails, stop and tell me what you saw — do not work around it.

**Coach**
- [ ] **1.** Sign up as a brand-new coach → verification code arrives by email → upload a photo ID → lands on "awaiting verification"
- [ ] **2.** As **admin**, verify that coach → the **coach receives a verification email**
- [ ] **3.** As coach, fill in the team portfolio — story, budget, achievements — and save

**Pitching**
- [ ] **4.** As coach, submit a pitch to **"dev testing"** → **admin receives a new-submission alert email**
- [ ] **5.** As **admin**, open the moderation queue → approve → dispatch → **the sponsor receives the pitch email**
- [ ] **6.** As **sponsor**, open that email, accept **in full** → **both sides get a "Match Made" email containing each other's contact details**

**Money edges**
- [ ] **7.** Submit a second pitch, accept it for **less than asked** (counter-offer) → the sponsor's remaining capacity reflects the smaller amount
- [ ] **8.** Submit a third, **decline** it → the coach is notified and no capacity is consumed

**Sponsor multi-user — the part you asked about**
- [ ] **9.** Sign in as **sponsor-member** (submitter) → propose a decision → sign in as **sponsor-approver** → approve it. Neither can do both halves alone
- [ ] **10.** Sign in as **sponsor-viewer** → confirm you **cannot** approve, edit, or change anything
- [ ] **11.** Sign in as **sponsor2** → confirm you see **nothing** belonging to "dev testing"

**Admin recovery + account**
- [ ] **12.** As admin, void a match at `/admin/capacity` → the sponsor's capacity comes back, and the page reports **zero drift**
- [ ] **13.** Sign out → "forgot password" → **the reset email arrives** → set a new password → sign in with it

## A3. Also click around

Open every sidebar item in all three portals and confirm nothing 404s or renders blank.

> A page returning HTTP 200 is **not** proof it rendered — error boundaries return 200 too. If a
> page looks empty or wrong, open the browser console (F12) and send me what is red.

---

# PART B — Purchase day (~45 minutes, plus DNS waiting)

Do these **in order**. Later steps depend on earlier ones existing.

### B1. Buy Vercel Pro — *2 min, $20/mo*

vercel.com → your project → **Settings → Billing → Upgrade to Pro**. Team card.

This also converts your personal scope into a **Team**, which is what you hand to someone else
when you graduate.

### B2. Buy the domain — *3 min, $8.49*

**Buy it at Vercel**, not at a registrar: [vercel.com/domains](https://vercel.com/domains/search?q=pitfund.org)

Buying it at Vercel means the DNS configures itself and there are no nameservers to move. If you
buy it elsewhere you inherit a whole class of DNS problems for no benefit.

`pitfund.com` is taken. **`pitfund.org` is available at $8.49/yr** and `.org` reads as
non-profit to corporate CSR departments, which is what you are. Alternatives if you prefer:
`pitfund.app` ($9.99), `getpitfund.com` / `joinpitfund.com` ($11.25).

### B3. Tell me — *I do this part*

Message me the domain you bought. I will:
- attach it to the Vercel project
- point `NEXT_PUBLIC_APP_URL` at it
- add the Clerk and Resend DNS records once you paste them (B4, B5)
- set the environment variables and redeploy

### B4. Create the Clerk production instance — *15 min + DNS wait*

**This is the only step that cannot be automated at all.** Clerk has no API for it, and
**development accounts cannot be migrated** — anyone who signs up before this must sign up again.
Right now that number is zero. It only goes up.

*(You already have a Clerk **development** instance. That is what `pk_test_` means. There is
nothing to "create" there.)*

1. dashboard.clerk.com → instance dropdown, top-left, says **"Development"** → **Create
   production instance** → **Clone settings from development**
2. Application domain: **your new domain**
3. Clerk's **Domains** page now lists about five DNS records — hosts like `clerk`, `accounts`,
   `clkmail`, `clk._domainkey`, `clk2._domainkey`. **The values are unique to your instance.**
   Copy them and paste them to me — I will add them with `vercel dns add`
4. Wait for **verified**. Usually under an hour; Clerk warns it can take up to 48
5. **Re-set the password policy — it does NOT clone.** 12+ characters, upper, lower, number. The
   app deliberately does not validate passwords itself; Clerk owns that rule, so skipping this
   silently downgrades you to Clerk's weaker default
6. **Register the new instance with Supabase**: Supabase dashboard → **Authentication →
   Third-party auth** → add the **production** Clerk instance.
   **This is the step that goes wrong.** Skip it and every page loads but renders completely
   empty, because the database rejects every row. It looks exactly like a data bug and is a
   config bug
7. Create the webhook: endpoint `https://<your-domain>/api/webhooks/clerk`, events
   **`user.deleted`** and **`user.updated`**. Copy the `whsec_…` value and send it to me

### B5. Move email to the new domain — *5 min*

resend.com → **Domains → Add Domain** → your new domain. Resend generates three records:

| Host | Type | Purpose |
|---|---|---|
| `send` | `TXT` | SPF |
| `resend._domainkey` | `TXT` | DKIM |
| `send` | `MX` | bounce feedback |

Paste them to me. I will add them and update `RESEND_FROM_EMAIL` to `noreply@<your-domain>`.

I will also add a `_dmarc` TXT record — that is the one record Resend does not generate, and its
absence is the single failing check in the verification suite today.

**Rotate the Resend API key while you are in there** (Settings → API Keys). The current key was
printed into a chat transcript. It's low risk and the transcript is local, but you are creating a
new domain anyway, so it costs nothing to generate a fresh key and revoke the old one.

### B6. Wipe the test data — *5 min*

**Do this last**, once everything else works. It deletes the nine test accounts and their data.

⚠️ **Supabase Free has no backups. Take a dump first.**

```bash
/opt/homebrew/opt/libpq/bin/pg_dump "$DATABASE_URL" > ~/pitfund-preLaunch-$(date +%F).sql
```

> **If that hangs with `timeout expired`, your network blocks outbound port 5432.** Confirmed on
> your current network on 2026-08-26. Check it in one command — if 443 works and 5432 times out
> against the *same host*, it is the network, not Supabase:
>
> ```bash
> curl -sS --connect-timeout 8 telnet://aws-1-us-east-1.pooler.supabase.com:5432 ; echo "5432 exit=$?"
> curl -sS --connect-timeout 8 https://aws-1-us-east-1.pooler.supabase.com >/dev/null ; echo "443 exit=$?"
> ```
>
> Exit `28` means blocked. **Use a phone hotspot for the dump.** The deletes below can be pasted
> into the Supabase dashboard SQL editor instead, which runs over HTTPS — but the dashboard
> cannot produce a backup, so take the dump from the hotspot first.

Then, in the Supabase SQL editor:

```sql
BEGIN;
DELETE FROM transactions_ledger;
UPDATE sponsors SET funding_used_cents = 0;
DELETE FROM sponsors WHERE company_name ILIKE 'dev testing%';
DELETE FROM notifications;
DELETE FROM profiles WHERE email LIKE 'anish.yarrakonda456+%';
SELECT count(*) AS drift_rows FROM detect_capacity_drift();  -- must be 0
COMMIT;
```

`transactions_ledger` is **append-only by design** — a reversal is normally a compensating
negative row, never a delete. Clearing fixtures before launch is the one legitimate exception.
After this, the rule is absolute.

Also delete the nine test users in the **Clerk dashboard**, or they can still sign in.

Then create the real admin: sign up normally at `/signup`, then in the SQL editor:

```sql
UPDATE profiles SET role = 'admin' WHERE email = 'the-team-email@example.com';
```

### B7. Final verification

```bash
npm run verify:all
```

Then by hand, on the real domain:

- [ ] `https://<your-domain>` loads
- [ ] The login page is served from **`accounts.<your-domain>`**, not `…clerk.accounts.dev`. That is the proof B4 worked
- [ ] Send one pitch end-to-end. **Confirm the email links point at your domain, not `vercel.app`**
- [ ] `/admin/capacity` reports zero drift
- [ ] Send one message through [mail-tester.com](https://mail-tester.com) — **9/10 is the pass bar**, and any point lost to SPF, DKIM, DMARC or reverse DNS is a hard fail regardless of the total

---

# PART C — Keeping it alive

### Set up once, free

- **UptimeRobot** on `https://<your-domain>/api/health` — tells you the site is down before a
  sponsor does, and the 5-minute ping keeps the app warm, which removes the landing page's
  one-off ~2s cold start
- **FIRST API credentials** at `frc-events.firstinspires.org` → set `FIRST_API_USERNAME` and
  `FIRST_API_TOKEN`. Without them coach verification silently falls back to FTCScout, a less
  authoritative source. Nothing errors, which is exactly why it is easy to miss
- **Resend webhook** → add the `email.complained` event. The handling code exists and is inert
  until Resend actually sends it, so a spam complaint is currently invisible

### The three things that will actually kill this

1. **Never disable the 02:00 cron.** `/api/cron/expire-submissions` releases sponsor capacity
   *and* is the **Supabase keepalive** — Supabase pauses free projects after 7 days without
   database traffic. If it stops, the whole site goes down a week later, silently.
2. **The domain expiring.** Turn on auto-renew and keep a valid card on file.
3. **Everyone losing access** because every account is in one student's name. Vercel Pro makes
   this a solved problem — transferring team ownership is a documented dashboard flow — but
   somebody has to actually do it.

### Supabase Free — what you are accepting

Deliberate, and revisitable in one click (Settings → Billing → Upgrade, $25/mo, no migration).

| Limit | What happens |
|---|---|
| **No backups** | Data loss is unrecoverable. This is the real reason to upgrade |
| **500 MB database** | The database goes **read-only** — automatic enforcement, not a warning. Every write starts failing. You are nowhere near this |
| **7-day idle pause** | Held off by the 02:00 cron. See above |

**Upgrade when the first real sponsorship goes through**, because from that moment losing the
data is a genuine incident rather than an inconvenience.

### Resend Free — the ceiling to watch

3,000/month, but **100/day**, and the daily cap is the one that bites. Roughly 6 emails per pitch
across its whole lifecycle, so ~50 approvals in one day is the ceiling. Normal operation is
nowhere close; a coordinated outreach push could be. At the cap, a send **fails and is not
retried** — it goes to Sentry and the email is simply lost. Resend Pro is $20/mo and removes the
daily cap.

### Monthly, 5 minutes

Check Sentry for new errors · confirm `/admin/capacity` shows zero drift · confirm the domain
is not drifting toward expiry.

### Yearly

Bump `CURRENT_SEASON` in `lib/site-config.ts` · confirm the domain auto-renewed · confirm the
named adult mentor is still involved.

**If nobody on the team can code, do nothing — that is a legitimate strategy.** A correctly
configured app that nobody touches runs for years. **Do not accept automated dependency-update
pull requests** if nobody can evaluate them; merging one can break the build.

---

## Deliberately not doing, with reasons

| Item | Decision |
|---|---|
| **Removing unused features** — `appeals.ts` (789 lines), messaging | **Leave them.** Tested code nobody visits costs ~nothing; another destructive migration has real risk. `0111` nearly disabled the capacity check |
| **Making the landing page static** | Would cut a one-time 2.3s cold start, but requires moving auth redirects into middleware — the most breakage-prone area of this codebase. UptimeRobot solves it for free. Revisit after launch |
| **Terms governing law** — still says jurisdiction "not yet fixed" | Ship as-is. Honest, blocks nothing, fill-in-the-blank once the team has a legal entity |
| **Migrating off Clerk** — the only real vendor lock-in | **Keep Clerk.** The escape hatch is built: `profiles` is the identity of record and `clerk_user_id` is a thin bridge |

---

## The honest summary

The bottleneck is not the software and never was. Every pitch is read by a human admin before
dispatch — a core mandate, not an accident — so **the moderation queue is the real constraint at
scale**, and no amount of infrastructure fixes it. Adding another admin is one `UPDATE`.

What is verified as of 2026-08-26: typecheck clean, 591/591 unit tests passing, lint 0 errors,
production build green, `knip` reporting no dead files or unused dependencies, all production
deployments `Ready`, live health `{"ok":true,"service":"up","db":"ok"}`.

What is **not** verified, and cannot be until purchase day: the Clerk production instance, and
anything that depends on a domain that does not exist yet. Part B is written to be followed
mechanically for exactly that reason.
