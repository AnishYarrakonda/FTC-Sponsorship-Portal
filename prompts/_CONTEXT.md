# `_CONTEXT.md` — Ground truth for every prompt in this folder

> **Read this file in full before executing any prompt in `/prompts`.**
> It is the shared, verified snapshot of how this codebase actually works as of
> migration `0075_query_efficiency.sql`. Every numbered prompt assumes you have read it
> and will not re-explain what is here.
>
> If something in this file contradicts what you find in the code, **the code wins** —
> stop, report the discrepancy, and do not guess.

---

## 0. What this product is

A platform connecting **verified adult FTC robotics coaches** with **corporate sponsors**.
Coaches build a team Portfolio and submit tailored pitches; admins moderate and gate
sponsor-facing outreach; sponsors review approved pitches and fund teams under strict
capacity caps.

Stack: **Next.js 16.2 (App Router) · React 19 · Tailwind v4 · shadcn/ui · Clerk (auth) ·
Supabase (Postgres + Storage, no Supabase Auth) · Resend + React Email · Sentry · Vercel.**

### The four Core Mandates (never violate)

1. **COPPA Compliance** — no student PII is collected, stored, or exposed. Verified adult
   coaches only. Never add a column, query, or UI that surfaces a minor's identity.
2. **Admin-Gatekept Outreach** — sponsor-facing *pitch dispatch* requires Admin approval
   and goes **exclusively** through `dispatchApprovedSubmission` in `lib/dispatch.ts`.
   Transactional notifications (status changes, decisions) are a *different* path and
   auto-send via `createInAppNotification` in `lib/notify.ts`.
3. **Capacity Integrity** — sponsor funding caps are strictly enforced. Nothing may
   reserve beyond a sponsor's remaining cap. See §4.
4. **Data Architecture Distinction** — Global Team Data (the Portfolio, reused across
   pitches) lives on `teams`. Submission-Specific Data (pitch alignment, specific needs,
   local connection) lives on `submissions`. Never duplicate global data into submissions.

---

## 1. Auth: the Clerk ↔ Supabase identity bridge

**This is the area that breaks most. Get it exactly right.**

- Auth is **Clerk** (`@clerk/nextjs` v7). Supabase provides **Postgres + Storage only**,
  and trusts Clerk via native third-party auth.
- The Clerk session JWT's `sub` claim is the Clerk user id (TEXT, `user_2…`). In Postgres
  it is `auth.jwt() ->> 'sub'`.
- **`auth.uid()` is always NULL under Clerk.** It appears in zero live policies.
  Never write a policy against it.
- `profiles.id` (uuid) is the internal PK. `profiles.clerk_user_id text UNIQUE` maps the
  Clerk id onto the profile row.

### SQL helpers (defined in `0051_clerk_auth.sql`, `0072_trusted_server_context.sql`)

| Function | Behavior |
|---|---|
| `current_profile_id() → uuid` | `SELECT id FROM profiles WHERE clerk_user_id = auth.jwt()->>'sub'`. SECURITY DEFINER, STABLE. |
| `is_admin() → boolean` | Caller's profile has `role = 'admin'`. |
| `is_coach_verified() → boolean` | Caller is `role='coach'` AND `coach_verified = true`. |
| `is_trusted_server_context() → boolean` | `sub IS NULL AND (auth.jwt() IS NULL OR role='service_role')`. **Use this — never test `sub IS NULL` yourself**, because the anon key also has no `sub` and that test fails open. |
| `sponsor_can_view_team(uuid) → boolean` | Sponsor has a dispatched submission from that team. Must stay a function — inlining causes 42P17 policy recursion. |

### Auth guards — `lib/actions-utils.ts`

Every server action begins with one of these. They **throw**; catch and return `{ error: e.message }`.

