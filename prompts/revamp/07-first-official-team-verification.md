# Prompt 07 — Official FIRST Team Verification

> **Prerequisites:** None
> **Reserved migration:** `0081_ftc_official_verification.sql` — verify it is still free with `ls supabase/migrations | tail -3`
> **Scope:** large · ~14 files
> **Leaves the repo:** green and shippable on its own

## Why this exists

A corporate sponsor is about to wire four figures to a robotics team on the strength of a
number typed into a signup form. Today nothing on this platform proves that FTC Team #12345
is who the coach says it is — the number is checked against a community-run mirror for mere
*existence*, on one of four code paths, and the team **name** and **organization** the coach
typed are never compared with anything. "How do you verify the team is real?" is the second
question every corporate giving officer asks, and the honest answer right now is "we look it
up on a third-party site, sometimes."

## Current state (verified)

**Read this section carefully — the common assumption that "team verification does not exist"
is wrong. It is half-built, and the missing half is not the half people expect.**

### What exists

`lib/ftc-roster.ts` (75 lines, the whole file):

- `export interface FTCTeam { team_number, team_name, city, state, country }`
- `fetchFromFTCScout(teamNumber)` — POSTs a GraphQL `teamByNumber(number: N)` query to
  `https://api.ftcscout.org/graphql` with `AbortSignal.timeout(5000)`. Returns `null` on any
  non-OK response, missing `data.teamByNumber`, or thrown error. **FTCScout is a
  community-run mirror, not FIRST.**
- `export async function validateFTCTeam(teamNumber): Promise<FTCTeam | null>` — builds an
  **admin client** (`createAdminClient() as any`), reads `ftc_teams_cache` by `team_number`,
  and **returns the cached row immediately if one exists**. There is no TTL check on
  `last_synced`, so a row cached once is never refreshed. On a cache miss it calls FTCScout
  and upserts the result with `last_synced`.

`supabase/migrations/0003_ftc_cache.sql` creates the cache:
`team_number integer PRIMARY KEY · team_name text NOT NULL · city text · state text ·
country text · last_synced timestamptz NOT NULL DEFAULT now()`. RLS is enabled;
`0051_clerk_auth.sql:287-289` re-creates the only policy, `cache_select`
`USING ((auth.jwt() ->> 'sub') IS NOT NULL)`. There is **no** INSERT/UPDATE policy — writes
are service-role only, which is why `validateFTCTeam` uses the admin client.

Generated types for the table live in `lib/supabase/types.ts:80-105`.

### Where it is actually called — the enforcement answer

`grep` for `validateFTCTeam` returns **exactly two call sites, both in `app/actions/team.ts`**:

1. **`lookupFTCTeam(teamNumber)`** (`app/actions/team.ts:30-42`) — a server action with
   **no auth guard of any kind**. Called from `components/auth/signup-wizard.tsx:189`
   (`handleLookup`), which writes the returned `team_name` / `city` / `state` into the form.
   This is **autofill, not enforcement**: the coach can edit every field afterwards and
   nothing re-checks.
2. **`createTeam(data)`** (`app/actions/team.ts:61-66`) — when
   `status === 'existing' && ftcTeamNumber`, calls `validateFTCTeam` and returns an error if
   it is `null`. **Existence only.** `payloadData.teamName` and `payloadData.organization` are
   inserted verbatim and never compared with the roster record.

### Where it is NOT called — and this is the important part

- **`verifyCoach`** (`app/actions/admin.ts:75-129`) is the *primary* team-creation path: when
  an admin verifies a coach, the team row is provisioned directly from
  `profiles.pending_team_data` (untyped jsonb, written at signup by
  `provisionCoachProfile` in `app/actions/auth.ts:98`). It never calls `validateFTCTeam`.
  Its only roster-adjacent logic is a downgrade to `status='incubator'` when the number is
  missing (`admin.ts:84-89`).
- **`app/(coach)/dashboard/page.tsx:106-171`** is a second provisioning fallback from the same
  jsonb. Also unvalidated.
- **`updateTeam`** (`app/actions/team.ts:281-282`) writes `status` and `ftc_team_number` with
  zero roster check. This is the incubator→existing graduation path invoked from
  `components/coach/dashboard-shell.tsx`.

