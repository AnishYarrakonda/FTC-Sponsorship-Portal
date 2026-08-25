# What we need before launch — one meeting, no card

**For: the Exodius team captain / lead mentor.**
No technical knowledge needed. Everything below is an account, a login, or a decision.

The app is finished and running. **It turns out we don't need to buy anything** — the team
already owns the domain. What's left needs an adult and a couple of passwords, not a card and
not more engineering.

---

## The short version

**Total cost: $0.** There is nothing to buy.

The team already owns **`exodiusftc.com`** (registered at GoDaddy, with the team website
running on Netlify). The app goes at **`pitfund.exodiusftc.com`**, a subdomain, which is free.
Every service we use has a free tier that comfortably fits a high-school robotics team, and we
should stay on those tiers until there is a reason not to.

So this meeting is not about money. It is entirely about **whose name the accounts are in**,
and **who has the GoDaddy login.** Skip to "Who owns these" — that is the whole agenda.

---

## Nothing to buy

We were going to need a domain. We don't — the team already has one.

| What we thought | What is actually true |
|---|---|
| Buy a domain, ~$12/yr | `exodiusftc.com` is already owned and paid for. The app lives at `pitfund.exodiusftc.com` for **$0** |
| Verify a sending domain with Resend | **Already done.** Email authentication (SPF, DKIM) is live on `exodiusftc.com` and email works today |

**What we need instead of a credit card: the GoDaddy login.** Two DNS records have to be added
there, plus about five more for login. Details in `docs/GO-LIVE-CUTOVER.md`.

⚠️ **One warning to pass on to whoever holds that login.** GoDaddy and Vercel will both offer
to move the domain's *nameservers*. **Say no.** The team's public website runs on Netlify from
the same domain, and moving nameservers takes it offline. Only add the individual records in
the cutover doc.

**Check the domain's renewal date and the card attached to it while you are in there.** An
expired domain takes down the team website *and* this app at the same time. It is the single
most common way a project like this quietly dies.

---

## Sign up for these (all free)

| # | Service | What it does for us | Plan | Notes |
|---|---|---|---|---|
| 2 | **Vercel** | Runs the website | Hobby — **$0** | Already set up. See the caveat below. |
| 3 | **Supabase** | The database | Free — **$0** | Already set up. Holds sponsor commitments and the audit log. |
| 4 | **Clerk** | Login / accounts | Free, 10,000 users — **$0** | **Needs one change before launch — see "The one real blocker".** |
| 5 | **Resend** | Sends our email | Free, 3,000/mo — **$0** | Already set up **and already verified** on `exodiusftc.com`. The daily cap of **100/day** is the limit that will bite first, not the monthly one. |
| 6 | **Sentry** | Tells us when something breaks | Free — **$0** | Already set up. Someone needs to actually watch it. |
| 7 | **UptimeRobot** | Tells us if the site goes down | Free — **$0** | Not set up yet. 5 minutes. Worth it. |

### Two caveats worth knowing

**Vercel Hobby is for non-commercial use.** Whether a nonprofit robotics team's sponsorship
portal counts as "commercial" is genuinely ambiguous — it moves money but earns none. The risk
of Vercel objecting is low but not zero. Vercel Pro is **$20 per team member per month**, so
two owners is **$40/mo, or $480/yr** — forty times the cost of everything else combined. My
recommendation: **stay on Hobby**, share one team-owned login, and revisit only if Vercel ever
pushes back or the team gets a real budget.

**Supabase Free has no automatic backups.** We are storing sponsor funding commitments and an
audit log. Supabase Pro ($25/mo) adds daily backups; alternatively a free scheduled job can
dump the database to a private repo weekly. **Start free.** Revisit after the first real
sponsorship goes through, when losing the data would actually be an incident.

---

## The one real blocker

**Clerk is currently running in "development" mode in production.**

This is not a subscription problem — the fix is free. But it must happen **before the first
real coach signs up**, because:

- Development mode is **capped at 100 users**, and **user accounts cannot be moved** to a
  production instance. Everyone who signs up before we switch has to sign up again after.
- Login pages are served from a random `accounts.dev` address, which looks like a phishing
  page to a corporate sponsor's IT department.
- It is rate-limited hard enough that one busy moment locks people out.

**What it needs:** someone creates a Production instance in the Clerk dashboard and points it at
`pitfund.exodiusftc.com`. DNS changes can take **up to 48 hours**, so this should happen about a
week before we want to launch, not the night before. The engineering side is already done.

Right now **zero people have signed up**, so switching costs nothing. Every day we wait, the
cost of switching can only go up. Step-by-step instructions: `docs/GO-LIVE-CUTOVER.md`.

---

## Who owns these — the part that actually matters

Right now every one of these services is registered to **Anish personally**. When he leaves for
college, the project dies with his access. That is not a hypothetical; it is the default
outcome unless we change it in this meeting.

**Before signing up for anything, create one shared team identity:**

1. A team email address — something like `tech@exodiusftc.com` or a dedicated Gmail. **Nobody's
   personal login.**
2. A free password vault (Bitwarden). Every credential and recovery code goes in it.
3. Access for **two current students plus one adult mentor**.

**The mentor is the load-bearing part.** Students turn over every year; the mentor is the only
continuity the team has.

Then: **every service above gets registered to that team email, with the mentor as a second
owner.** Any service with exactly one owner is a countdown timer.

**No service here needs a card today.** The one recurring cost that already exists is the
domain renewal at GoDaddy — make sure that card belongs to someone who is still here next year,
not a graduating senior. If we ever add a paid tier (see the caveats above), the same rule
applies.

---

## What to do in the meeting

No card required. Five decisions:

1. **Confirm `pitfund.exodiusftc.com`** is the name we want the app to live at.
2. **Find out who controls the GoDaddy account** and whether an adult has access. Check the
   domain's renewal date and that the card on file is valid.
3. **Create the team email address and the password vault.**
4. **Agree who the adult owner is on every account** — the part that decides whether this
   survives Anish going to college.
5. **Agree who watches the error alerts and who answers support email.**

Then someone with the GoDaddy login and the Clerk login works through
`docs/GO-LIVE-CUTOVER.md`: about 30 minutes of clicking, plus waiting for DNS.

Everything after that is configuration. The complete, ordered list of what remains — including
every dashboard step and every free service — is **`docs/LAUNCH-CHECKLIST.md`**. Day-to-day
operations are in `docs/RUNBOOK.md`.

---

## What we are NOT buying, and why

- **Payment processing (Stripe, PayPal).** The platform never touches sponsorship money.
  Sponsors pay teams directly. This is a deliberate design decision — handling other people's
  money would bring regulatory obligations a student-run project should not take on.
- **E-signature (DocuSign etc.).** Removed. Sponsors and teams sort out their own paperwork
  off-platform. The app introduces them and gets out of the way.
- **Anything with "enterprise" in the name.** Not at this scale.