```ts
requireAuth():          Promise<{ supabase, user, clerkUserId }>              // throws 'Unauthorized'
getAuthedProfile():     Promise<{ supabase, user, clerkUserId } | null>       // non-throwing, for Server Components
requireAdmin():         Promise<{ supabase, user, clerkUserId, adminClient }> // throws 'Forbidden'
requireSponsor():       Promise<{ supabase, user, clerkUserId, sponsorId, adminClient }>
requireVerifiedCoach(): Promise<{ supabase, user, clerkUserId }>
                        // throws 'Awaiting credential verification' with e.code = 'NEEDS_VERIFICATION'
getClientIp():          Promise<string>   // x-forwarded-for first hop, else 'unknown'
```

`user` is the **`profiles` row** — so `user.id` is the internal uuid, and `clerkUserId` is
the Clerk id (used for Storage paths). Never trust a client-supplied id.

### Supabase clients — pick the right one

| Client | File | RLS | Use in |
|---|---|---|---|
| Browser | `lib/supabase/client.ts` | respects RLS (Clerk token via `accessToken`) | `'use client'` components |
| Server | `lib/supabase/server.ts` | respects RLS | Server Components, Route Handlers, reads in actions |
| Admin | `lib/supabase/admin.ts` | **BYPASSES ALL RLS** (service role) | server-only: `audit_log`, dispatch, RPC calls, trusted writes |

**Never** import `lib/supabase/admin.ts` into a Client Component or expose the service-role key.

Because `requireAdmin`/`requireSponsor` hand you the **admin client**, and that is what
calls the RPCs, the RPCs run in the "no Clerk `sub`" branch and must **re-verify the actor
from their `p_*_id` parameter**. Follow that existing pattern exactly.

### Middleware — root `middleware.ts`

`clerkMiddleware()` + `createRouteMatcher`. Public routes today:

```
'/', '/login(.*)', '/signup(.*)', '/verify-email(.*)', '/legal(.*)',
'/sponsors/apply(.*)', '/sponsor-view(.*)',
'/api/webhooks(.*)', '/api/cron(.*)', '/api/health'
```

- **Adding a new unauthenticated page? Add it to that list or it bounces to `/login`.**
- API routes are **never redirected** — unauth `/api/*` returns JSON `401`.
- `isAuthPage` bounces signed-in users away from `/login`, `/signup`, `/verify-email`,
  `/sponsors/apply`.

### MFA

MFA was **fully removed**. Do not reintroduce it unless a prompt explicitly asks.

---

## 2. Current database schema

Migration `0012` does not exist — numbering skips it.

> **⚠️ This section documents the schema as of `0075`, which was the head when this pack was
> written. Migrations have landed since.** Always run `ls supabase/migrations | tail -3` to
> find the real head before reserving a number.
>
> **Applied since this snapshot:**
> - `0076_funding_fulfillments.sql` — the funding fulfillment state machine (prompt 01)
> - `0077_team_payout_profiles.sql` — team payout profiles and W-9 collection (prompt 02)
> - `0078_funding_receipts.sql` — receipts and acknowledgment letters (prompt 04)
> - `0079_agreement_templates.sql` — versioned sponsorship agreement templates (prompt 05)
> - `0080_agreement_signatures.sql` — in-house e-sign capture and the database-enforced
>   agreement gate on fulfillment transitions (prompt 06)
> - `0081_ftc_official_verification.sql` — official-FIRST-roster fields on
>   `ftc_teams_cache` plus `team_verification_records` (prompt 07)
>
> Read those files directly for their tables, columns, RLS policies, and RPCs — they
> are not described below. Everything below `0075` remains accurate.

### Enums

| Type | Values |
|---|---|
| `user_role` | `coach`, `admin`, `sponsor` |
| `team_status` | `existing`, `incubator` |
| `sponsor_status` | `active`, `inactive`, `pending_review` |
| `sponsor_source` | `admin_added`, `public_optin` |
| `application_status` | `pending`, `approved`, `rejected` |
| `submission_status` | `draft`, `pending`, `approved`, `declined`, `changes_requested`, `opened`, `bounced`, `delivered`, `expired`, `dispatched` |
| `tax_status_type` | `501c3`, `School`, `None` |