So: **the path most teams are actually created through performs no verification at all**, and
the one path that does verifies only that the number exists somewhere on FTCScout.

### Constraints already in the schema

- `existing_team_requires_number` — `0001_init.sql:86-88`,
  `CHECK (status != 'existing' OR ftc_team_number IS NOT NULL)`.
- `idx_teams_ftc_number` — `0001_init.sql:193-195`, a **plain (non-unique)** partial index on
  `teams(ftc_team_number) WHERE ftc_team_number IS NOT NULL`. Two team rows may therefore
  claim the same FTC number today. Do not change that in this slice (see Out of scope).

### What is missing

1. The **official FIRST source**. Everything currently routes through a community mirror.
2. Any **cross-check of the coach-supplied team name / organization** against the official
   record.
3. **Enforcement** on the paths that actually create teams.
4. Any **record** of what was checked, against what, when, and with what outcome.
5. Any **refresh** — a cached row is permanent.

## What you are building

1. **`lib/first-api.ts`** — a typed client for the official FIRST Events API
   (`https://ftc-api.firstinspires.org/v2.0/`), HTTP Basic auth, season-aware, with a
   graceful "source unavailable" result rather than a throw.
2. **Two new environment variables** — `FIRST_API_USERNAME`, `FIRST_API_TOKEN`. **Both must be
   added to `lib/env.ts` AND set in Vercel** (`vercel env add FIRST_API_USERNAME production`,
   same for the token), or the official source silently never engages in production. Register
   for free at <https://ftc-events.firstinspires.org/services/API>; the token arrives by email.
3. **Migration `0081`** — extend `ftc_teams_cache` with the official fields plus `source` and
   `verified_at`; create `team_verification_records` with RLS.
4. **`lib/ftc-team-match.ts`** — a pure, network-free fuzzy comparison producing a confidence
   score, so the scoring rules are unit-testable in isolation.
5. **Rewritten `lib/ftc-roster.ts`** — `validateFTCTeam` keeps its exact current signature and
   behaviour contract (callers must not change) but gains a TTL and the official source first;
   a new `verifyFTCTeamIdentity()` performs the cross-check and returns a three-way outcome.
6. **Enforcement** on all four team-creation/mutation paths, with a policy per path that never
   locks a legitimate coach out (see "Enforcement policy" below).
7. **Admin override** — a server action that records an override with a required reason into
   both `team_verification_records` and `audit_log`.
8. **Nightly roster refresh cron** — `/api/cron/refresh-ftc-roster`, registered in
   `vercel.json`, protected by `CRON_SECRET`.
9. **Admin review surface** — the pending-review records rendered on the existing coach
   verification card so an admin can see and resolve a mismatch.

### The official FIRST Events API, concretely

```
GET https://ftc-api.firstinspires.org/v2.0/{season}/teams?teamNumber={n}
Authorization: Basic base64("{FIRST_API_USERNAME}:{FIRST_API_TOKEN}")
Accept: application/json
```

`{season}` is the **starting** calendar year of the FTC season (the 2025–2026 season is
`2025`). Compute it: `month >= 5 (May) ? year : year - 1`. Response shape:

```jsonc
{ "teams": [ {
    "teamNumber": 12345,
    "nameFull": "Acme High School Robotics Boosters/Acme High School",  // org / sponsors
    "nameShort": "The Gearheads",                                        // team name
    "schoolName": "Acme High School",
    "city": "Austin", "stateProv": "TX", "country": "USA",
    "rookieYear": 2019, "districtCode": null, "homeCMP": "Houston"
} ], "teamCountTotal": 1, "teamCountPage": 1 }
```

Map to the cache as: `team_name ← nameShort` (fall back to `nameFull` when short is empty),
`official_team_name ← nameShort`, `organization ← schoolName ?? nameFull`,
`rookie_year ← rookieYear`, `district_code ← districtCode`, `region_code ← homeCMP`,
`city/state/country ← city/stateProv/country`.

### Enforcement policy — per path, and why it differs

Verification must never strand a real coach mid-onboarding. Apply exactly this:

