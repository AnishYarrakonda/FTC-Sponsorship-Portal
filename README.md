# FTC Pitfund — The Common App for FTC Sponsorships

A "Dynamic Portfolio" and Verified Grant Portal connecting FIRST Tech Challenge (FTC) robotics teams with verified corporate sponsors. Teams maintain a professional "Portfolio" (Global Team Data) and generate Customized Submissions with unique, trackable URLs for sponsors. Admins vet the quality of the 'Custom Pitch' fields before dispatching links to sponsors.

## Architecture

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router) + TypeScript + Tailwind CSS v4 + shadcn/ui |
| Auth | Clerk (`@clerk/nextjs`) — sessions, email verification, password reset |
| Database | Supabase (Postgres + RLS + Storage); trusts Clerk via native third-party auth |
| Email Dispatch | Resend + React Email |
| Validation | Zod + React Hook Form |
| Hosting | Vercel + Supabase Cloud |

## Key Design Principles

- **RLS-first authorization** — every table enforces policy at the DB layer (keyed on the Clerk user id via `auth.jwt()->>'sub'`); app code is the second line of defense
- **Admin-gatekept dispatch** — no email leaves the platform without admin approval
- **COPPA compliance** — only verified adult coaches register; zero student PII columns in schema
- **Immutable audit log** — all admin actions are appended to `audit_log`
- **Sponsor capacity integrity** — `funding_cap_cents` / `funding_used_cents` enforced at DB level; inactive or fully-funded sponsors are invisible to coaches

## User Roles

| Role | Description |
|---|---|
| `coach` | Adult advisor who registers, builds team portfolio, creates submissions |
| `admin` | Platform operator who verifies coaches, reviews submissions, and triggers dispatch. |
| `sponsor` | Funder account that reviews dispatched submissions and approves/declines funding from `/sponsor/dashboard` |

Sponsors can also be reached without logging in via a unique, trackable link (`/sponsor-view/[token]`) sent by email.

## Getting Started

### Prerequisites