`notifications.type` is **text with a CHECK**, not an enum:
`submission_declined | submission_approved | submission_changes_requested | coach_verified | general`.

### Tables (columns you will actually touch)

**`profiles`** — `id` uuid PK · `clerk_user_id` text UNIQUE · `role` user_role · `full_name` ·
`email` · `coach_verified` bool · `coach_credentials_url` · `coach_credentials_purged_at` ·
`sponsor_id` uuid FK→sponsors ON DELETE SET NULL · `date_of_birth` · `phone_number` ·
`address_line1` · `city` · `state` · `zip_code` · `referral_source` · `coppa_acknowledged` ·
`tos_accepted` · `age_confirmed_at` · `pending_team_data` jsonb · `denial_reason` ·
`denied_at` · `created_at` · `updated_at`

**`teams`** — `id` uuid PK · `owner_id` uuid FK→profiles CASCADE · `status` team_status ·
`ftc_team_number` int · `team_name` · `organization` · `city` · `state` · `slug` text UNIQUE ·
`tax_status` tax_status_type · `financial_ask_cents` bigint NOT NULL DEFAULT 0 ·
`seed_funding_goals_cents` · `budget_items` jsonb · `media_urls` jsonb · `visual_pitch_items` jsonb ·
`mission_statement` · `technical_summary` · `outreach_summary` · `tagline` · `logo_url` ·
`coach_photo_url` · `founded_year` · `team_size` · `seasons_competed` · `students_reached` ·
`events_hosted` · `volunteer_hours` · `past_sponsors` text[] · `press_links` jsonb ·
`public` bool DEFAULT **false** (inert — no policy grants anon) · `deleted_at` (soft delete)

**`submissions`** — `id` uuid PK · `team_id` FK→teams CASCADE · `sponsor_id` FK→sponsors CASCADE ·
`status` submission_status · `custom_pitch_alignment` · `specific_needs_statement` ·
`local_connection_notes` · `admin_feedback` · `reviewed_by` · `reviewed_at` · `submitted_at` ·
`sent_at` (**admin-gate marker**, only written by `approve_submission_atomic`) · `expires_at` ·
`resend_message_id` · `requested_amount_cents` bigint · `reserved_amount_cents` bigint ·
`is_locked` **GENERATED** · `deleted_at` · `season` (vestigial) · `variant_label` (vestigial)

**`sponsors`** — `id` uuid PK · `company_name` · `industry` · `website` · `logo_url` ·
`contact_name` · `contact_email` · `contact_title` · `funding_cap_cents` bigint ·
`funding_used_cents` bigint · `status` sponsor_status · `source` sponsor_source · `notes` ·
`geo_states` text[] (NULL = unrestricted) · `search_vector` tsvector
CHECK `funding_used_cents <= funding_cap_cents`.

**`transactions_ledger`** — `id` · `sponsor_id` NOT NULL FK **RESTRICT** · `team_id` NULLABLE
FK SET NULL · `submission_id` NULLABLE FK SET NULL · `amount_cents` bigint CHECK > 0 ·
`decision_type` text CHECK IN (`full`,`partial`) · `actor_type` text CHECK IN (`sponsor`,`admin`) ·
`created_at`. **Append-only** — no UPDATE/DELETE policies exist. A row = one *settled
commitment*, **not a payment**.

**`notifications`** · **`audit_log`** (append-only: `actor_id`, `action`, `entity_type`,
`entity_id`, `metadata` jsonb) · **`sponsor_applications`** (`contact_email` UNIQUE) ·
**`submission_access_tokens`** (`token_hash` sha256 UNIQUE, deny-all RLS) ·
**`team_achievements`** · **`ftc_teams_cache`** (`team_number` PK, `team_name`, `city`,
`state`, `country`, `last_synced`) · **`request_throttle`** (PK `(key, window_start)`, deny-all).