| Path | `auto_pass` | `needs_review` | `rejected` | source `unavailable` |
|---|---|---|---|---|
| `createTeam` (coach, `status='existing'`) | proceed | proceed, record written, admin notified | **block** with an actionable error + "request admin review" copy | proceed, record `outcome='unavailable'` |
| `updateTeam` graduation (`status`→`existing` or `ftc_team_number` changes) | proceed | proceed + record + notify | **block** | proceed + record |
| `verifyCoach` provisioning (`app/actions/admin.ts`) | proceed | proceed + record; add to the existing `provisioningWarning` string | provision as `status='incubator'` (the file already has that downgrade branch at `admin.ts:84-89`) and warn the admin — **never block the coach's verification** | proceed + record |
| `app/(coach)/dashboard/page.tsx` fallback | same as `verifyCoach` | same | same | same |
| `status='incubator'` (any path) | **skipped entirely** — an incubator team legitimately has no number | | | |

## Data model

```sql
-- ── 1. ftc_teams_cache: official fields, provenance, freshness ────────────────
-- ADD COLUMN IF NOT EXISTS carries its inline CHECK, and the whole clause is
-- skipped when the column already exists — so this is idempotent without a DO block.
ALTER TABLE ftc_teams_cache ADD COLUMN IF NOT EXISTS official_team_name text;
ALTER TABLE ftc_teams_cache ADD COLUMN IF NOT EXISTS organization       text;
ALTER TABLE ftc_teams_cache ADD COLUMN IF NOT EXISTS rookie_year        integer;
ALTER TABLE ftc_teams_cache ADD COLUMN IF NOT EXISTS region_code        text;
ALTER TABLE ftc_teams_cache ADD COLUMN IF NOT EXISTS district_code      text;
ALTER TABLE ftc_teams_cache ADD COLUMN IF NOT EXISTS source             text NOT NULL DEFAULT 'ftcscout'
  CHECK (source IN ('first_api', 'ftcscout', 'manual'));
ALTER TABLE ftc_teams_cache ADD COLUMN IF NOT EXISTS verified_at        timestamptz;

CREATE INDEX IF NOT EXISTS idx_ftc_cache_stale
  ON ftc_teams_cache (last_synced);

COMMENT ON COLUMN ftc_teams_cache.source IS
  'Where this row came from. first_api = official FIRST Events API (authoritative); '
  'ftcscout = community mirror fallback; manual = admin-entered override.';

-- ── 2. team_verification_records ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_verification_records (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nullable: a check runs BEFORE the teams row exists (createTeam, verifyCoach
  -- provisioning). Backfilled by the caller once the row is inserted.
  team_id               uuid REFERENCES teams(id)    ON DELETE CASCADE,
  profile_id            uuid REFERENCES profiles(id) ON DELETE SET NULL,
  ftc_team_number       integer NOT NULL,
  claimed_team_name     text    NOT NULL,
  claimed_organization  text,
  official_team_name    text,
  official_organization text,
  source                text NOT NULL
    CHECK (source IN ('first_api', 'ftcscout', 'cache', 'manual', 'none')),
  name_score            numeric(4,3) NOT NULL DEFAULT 0,
  organization_score    numeric(4,3),
  confidence            numeric(4,3) NOT NULL DEFAULT 0,
  outcome               text NOT NULL
    CHECK (outcome IN ('auto_pass', 'needs_review', 'rejected', 'overridden', 'unavailable')),
  override_reason       text,
  overridden_by         uuid REFERENCES profiles(id) ON DELETE SET NULL,
  overridden_at         timestamptz,
  checked_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT override_requires_reason CHECK (
    outcome <> 'overridden' OR (override_reason IS NOT NULL AND overridden_by IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_tvr_team_id       ON team_verification_records (team_id);
CREATE INDEX IF NOT EXISTS idx_tvr_needs_review  ON team_verification_records (checked_at DESC)
  WHERE outcome = 'needs_review';
CREATE INDEX IF NOT EXISTS idx_tvr_ftc_number    ON team_verification_records (ftc_team_number);

ALTER TABLE team_verification_records ENABLE ROW LEVEL SECURITY;
```

**RLS policies (all in `0081`, `DROP POLICY IF EXISTS` before each `CREATE`):**

