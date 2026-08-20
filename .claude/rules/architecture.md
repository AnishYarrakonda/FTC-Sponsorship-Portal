# Architecture

## Stack
- **Next.js 16.2** App Router, **React 19**, **Tailwind v4**, **shadcn/ui** (Radix + base-ui).
  - Next 15+ has breaking changes vs older docs. When unsure of an API, consult `node_modules/next/dist/docs/`.
- **Clerk** (`@clerk/nextjs`) — auth provider: sessions, email verification, password reset, password policy.
- **Supabase** — Postgres + Storage (no Supabase Auth). Supabase trusts Clerk via native third-party auth; security enforced primarily by database **RLS**, which reads the Clerk user id from `auth.jwt()->>'sub'`.
- **Backend** — Server Actions for all mutations (`app/actions/*`), validated with **Zod** (`lib/schemas/*`).
- **Email** — Resend + React Email (`emails/*`).
- **Errors** — Sentry (`instrumentation*.ts`).

## Directory map
- `app/(account|admin|auth|coach|public|sponsor)/` — route groups by audience (the parens are not in the URL).
- `app/actions/*.ts` — server actions: `account`, `admin`, `auth`, `moderation`, `notifications`, `sponsor-decision`, `sponsor`, `submission`, `team`.
- `app/api/*` — route handlers (return JSON; never redirected to `/login`). Current routes:
  - `admin/export` — CSV/data export (admin-only)
  - `admin/queue/count` — moderation queue badge count
  - `coach/notifications/unread` — unread notification count (coach)
  - `cron/expire-submissions` — daily cron at 02:00 UTC (scheduled via `vercel.json`); marks stale submissions expired
  - `health` — public health check
  - `webhooks/clerk` — handles `user.deleted` and email sync from Clerk
  - `webhooks/resend` — delivery event webhooks from Resend
- `lib/supabase/{client,server,admin,types}.ts` — Supabase clients (see auth-supabase.md). `client`/`server` forward the Clerk token via an `accessToken` callback.
- `middleware.ts` (repo root) — `clerkMiddleware()` + `createRouteMatcher` for public routes. (The old `lib/supabase/middleware.ts` was deleted.)
- `lib/schemas/*.ts` — Zod schemas (`auth`, `submission`, `team`, `sponsor`, `sponsor-signup`, `achievement`, `limits`).
- `lib/actions-utils.ts` — auth/role guards (`requireAuth`, `requireAdmin`, `requireSponsor`, `requireVerifiedCoach`) + `getClientIp`.
- `lib/notify.ts` — `createInAppNotification` + typed email senders.
- `lib/dispatch.ts` — gated sponsor outreach (`dispatchApprovedSubmission`).
- `lib/env.ts` — Zod-validated env (warns in dev, throws in prod).
- `lib/ftc-roster.ts` — FTC team roster lookup helpers (used for coach verification).
- `lib/site-config.ts` — centralised landing-page copy, theme accent colours, and static fixtures; edit here to update landing page stats/sponsors without touching components.
- `lib/dev-bypass.ts` — dev-only admin auth bypass + mock Supabase data (`NEXT_PUBLIC_DEV_AUTH_BYPASS=true`; forced off in production).
- `lib/dev-preview.ts` — dev-only sponsor portal preview with static fixtures (`NEXT_PUBLIC_SPONSOR_PREVIEW=1`; forced off in production).
- `lib/dev-coach-preview.ts` — dev-only coach portal preview with static fixtures (`NEXT_PUBLIC_COACH_PREVIEW=1`; forced off in production).
- `supabase/migrations/*.sql` — numbered, idempotent migrations (latest: `0095_release_capacity_on_cancel.sql`; note `0012` does not exist — the numbering skips it). Always confirm the real latest with `ls supabase/migrations | tail -3` before adding one — this line has been stale before.
- `tests/` — Playwright E2E + `global-setup.ts`; `scripts/seed-test-accounts.mjs` for local data.

## Roles & key tables
- Roles live in `profiles.role`: **`admin`** | **`coach`** | **`sponsor`**.
- `profiles.coach_verified` (bool) — a coach must be verified before submitting pitches.
- `profiles.sponsor_id` (uuid) — links a sponsor user to their company row (null until approved).
- Core tables: `profiles`, `teams`, `submissions`, `sponsors`, `notifications`, `audit_log`, `transactions_ledger`, `submission_access_tokens`.

## Supabase clients (which one, when)
| Client | File | RLS | Use in |
|--------|------|-----|--------|
| Browser | `lib/supabase/client.ts` | respects RLS (Clerk token via `accessToken`) | Client Components |
| Server | `lib/supabase/server.ts` | respects RLS (Clerk token via `accessToken`) | Server Components, Route Handlers, reads in actions |
| Admin | `lib/supabase/admin.ts` | **BYPASSES ALL RLS** (unchanged) | server-only: `audit_log`, dispatch, trusted writes |

The server/browser clients forward the Clerk session token so RLS sees `auth.jwt()->>'sub'`. The **admin client uses the service-role key and ignores RLS** — it's UNCHANGED by the Clerk migration; never import it into client code, and only use it for operations that legitimately must bypass row security (audit logging, email dispatch, admin provisioning). Edge routing lives in the root `middleware.ts` (`clerkMiddleware()`), not a Supabase client.