### Views

`v_sponsor_capacity` (invoker) · `v_sponsors_public` (**SECURITY DEFINER** since 0063 —
re-implements coach visibility internally) · `v_submission_summary` (invoker).

### Storage buckets

| Bucket | Public | Limit | MIME |
|---|---|---|---|
| `coach-credentials` | no | 5 MB | pdf, jpeg, png |
| `pitch-media`, `pitch-storage`, `visual-pitch-items` | yes | 5 MB | jpeg/png/webp/gif |
| `team-logos` | yes | 2 MB | jpeg/png/webp |

Folder policies partition by **Clerk user id**: the first path segment must equal
`auth.jwt()->>'sub'`.

---

## 3. Submission lifecycle

```
        coach autosave           coach submits          admin approves
  ∅ ─────────────────► draft ──────────────────► pending ──────────────► dispatched
                                                    │                        │
                       admin declines / requests    │      Resend webhook    ▼
                    ┌───────────────────────────────┘      ┌────────► delivered ──► opened
                    ▼                                      │              │            │
             declined / changes_requested ◄────────────────┘              │            │
                    │  (coach-editable → back to pending)                 │            │
                    │                            sponsor funds ───────────┴────────────┤
                    │                                                                  ▼
                    │                                                              approved
                    └── sponsor declines · bounce · 14-day expiry ──► declined/bounced/expired
```

Canonical groupings live in **`lib/submission-status.ts`** — import from there, do not
re-declare status arrays:

- `AWAITING_SPONSOR_STATUSES = ['dispatched','delivered','opened']` — the only states either
  decision RPC accepts
- `AWAITING_ADMIN_STATUSES = ['pending']`
- `TERMINAL_STATUSES = ['approved','declined','expired','bounced']`
- `COACH_EDITABLE_STATUSES = ['draft','declined','changes_requested']`
- helpers `isAwaitingSponsor()`, `isTerminal()`

Guardrails already in place: max 3 `pending` submissions per team per rolling 7 days;
one active submission per `(team_id, sponsor_id)` via unique partial index (23505 mapped to
a friendly message in `app/actions/submission.ts`).

---

## 4. Capacity / funding cap model — read before touching money

**Invariant:**
```
sponsors.funding_used_cents
  = SUM(submissions.reserved_amount_cents WHERE status IN ('dispatched','delivered','opened'))
  + SUM(transactions_ledger.amount_cents)
```

| Phase | Where | What happens |
|---|---|---|
| **RESERVE** | `approve_submission_atomic` (0047, hardened 0062) | Admin approval locks the sponsor row `FOR UPDATE`, checks `funding_used + ask > cap` → `insufficient_sponsor_capacity`, then sets `reserved_amount_cents = ask`, `funding_used_cents += ask`, `status='dispatched'`, `sent_at`, `expires_at = now()+14d`. Flips sponsor to `inactive` at cap. Mints an access token. |
| **SETTLE** | `sponsor_decide_submission_atomic` (portal, 0065) / `record_sponsor_decision_atomic` (token, 0071) | Writes one `transactions_ledger` row. **Never re-debits.** Partial releases the difference and may re-activate the sponsor. |
| **RELEASE** | `release_submission_reservation(id, new_status, reason)` (0047) | Accepts `expired|bounced|declined|changes_requested`, only from `dispatched|delivered|opened`. Subtracts and zeroes the reservation, re-activates sponsor. |
| **RELEASE ON DELETE** | `trg_release_reservation_on_delete` (0067) | BEFORE DELETE on submissions — catches the Clerk-account-deletion CASCADE, which runs no app code. |

**⚠️ This means "refund/capacity release logic" is ALREADY IMPLEMENTED.** Do not rebuild it.
Prompt `11` verifies it; nothing else should touch it.

Known gap noted for prompt authors: the token path (`record_sponsor_decision_atomic`) has no
`already_decided` ledger check — it relies solely on the single-use token.

---