- `tvr_select_admin` — `FOR SELECT USING (is_admin())`. Admins see every record.
- `tvr_select_own` — `FOR SELECT USING (profile_id = current_profile_id() OR EXISTS (SELECT 1
  FROM teams t WHERE t.id = team_verification_records.team_id AND t.owner_id =
  current_profile_id()))`. A coach sees only checks about their own claim/team. The sublink on
  `teams` is safe: the 42P17 hazard documented in `0066` applies to sublinks written *inside a
  policy on `teams`*, and every `teams` policy stays sublink-free.
- **No INSERT / UPDATE / DELETE policies.** RLS denies by default, so the table is
  service-role-write-only — the same append-only idiom as `audit_log` (`0001`) and
  `transactions_ledger` (`0017`/`0069`). Every write in this slice goes through the admin
  client.
- `ftc_teams_cache` keeps its existing `cache_select` policy unchanged; the new columns inherit
  it. Do not add a write policy — the roster writer is the admin client.

**No new SECURITY DEFINER function is required by this slice.** If you find you need one, it
must carry `REVOKE EXECUTE ON FUNCTION … FROM PUBLIC, anon, authenticated;` +
`GRANT EXECUTE ON FUNCTION … TO service_role;` (see `_CONTEXT.md` §8.4).

**`lib/supabase/types.ts` is hand-maintained** — there is no codegen script in
`package.json`. Add the new `ftc_teams_cache` columns and the full
`team_verification_records` Row/Insert/Update/Relationships block by hand, matching the
surrounding style, or `npm run typecheck` will fail on every new column.

### TypeScript surface

```ts
// lib/ftc-team-match.ts — pure, no imports beyond node builtins
export function normalizeTeamName(raw: string): string
export function similarity(a: string, b: string): number            // 0..1, Dice bigram
export interface MatchResult {
  nameScore: number
  organizationScore: number | null
  confidence: number
  outcome: 'auto_pass' | 'needs_review' | 'rejected'
}
export function scoreTeamMatch(input: {
  claimedTeamName: string
  claimedOrganization?: string | null
  officialTeamName: string | null
  officialOrganization?: string | null
}): MatchResult

// lib/first-api.ts
export interface FirstApiTeam {
  teamNumber: number; nameShort: string | null; nameFull: string | null
  schoolName: string | null; city: string | null; stateProv: string | null
  country: string | null; rookieYear: number | null
  districtCode: string | null; homeCMP: string | null
}
export type FirstApiResult =
  | { status: 'found';       team: FirstApiTeam }
  | { status: 'not_found' }                       // API answered, roster has no such team
  | { status: 'unavailable'; reason: string }     // creds missing, timeout, 5xx, 429
export async function fetchTeamFromFirstApi(teamNumber: number): Promise<FirstApiResult>
export function currentFtcSeason(now?: Date): number

// lib/ftc-roster.ts
export interface FTCTeam { /* UNCHANGED — do not alter the existing shape */ }
export async function validateFTCTeam(teamNumber: number): Promise<FTCTeam | null>
export interface VerificationOutcome {
  outcome: 'auto_pass' | 'needs_review' | 'rejected' | 'unavailable'
  confidence: number
  source: 'first_api' | 'ftcscout' | 'cache' | 'none'
  official: FTCTeam | null
  officialOrganization: string | null
  recordId: string | null      // team_verification_records.id, always written
  message: string              // coach-facing copy, safe to render
}
export async function verifyFTCTeamIdentity(input: {
  teamNumber: number
  claimedTeamName: string
  claimedOrganization?: string | null
  profileId: string
  teamId?: string | null
}): Promise<VerificationOutcome>
export async function refreshStaleRosterEntries(limitRows?: number): Promise<{ refreshed: number; failed: number }>
```

**Scoring rules (implement exactly, they are the contract the tests assert):**

- `normalizeTeamName`: lowercase; strip diacritics (`normalize('NFD').replace(/\p{Diacritic}/gu,'')`);
  drop a leading `#?\d+\s*` team-number prefix; remove the noise tokens
  `team, robotics, ftc, first, the, and, inc, llc, high, school, academy, club, program`;
  collapse non-alphanumerics to single spaces; trim.
- `similarity`: Sørensen–Dice on character bigrams of the normalized strings. Identical → 1.
  Either side empty → 0.
