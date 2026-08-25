# Workflows

## Local dev
- `npm run dev` — Next dev (Turbopack).
- `npm run dev:admin-preview` — dev server with `NEXT_PUBLIC_DEV_AUTH_BYPASS=true`; opens the admin portal with no sign-in, using fully static mock data from `lib/dev-bypass.ts`. Never touches prod Supabase.
- `npm run dev:sponsor-preview` — dev server with `NEXT_PUBLIC_SPONSOR_PREVIEW=1`; opens the sponsor portal with static fixtures from `lib/dev-preview.ts`. No Clerk sign-in required.
- `npm run dev:coach-preview` — dev server with `NEXT_PUBLIC_COACH_PREVIEW=1`; opens the coach portal with static fixtures from `lib/dev-coach-preview.ts`. No Clerk sign-in required.
- `npm run build` — production build (`next build`, Turbopack). The `jsdom`/`cssstyle` pins in `package.json` `overrides` must stay — they fix a runtime `ERR_REQUIRE_ESM` in the serverless bundle and are unrelated to the bundler. Do not re-add `--webpack`.

## Validate (run before every push)
- `npm run typecheck` — `tsc --noEmit`.
- `npm run lint` — eslint.

## Test
- Unit: `npm run test` (Vitest) / `npx vitest`.
- E2E: `npx playwright test`. `tests/global-setup.ts` checks Supabase reachability and caches an admin session to `tests/.auth/admin.json` (session now comes from Clerk); gated behind `SUPABASE_LOCAL`.
- Seed local data: `node scripts/seed-test-accounts.mjs` — wipes + recreates the `coach+clerk_test@example.com` / `admin+clerk_test@example.com` / `sponsor+clerk_test@example.com` test users (Clerk users + matching `profiles` rows linked by `clerk_user_id`), a test sponsor company, a verified coach with a starter team. Email verification uses the static Clerk test OTP `424242`. Deletion order matters (children before parents).

## Migrations (`supabase/migrations/`)
- Numbered, sequential, **idempotent** (`IF NOT EXISTS`, `CREATE OR REPLACE`, enum values pre-declared at type creation so a from-scratch replay works).
- Apply with **`psql -f <file>`** (or `supabase db reset --linked`). The Supabase CLI's statement splitter mishandles files defining multiple `$$`-quoted functions ("cannot insert multiple commands into a prepared statement") — files like `0035/0041/0044/0047` and the Clerk-auth migration `0051_clerk_auth.sql` (defines `current_profile_id()` / `is_admin()` / `is_coach_verified()`) MUST go through `psql -f`.
- New table → enable RLS + write per-role policies (see auth-supabase.md checklist).

## Deploy & ops
- **Live**: Vercel `https://ftc-sponsorship-portal.vercel.app` (Hobby tier). Runtime env vars live in the Vercel project, not `.env.local`.
- **Clerk** (auth): set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET` (+ optional `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/login`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/signup`). Dashboard config (not code): register Clerk as a **Supabase third-party auth provider** so RLS trusts the Clerk JWT, and set the Clerk password policy to 12+/upper/lower/number.
- **Supabase keys**: use the **legacy JWT** keys (`eyJ…`, Settings → API → JWT keys). The new `sb_secret_` key is rejected (401) by REST. `SUPABASE_SERVICE_ROLE_KEY` must be the legacy service_role JWT or the whole server side fails.
- **No Upstash/Redis** — rate limiting was removed entirely; do not reintroduce those env vars.
- **Cron**: Vercel **Hobby honours only 2 cron entries** — extras are silently ignored, which is how three jobs sat dead in production (audit A-09-05). `vercel.json` therefore schedules exactly two:
  - `/api/cron/expire-submissions` at `0 2 * * *` — kept alone because it releases sponsor capacity and sweeps gov-ID/W-9 retention.
  - `/api/cron/daily-maintenance` at `0 4 * * *` — a dispatcher that runs `refresh-ftc-roster` and `impact-rollup` in sequence, each in its own try/catch.
  Each job stays exported from its own route (`runRefreshFtcRoster`, `runImpactRollup`), so those routes remain independently invocable — only the *scheduler* changed. **A new cron job goes inside the dispatcher, not into `vercel.json`**, unless you are on Pro. On **Vercel Pro** the cron cap lifts: split them back into their own `vercel.json` entries and retire `daily-maintenance`.

## Shipping a change
Use `/ship`: typecheck → lint → build → tests → open PR (`gh`). Only commit/push when asked; branch off `main` first if on `main`.