## 5. The money gap (why prompts 01-06 exist)

**There is no payment or fulfillment layer of any kind.** No Stripe, no ACH, no invoice,
no disbursement state machine, no `paid`/`fulfilled` status, no reconciliation, no W-9,
no receipt, no agreement, no signature.

`transactions_ledger` records a *commitment*. The sponsor funding page
(`app/(sponsor)/sponsor/funding/page.tsx`) labels those rows **"Confirmed disbursements"**,
which is aspirational and currently untrue. The entire money handoff is a manual email
thread: `emails/handshake-email.tsx` tells the sponsor the coach "will send W-9 and payment
instructions" and wires `replyTo` so replies reach a human. **Nothing in the system ever
learns whether money moved.**

**Decision locked for this whole prompt pack: the platform NEVER touches funds.**
It is a pledge-and-track broker. No Stripe Connect, no escrow, no PCI scope, no
money-transmitter exposure. Sponsors pay teams directly by check/ACH/wire *outside* the app;
the platform tracks the fulfillment state, collects the paperwork, and issues receipts.

---

## 6. Notifications, email, and dispatch

**`lib/notify.ts`** — no sender ever throws. Every one returns
`{ success: boolean; error?: string }` and reports failures to Sentry.

```ts
createInAppNotification({
  recipientId: string,      // profiles.id
  type: 'submission_declined' | 'submission_approved' | 'submission_changes_requested'
      | 'coach_verified' | 'general',
  title: string,
  body?: string,
  submissionId?: string,
  skipEmail?: boolean,      // default false
}): Promise<NotifyResult>
```

Inserts into `notifications` **and** emails the recipient. Set `skipEmail: true` **only**
when the caller already sends a richer dedicated template for the same event.

Other senders: `sendSubmissionDecisionEmail`, `sendHandshakeEmail` (two cross-`replyTo`'d
messages, sha256 idempotency keys), `sendSponsorApplicationConfirmation`,
`sendSponsorApplicationAlert`, `sendCredentialUploadAlert`, `sendCoachVerificationEmail`,
`sendCoachDenialEmail`, `sendCoachSignupWelcomeEmail`, `sendWelcomeInAppNotification`.

**`lib/dispatch.ts` → `dispatchApprovedSubmission(submissionId, accessToken?, options?)`**
is the *only* path allowed to email a pitch to a sponsor. Idempotency key
`sha256(submissionId + 'sponsor' + accessToken)`. Never email a sponsor a pitch outside it.

`from` is always `env.RESEND_FROM_EMAIL`, forced to a `noreply@` address in production —
hence the explicit `replyTo` wiring everywhere.

New email templates go in `emails/*.tsx` using `@react-email/components`, and a matching
typed sender goes in `lib/notify.ts`. Never call Resend directly from an action.

---

## 7. The canonical server action shape

Every mutating action in `app/actions/*.ts` follows these five steps. Missing step 1, 2, 4,
or 5 on a sensitive action is a bug.

```ts
'use server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/actions-utils'
import { createInAppNotification } from '@/lib/notify'

const inputSchema = z.object({ /* ... */ })

export async function doThing(data: z.input<typeof inputSchema>) {
  // 1. VALIDATE — always safeParse, never parse
  const parsed = inputSchema.safeParse(data)
  if (!parsed.success) {
    return { error: 'Validation failed: ' + parsed.error.issues.map(i => i.message).join(', ') }
  }

  // 2. AUTH / ROLE
  let user, supabase, adminClient
  try {
    ({ user, supabase, adminClient } = await requireAdmin())
  } catch (e: any) {
    return { error: e.message }   // surface e.code === 'NEEDS_VERIFICATION' where relevant
  }

  // 3. MUTATE — server client respects RLS; admin client bypasses it
  const { data: row, error } = await supabase.from('table').insert({ /* ... */ }).select().single()
  if (error) return { error: error.message }

  // 4. AUDIT — always via the admin client; audit_log is RLS-protected
  await adminClient.from('audit_log').insert({
    actor_id: user.id, action: 'do_thing', entity_type: 'table', entity_id: row.id,
    metadata: { /* ... */ },
  })

  // 5. NOTIFY
  await createInAppNotification({ recipientId: row.owner_id, type: 'general', title: '…' })

  return { success: true }
}
```