- `confidence = organizationScore === null ? nameScore : 0.75 * nameScore + 0.25 * organizationScore`.
- Thresholds: `confidence >= 0.85` → `auto_pass`; `>= 0.55` → `needs_review`; else `rejected`.
- A `nameScore >= 0.95` short-circuits to `auto_pass` regardless of organization — teams
  routinely list a different sponsor org than the coach types.

**`validateFTCTeam` behaviour changes (signature and return type unchanged):**

- Cache hit **and** `last_synced > now() - 14 days` → return the cached row (as today).
- Cache hit but stale, or cache miss → try `fetchTeamFromFirstApi`; on `found`, upsert with
  `source='first_api'`, `verified_at=now()`, `last_synced=now()` and return it.
- On `not_found` from the official API, retry once against `currentFtcSeason() - 1` before
  giving up — a team that has not re-registered for the current season is still a real team.
- On `unavailable`, or `not_found` in both seasons, fall back to `fetchFromFTCScout` exactly as
  today (`source='ftcscout'`).
- If every source fails but a **stale cached row exists, return the stale row** rather than
  `null`. Returning `null` would break `createTeam` for every existing coach the moment FIRST
  has an outage.

## Server actions

| Action | File | Guard | Zod schema | `audit_log` action | Notification |
|---|---|---|---|---|---|
| `lookupFTCTeam(teamNumber)` (**modify**) | `app/actions/team.ts` | add `requireAuth()` — it currently has **no guard at all**; catch and return `{ error }` | inline `z.number().int().min(1).max(999999)` (replace the hand-rolled `if (!teamNumber \|\| teamNumber <= 0)`) | none (read-only) | none |
| `createTeam(data)` (**modify**) | `app/actions/team.ts` | `requireAuth()` (unchanged) | `teamOnboardingSchema` (unchanged) | existing `create_team`; add `verification: { outcome, confidence, source, record_id }` to `metadata` | on `needs_review`, `createInAppNotification` to every admin (resolve via `profiles.role='admin'`), `type: 'general'` |
| `updateTeam(id, data)` (**modify**) | `app/actions/team.ts` | `requireAuth()` (unchanged) | `teamOnboardingBaseSchema.partial()` (unchanged) | existing `update_team`; add the same `verification` metadata **only when the check ran** | same as `createTeam` |
| `verifyCoach(coachId, verified)` (**modify**) | `app/actions/admin.ts` | `requireAdmin()` (unchanged) | `verifyCoachSchema` (unchanged) | existing `verify_coach`; add `verification` metadata | none new — fold the outcome into the existing `provisioningWarning` string |
| `overrideTeamVerification(input)` (**new**) | `app/actions/admin.ts` | `requireAdmin()` | new `teamVerificationOverrideSchema` in `lib/schemas/team.ts`: `{ recordId: z.string().uuid(), reason: z.string().trim().min(20, 'Give a reason of at least 20 characters').max(LIMITS.<pick the existing feedback-length constant>) }` | `override_team_verification`, `entity_type: 'team_verification_records'`, metadata `{ ftc_team_number, previous_outcome, reason }` | `createInAppNotification` to the team owner, `type: 'general'`, "Your team number has been manually verified" |

`overrideTeamVerification` writes `outcome='overridden'`, `override_reason`, `overridden_by =
user.id`, `overridden_at = now()` through the **admin client** (the table has no UPDATE policy),
and — when the record's team is still `incubator` because of a rejection — flips it to
`existing` with the recorded `ftc_team_number`.

All five follow the canonical 5-step shape in `_CONTEXT.md` §7. Never `parse`, always
`safeParse`.

## UI

- **`components/auth/signup-wizard.tsx`** — `handleLookup` already autofills from
  `lookupFTCTeam`. Add, below the team-name field, a small provenance line rendered from the
  new response: "Verified against the official FIRST roster" (`source: 'first_api'`) /
  "Matched via FTCScout — pending official confirmation" (`'ftcscout'`) / "The FIRST roster is
  temporarily unavailable; an admin will confirm your team number after signup"
  (`'unavailable'`). No blocking at signup — the wizard writes `pending_team_data`, it does not
  create the team.
- **`components/coach/dashboard-shell.tsx`** (graduation flow) — surface a `rejected` outcome
  inline: the official name on record, the name entered, and a "Request admin review" button
  wired to a plain `createInAppNotification` to admins. Do not silently swallow the error.