- Node.js 20+
- The [Supabase CLI](https://supabase.com/docs/guides/cli) and `psql` (for migrations)
- A [Supabase](https://supabase.com) project
- A [Clerk](https://clerk.com) application (auth)
- A [Resend](https://resend.com) account

### Environment Variables

Copy `.env.example` to `.env.local` and fill in:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=        # Supabase anon key — use the legacy JWT (eyJ…)
SUPABASE_SERVICE_ROLE_KEY=            # Supabase service_role key — legacy JWT (eyJ…)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=   # Clerk publishable key
CLERK_SECRET_KEY=                    # Clerk secret key (server-only)
CLERK_WEBHOOK_SIGNING_SECRET=        # Svix secret for app/api/webhooks/clerk; required in production
# Optional: NEXT_PUBLIC_CLERK_SIGN_IN_URL=/login, NEXT_PUBLIC_CLERK_SIGN_UP_URL=/signup
RESEND_API_KEY=
RESEND_FROM_EMAIL=noreply@yourdomain.com
RESEND_WEBHOOK_SECRET=                # Svix signing secret; required in production
NEXT_PUBLIC_APP_URL=http://localhost:3000
CRON_SECRET=                          # bearer token for the Vercel cron; required
DATABASE_URL=                         # direct Postgres URL — NOT read by the app; used by
                                      # `psql -f` for migrations and by scripts/*.mjs
# Optional: SENTRY_DSN, NEXT_PUBLIC_SENTRY_DSN, ADMIN_NOTIFICATION_EMAILS
# Optional: FIRST_API_USERNAME, FIRST_API_TOKEN — official FIRST roster lookup for coach
#           verification. Absent, it falls back to FTCScout silently; nothing warns you.
```

> Every variable listed as required is validated by `lib/env.ts`, which **throws in
> production** if one is missing — so a typo here takes the whole site down rather than
> degrading one feature. Leave `SENTRY_DSN` genuinely blank rather than pasting a
> placeholder; the schema tolerates a malformed value on purpose, because the old literal
> placeholder made it into Vercel more than once.

> **Use the legacy Supabase JWT keys** (Settings → API → JWT keys, they start with `eyJ`). The new `sb_publishable_…` / `sb_secret_…` format is **not** reliably accepted by the API. There is **no** Upstash/Redis dependency — rate limiting was removed.

> **Register Clerk as a Supabase third-party auth provider** (Supabase dashboard → Authentication → Third-party auth) so RLS can trust the Clerk session JWT — policies key off the Clerk user id in `auth.jwt()->>'sub'`. Also set the Clerk password policy to 12+ chars with upper/lower/number.

### Database Setup

Migrations are idempotent and build the full schema (tables, RLS, storage buckets, enums). Apply them with `supabase db reset --linked` **or** `psql`. A few migrations define multiple `$$`-quoted functions in one file (0035/0041/0044/0047), which the Supabase CLI splitter mishandles — apply those with `psql -f`, which parses dollar-quotes correctly:

```bash
# Apply every migration in order via the session-mode pooler
for f in supabase/migrations/*.sql; do
  psql "postgresql://postgres.<ref>:<password>@<region>.pooler.supabase.com:5432/postgres" \
    -v ON_ERROR_STOP=1 -f "$f"
done
```

Do **not** run `supabase/seed.sql` against production — it is dev-only test data.

### Running Locally

```bash
npm install
npm run dev
```

App runs at [http://localhost:3000](http://localhost:3000).

## Project Structure

```
middleware.ts      # Clerk clerkMiddleware() + public-route matcher
app/
  (auth)/          # Login, signup (Clerk headless), verify-email, credential upload
  (coach)/         # Dashboard, team edit, submission builder, sponsor browser
  (admin)/         # Review queue, moderation, sponsor management, analytics
  (sponsor)/       # Sponsor dashboard — review & decide on dispatched submissions
  sponsor-view/    # Public, token-authenticated pitch viewer
  api/
    webhooks/      # Resend bounce/open + Clerk (user.deleted / email sync) webhook handlers
    cron/          # Two scheduled jobs; the 02:00 one is ALSO the Supabase keepalive
    health/        # Liveness + authed deep DB probe
components/
  portfolio-builder/ # Multi-step submission form
  team/            # Onboarding and master portfolio forms
  sponsor/         # Sponsor application form
  ui/              # shadcn/ui primitives
lib/
  supabase/        # server.ts, client.ts (both forward the Clerk token), admin.ts, types.ts
  schemas/         # Zod schemas shared between client and server
  dispatch.ts      # Admin-gated sponsor pitch dispatch (Resend)
  notify.ts        # Dual-channel notifications — in-app inbox + email (always both)
  ftc-roster.ts    # FTC team number validator (cached)
  env.ts           # Zod-validated environment variables
supabase/
  migrations/      # SQL migrations (RLS, triggers, views, indexes)
  seed.sql         # Dev seed data
emails/            # React Email templates
```

## Chunk Roadmap

| Chunk | Status | Description |
|---|---|---|
| 1 | Done | Scaffold, auth, DB schema, RLS, Supabase clients, seed |
| 2 | Done | Master Portfolio flow, FTC roster validator, incubator flow |
| 3 | Done | Submission builder with custom pitch alignment |
| 4 | Done | Sponsor database, targeting UI, opt-in application |
| 5 | Done | Admin review queue and Resend dispatch |
| 6 | Done | Analytics/COPPA hardening, E2E tests, dual-channel notifications, launch prep |

## Deployment

Live on Vercel (Hobby tier). Runtime env vars are configured in the Vercel project, not
committed.

**Deploys are manual — pushing to `main` does nothing.** There is no Git integration on the
Vercel project. Ship with `vercel deploy --prod --yes`.

Two crons are scheduled in `vercel.json` and authed with `CRON_SECRET`. **The 02:00
`/api/cron/expire-submissions` job is also what keeps Supabase from pausing the free project
— disabling it takes the site down seven days later, silently.** Vercel Hobby runs only two
scheduled entries and ignores extras without warning, which is why `daily-maintenance` is a
dispatcher; a new job goes inside it, not into `vercel.json`.

- **`docs/RUNBOOK.md`** — operations, written for a non-developer: deploy, rollback, add an
  admin, apply a migration, symptom→fix.
- **`docs/PURCHASE-CHECKLIST.md`** — the accounts and the one domain that still need buying.
- **`docs/GO-LIVE-AND-HANDOFF.md`** — launch blockers and long-term ownership.
- `CLAUDE.md` → "Deployment & Ops" for the Supabase-key and migration gotchas.