Reference implementations: `app/actions/submission.ts`, `app/actions/admin.ts`,
`app/actions/moderation.ts`, `app/actions/auth.ts`.

### Zod conventions — `lib/schemas/*`

- Always `safeParse`. Return joined issue messages.
- Reuse field helpers: `plainTextField(min,max,…)` (HTML→plain text) in `submission.ts`;
  `richTextField(min,max,…)` (DOMPurify-sanitized) in `team.ts`. `min = null` means optional.
- Max lengths live in **`lib/schemas/limits.ts`** — reference the constants, never hardcode.
- Passwords are owned by Clerk (12+, upper/lower/number) — no password Zod schema.

---

## 8. Migration rules — read every line, these are load-bearing

1. **Numbered, sequential, idempotent.** `IF NOT EXISTS`, `CREATE OR REPLACE`, enum values
   pre-declared at type creation so a from-scratch replay works. Next free number: **`0076`**.
2. **Apply with `psql -f <file>`** (or `supabase db reset --linked`). The Supabase CLI's
   statement splitter mishandles files defining multiple `$$`-quoted functions
   ("cannot insert multiple commands into a prepared statement"). Any file with `$$` blocks
   **must** go through `psql -f`.
3. **New table → `ENABLE ROW LEVEL SECURITY` + explicit per-role policies.** Resolve the
   caller with `current_profile_id()` / `is_admin()` / `is_coach_verified()`, **never
   `auth.uid()`**.
4. **New SECURITY DEFINER function → explicitly**
   `REVOKE EXECUTE ON FUNCTION … FROM PUBLIC, anon, authenticated;`
   `GRANT EXECUTE ON FUNCTION … TO service_role;`
   Postgres defaults to PUBLIC. This bit the project once already (0062).
5. **Any function using `gen_random_bytes` / `digest` needs `SET search_path = public, extensions`** —
   pgcrypto lives in `extensions` (0059).
6. **Use `is_trusted_server_context()`, never `(auth.jwt()->>'sub') IS NULL`** — the anon key
   satisfies the latter and it fails open (0072).
7. **Adding a column to `submissions` makes it coach-unwritable by default.**
   `guard_submission_writable_columns()` fails closed against an allowlist. If coaches must
   write your new column, add it to that allowlist explicitly, in the same migration.
8. **Anything reading `submissions` or `teams` from inside a `teams` RLS policy must go
   through a SECURITY DEFINER function**, or you get 42P17 policy recursion (0066).
9. If a server operation legitimately needs to cross rows (audit, dispatch, admin views),
   route it through the **admin client** rather than loosening a policy.

---

## 9. Directory map

```
app/(account|admin|auth|coach|public|sponsor)/   route groups (parens not in the URL)
app/actions/*.ts        account · admin · auth · credentials · moderation · notifications
                        · sponsor-decision · sponsor · submission · team
app/api/
  admin/export          CSV/data export (admin-only)
  admin/queue/count     moderation queue badge
  coach/notifications/unread
  cron/expire-submissions   daily 02:00 UTC, scheduled in vercel.json
  health                public health check
  webhooks/clerk        user.deleted + email sync
  webhooks/resend       delivery events
lib/supabase/{client,server,admin,types}.ts
lib/schemas/*.ts        auth · submission · team · sponsor · sponsor-signup · achievement · limits
lib/actions-utils.ts    auth guards + getClientIp
lib/notify.ts           createInAppNotification + typed email senders
lib/dispatch.ts         gated sponsor outreach
lib/dispatch-budget.ts  mapBudgetItems (pure; split out to avoid import-time Resend client)
lib/submission-status.ts  canonical status groupings
lib/env.ts              Zod-validated env (warns in dev, throws in prod)
lib/ftc-roster.ts       FTC team lookup (currently FTCScout + ftc_teams_cache)
lib/site-config.ts      centralised landing copy, theme accents, static fixtures
lib/dev-bypass.ts       NEXT_PUBLIC_DEV_AUTH_BYPASS=true  → mock admin
lib/dev-preview.ts      NEXT_PUBLIC_SPONSOR_PREVIEW=1     → mock sponsor
lib/dev-coach-preview.ts NEXT_PUBLIC_COACH_PREVIEW=1      → mock coach
middleware.ts           clerkMiddleware + public route matcher
emails/*.tsx            React Email templates
supabase/migrations/    numbered, idempotent (latest 0075)
tests/                  Playwright E2E + global-setup.ts
lib/__tests__/          Vitest unit tests
```