- **`components/admin/coach-verification-card.tsx`** — add a verification block showing
  `claimed_* vs official_*`, the confidence as a percentage, the source badge, and an
  **Override** dialog collecting the mandatory reason (min 20 chars, client-side counter
  mirroring the Zod rule).
- **States, all four required on every new surface:** *loading* — skeleton on the lookup
  button, disabled while pending; *empty* — "No verification record yet" on the admin card for
  incubator teams; *error* — the roster-unavailable copy above, never a raw fetch error;
  *permission-denied* — the override dialog renders only for `role === 'admin'`, and
  `overrideTeamVerification` re-checks with `requireAdmin()` regardless of what the UI shows.
- **Preview fixtures** — `lib/dev-bypass.ts` already carries `pending_team_data` fixtures at
  lines 82 and 92. Add a `team_verification_records` fixture set to
  `createMockSupabaseClient()` there and to `lib/dev-coach-preview.ts`, or
  `npm run dev:admin-preview` renders the new admin block against `undefined`.

## Cron

Create `app/api/cron/refresh-ftc-roster/route.ts`. Copy the auth preamble from
`app/api/cron/expire-submissions/route.ts` **verbatim** — `Authorization: Bearer`, length check
before `crypto.timingSafeEqual`, the `try/catch` around it, 401 on any failure. Then call
`refreshStaleRosterEntries(200)`, which re-fetches the 200 rows with the oldest `last_synced`
older than 14 days through the official API, and writes one `audit_log` row
(`actor_id: null, action: 'cron_refresh_ftc_roster'`, metadata `{ refreshed, failed }`) —
matching how the existing cron records its run.

Register it in `vercel.json` alongside the existing entry:

```jsonc
{ "crons": [
  { "path": "/api/cron/expire-submissions",  "schedule": "0 2 * * *" },
  { "path": "/api/cron/refresh-ftc-roster",  "schedule": "0 3 * * *" }
]}
```

`/api/cron(.*)` is already public in `middleware.ts` — do **not** add a new matcher entry.
Vercel Hobby permits a limited number of cron jobs; if the deploy rejects the second entry,
report it rather than deleting the existing one.

## Out of scope

- Making `idx_teams_ftc_number` UNIQUE / preventing two teams from claiming one number. It is
  a real gap; it is a separate migration with a data-cleanup step.
- Verifying the *coach's* affiliation with the team (that is the photo-ID flow, already built).
- Any FIRST API surface beyond `/teams` — no events, awards, rankings, or scores.
- Backfilling verification records for teams that already exist. The nightly cron refreshes the
  cache; historical rows stay unverified until they are next edited.
- Blocking submissions on verification state. `submissions` is untouched by this slice.
- Rate limiting the FIRST API beyond the built-in cache TTL.

## Guardrails specific to this slice

- **Never let a verification failure block coach verification.** `verifyCoach` must still
  verify the coach and still provision *something*. The downgrade-to-`incubator` branch at
  `app/actions/admin.ts:84-89` already exists — reuse it, do not invent a new failure mode.
- **`validateFTCTeam`'s signature and return type are load-bearing.** `createTeam` and
  `lookupFTCTeam` both destructure `FTCTeam`. Changing the shape breaks
  `components/auth/signup-wizard.tsx:194-197`, which reads `result.team.team_name/city/state`.
- **`lookupFTCTeam` has no auth guard today** and hits an external API on every call. Adding
  `requireAuth()` is part of this slice, not a drive-by refactor — an unauthenticated
  server action that proxies an outbound request is an open relay.
- **Never `throw` out of the FIRST client.** Follow the `lib/notify.ts` idiom: every sender
  returns a result object and reports to Sentry. A FIRST outage must degrade to
  `outcome: 'unavailable'`, not a 500 on the signup wizard.
- **`AbortSignal.timeout`** — match the existing 5000 ms budget in `fetchFromFTCScout`. Two
  sequential 5 s calls (official then FTCScout) already risks the serverless timeout; do not
  add a third hop.
- **New env vars must be `.optional()` in `lib/env.ts`.** They cannot be required: `lib/env.ts`
  throws in production on a missing required var, and the build phase warning path
  (`isBuildPhase`) would mask it until the first live request. Missing creds ⇒ the official
  source is skipped and `fetchTeamFromFirstApi` returns `{ status: 'unavailable' }`.
  **Set both in Vercel before deploying** (`_RUNNER.md` Phase 4 step 17).
- **`team_verification_records` gets no write policy.** Every insert/update goes through
  `createAdminClient()`. If you find yourself adding a policy to make a write succeed, you are
  writing from the wrong client.
- **COPPA:** the FIRST API response includes school names and locations, never student names.
  Persist only the fields listed in the DDL. Do not store `nameFull` verbatim into a
  coach-visible column without checking it — it is a sponsor/org string, not a person.
- **Idempotency:** `ADD COLUMN IF NOT EXISTS … CHECK (…)` is idempotent because the whole
  clause is skipped when the column exists. A bare `ADD CONSTRAINT` is **not** — do not use one.
- Migration `0081` contains no `$$` blocks; it can go through the Supabase CLI. Apply it with
  `psql -f` anyway, for consistency with every other migration in this repo.

## Files you will touch

**Create:**
- `supabase/migrations/0081_ftc_official_verification.sql`
- `lib/first-api.ts`
- `lib/ftc-team-match.ts`
- `app/api/cron/refresh-ftc-roster/route.ts`
- `lib/__tests__/ftc-team-match.test.ts`
- `lib/__tests__/first-api.test.ts`
- `tests/e2e/team-verification.spec.ts`

**Modify:**
- `lib/ftc-roster.ts`
- `lib/env.ts`
- `lib/supabase/types.ts`
- `app/actions/team.ts`
- `app/actions/admin.ts`
- `lib/schemas/team.ts`
- `app/(coach)/dashboard/page.tsx`
- `components/auth/signup-wizard.tsx`
- `components/coach/dashboard-shell.tsx`
- `components/admin/coach-verification-card.tsx`
- `lib/dev-bypass.ts`, `lib/dev-coach-preview.ts`
- `vercel.json`

## Tests

**Vitest — `lib/__tests__/ftc-team-match.test.ts`** (pure, no network, no DB):

- `normalizeTeamName` strips a `#12345 ` prefix, diacritics, and the noise-token list.
- Exact match after normalization → `nameScore === 1`, `auto_pass`.
- `"The Gearheads"` vs `"Gearheads Robotics Team"` → `auto_pass`.
- `"Gearheads"` vs `"Iron Panthers"` → `rejected`.
- A near miss (`"Gear Heads"` vs `"The Gearheads"` with mismatched orgs) lands in
  `needs_review`, proving the band is reachable — a threshold pair that can never produce
  `needs_review` is a bug.
- `officialTeamName: null` → `confidence === 0`, and the caller maps that to `unavailable`,
  not `rejected`.
- `nameScore >= 0.95` short-circuits past a 0-scoring organization.

**Vitest — `lib/__tests__/first-api.test.ts`** (`vi.stubGlobal('fetch', …)`):

- Missing credentials → `{ status: 'unavailable' }` and **fetch is never called**.
- `Authorization` header is exactly `Basic ` + `base64('user:token')`.
- HTTP 401 / 429 / 500 → `unavailable`, never a throw.
- `{ teams: [] }` → `not_found`, and the caller retries `currentFtcSeason() - 1` exactly once.
- Timeout (a fetch that rejects with `AbortError`) → `unavailable`, never a throw.
- `currentFtcSeason(new Date('2026-04-30'))` === 2025; `currentFtcSeason(new Date('2026-05-01'))` === 2026.

**Playwright — `tests/e2e/team-verification.spec.ts`:**

- Coach graduating an incubator team with a mismatched name sees the rejection copy and the
  team's `status` stays `incubator`.
- Admin sees the pending-review block and can override with a reason; a reason under 20
  characters is rejected by the server action, not only by the form.

**Security-boundary tests — MANDATORY, at the database layer, not only the action layer.**
Run each with a Supabase client carrying the *other* user's Clerk token (the pattern
`tests/global-setup.ts` establishes), and assert PostgREST itself denies:

- A coach `SELECT` on `team_verification_records` returns **only** rows where they are
  `profile_id` or own the `team_id`. Another coach's record → 0 rows.