All three dev-preview modes are **forced off in production builds**. When you add a feature
to a portal, extend the matching fixture file so the preview mode still renders.

---

## 10. Commands

```bash
npm run dev                  # Next dev
npm run dev:admin-preview    # admin portal, no sign-in, static mocks
npm run dev:sponsor-preview  # sponsor portal, static fixtures
npm run dev:coach-preview    # coach portal, static fixtures

npm run typecheck            # tsc --noEmit      ← required before every commit
npm run lint                 # eslint            ← required before every commit
npm run build                # next build        ← required before every commit
npm run test                 # vitest run
npx playwright test          # E2E (needs SUPABASE_LOCAL)

node scripts/seed-test-accounts.mjs   # wipes + recreates test users. Clerk test OTP: 424242
psql -f supabase/migrations/00XX_name.sql   # how migrations are applied
```

**Deploys are manual.** Pushing to `main` does **not** deploy — there is no Git connection
on the Vercel project. Ship with:

```bash
vercel deploy --prod --yes
```

Keep the `jsdom` / `cssstyle` pins in `package.json` `overrides` — they fix a runtime
`ERR_REQUIRE_ESM` in the serverless bundle. Never re-add `--webpack`.

### Environment variables

Validated in `lib/env.ts`. Runtime values live in the **Vercel project**, not `.env.local`.
Current required set: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`,
`CLERK_WEBHOOK_SIGNING_SECRET`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`,
`RESEND_WEBHOOK_SECRET`, `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`, optional `SENTRY_DSN`,
optional `ADMIN_NOTIFICATION_EMAILS`.

**Adding an env var? You must update `lib/env.ts` AND add it in Vercel**, or production
throws on the first request.

Supabase keys must be the **legacy JWT** keys (`eyJ…`). The new `sb_secret_` key is rejected
(401) by REST.

**No Upstash/Redis.** Rate limiting is the in-Postgres `check_throttle` RPC. Do not
reintroduce those env vars.

---

## 11. House rules for every prompt in this folder

1. **Read `CLAUDE.md` and `.claude/rules/*.md` first.** They override defaults.
2. **Never break a Core Mandate** (§0) to satisfy a prompt. If a prompt appears to require
   it, stop and report.
3. **One prompt = one shippable slice.** The repo must be green (`typecheck`, `lint`,
   `build`, `test`) at the end of every prompt. Never leave a half-migrated state.
4. **Do not refactor outside the prompt's scope.** No drive-by renames, no dependency bumps,
   no reformatting untouched files.
5. **Do not invent a new architectural pattern** when an existing one fits. Match the
   surrounding code's idiom, comment density, and naming.
6. **Every new table gets RLS + per-role policies in the same migration.**
7. **Every new sensitive action writes to `audit_log`.**
8. **Every new user-visible state change notifies via `createInAppNotification`.**
9. **New dependencies require justification.** Prefer what is already in `package.json`.
10. **If you are unsure, stop and ask.** A wrong assumption here is a production bug in a
    system that handles money commitments and adult-verified identity.