- A sponsor `SELECT` on `team_verification_records` → 0 rows (no sponsor branch exists).
- A coach `INSERT` / `UPDATE` / `DELETE` on `team_verification_records` → denied (no policy).
- A coach `UPDATE` on `ftc_teams_cache` → denied (no write policy).
- `overrideTeamVerification` called as a coach returns `{ error: 'Forbidden' }`, and the
  record is unchanged in the database afterwards.
- `GET /api/cron/refresh-ftc-roster` with no `Authorization` header → 401; with a wrong
  bearer → 401.

## Acceptance criteria

- [ ] `psql -f supabase/migrations/0081_ftc_official_verification.sql` succeeds, and succeeds
      again on a second run with no error.
- [ ] `npm run typecheck && npm run lint && npm run build && npm run test` all pass; pasted
      output included in the report.
- [ ] `FIRST_API_USERNAME` and `FIRST_API_TOKEN` appear in `lib/env.ts` **and** are set in the
      Vercel project for `production`.
- [ ] With credentials present, looking up a real FTC team number in the signup wizard returns
      a record whose `ftc_teams_cache.source` is `first_api` and whose `verified_at` is
      non-null. Verified by querying the row, not by reading the code.
- [ ] With `FIRST_API_TOKEN` unset locally, the same lookup still succeeds via FTCScout and
      writes `source = 'ftcscout'`. No unhandled error, no 500.
- [ ] Creating an `existing` team whose name is nothing like the official record is **blocked**
      with a readable message, and a `team_verification_records` row exists with
      `outcome = 'rejected'`.
- [ ] Creating an `existing` team whose name is a near-match **succeeds**, writes
      `outcome = 'needs_review'`, and every admin receives an in-app notification.
- [ ] An `incubator` team is created with no `ftc_team_number` and **no** verification record —
      the check is skipped, not failed.
- [ ] `verifyCoach` on a coach whose `pending_team_data` carries a bogus number still verifies
      the coach, provisions the team as `incubator`, and returns the warning. The coach is
      never left unverified.
- [ ] An admin override with a 25-character reason flips the record to `overridden`, writes an
      `audit_log` row with `action = 'override_team_verification'`, and notifies the coach.
      An override with a 5-character reason is rejected **by the server action**.
- [ ] `curl -H "Authorization: Bearer $CRON_SECRET" .../api/cron/refresh-ftc-roster` returns
      `{ refreshed, failed }`, and an `audit_log` row with `action = 'cron_refresh_ftc_roster'`
      exists. The same call with no header returns 401.
- [ ] Every security-boundary test above passes against the real database.
- [ ] `npm run dev:admin-preview` renders the new admin verification block without errors.

## Rollback

1. `vercel rollback` reverts the deployment. It does **not** revert the database.
2. To revert `0081`:
   ```sql
   DROP TABLE IF EXISTS team_verification_records;   -- policies and indexes go with it
   DROP INDEX IF EXISTS idx_ftc_cache_stale;
   ALTER TABLE ftc_teams_cache
     DROP COLUMN IF EXISTS official_team_name,
     DROP COLUMN IF EXISTS organization,
     DROP COLUMN IF EXISTS rookie_year,
     DROP COLUMN IF EXISTS region_code,
     DROP COLUMN IF EXISTS district_code,
     DROP COLUMN IF EXISTS source,
     DROP COLUMN IF EXISTS verified_at;
   ```
   Nothing outside this slice reads those columns, so the drop is safe.
3. Remove the `refresh-ftc-roster` entry from `vercel.json` and redeploy, or the cron 404s
   nightly.
4. `FIRST_API_USERNAME` / `FIRST_API_TOKEN` can stay in Vercel — they are `.optional()` and
   unused once the code is reverted.
5. Cached rows written with `source='first_api'` remain valid `FTCTeam` rows for the reverted
   `validateFTCTeam`; the extra columns are simply ignored. No data cleanup is needed.

## Commit

```
feat(verification): verify FTC teams against the official FIRST roster

Adds an official FIRST Events API client as the primary team-verification
source with the existing FTCScout query kept as fallback, cross-checks the
coach-supplied team name and organization against the official record, and
records every check in team_verification_records with an admin override path.

Verification previously ran on only one of four team-creation paths and
checked existence alone: the primary path (verifyCoach provisioning from
pending_team_data) performed no check at all, and the coach-entered team
name was never compared with anything.
```
