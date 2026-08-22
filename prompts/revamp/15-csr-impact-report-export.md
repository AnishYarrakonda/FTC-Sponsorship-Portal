# Prompt 15 — CSR / ESG impact report export

> **Prerequisites:** `01` (the `funding_fulfillments` state machine), `14` (recognition tiers
> and benefit deliveries)
> **Reserved migration:** `0088_impact_reports.sql` — verify it is still free with `ls supabase/migrations | tail -3`
> **Scope:** large · ~16 files
> **Leaves the repo:** green and shippable on its own

## Why this exists

A corporate sponsor's community-relations manager has to justify the spend internally, usually
once a year, usually to someone who was not in the room when the decision was made. They need
a document: here is what we gave, here is what actually cleared, here are the teams, here is
the reach, here is the logo on the robot, here are the awards those teams won.

The platform holds every one of those facts and can emit none of them. The only export that
exists is `app/api/admin/export/route.ts` — an **admin-only** CSV of submissions
(`:5-24` is the header list) that includes `contact_email` and the full text of every pitch,
which its own comment at `:145-147` calls "the single most sensitive artifact the product can
emit". A sponsor cannot reach it, and it would be the wrong document if they could.

Meanwhile `app/(sponsor)/sponsor/funding/page.tsx` gives a sponsor a flat list of ledger rows
and a single "Total Approved" figure (`:52-70`). That is not a CSR report.

## Current state (verified)

**What exists — the source data**

- **Money.** `transactions_ledger` (`0017_transactions_ledger.sql:4-14`) records commitments;
  prompt 01's `funding_fulfillments` records whether the money actually moved
  (`pledged → agreement_signed → payment_sent → payment_received → receipted`, plus
  `cancelled`), with per-transition timestamps and an append-only
  `funding_fulfillment_events` trail. **Pledged vs received is exactly the
  `funding_fulfillments.status` / `payment_received_at` distinction** — do not reinvent it and
  do not read `transactions_ledger` for "received", because a ledger row means agreed, not paid.
- **Teams.** `teams.students_reached`, `teams.events_hosted`, `teams.volunteer_hours` exist and
  are written by `app/actions/team.ts:325-328` from the Zod fields declared at
  `lib/schemas/team.ts:158-161` (all `z.number().int().nonnegative().optional()`). They are
  already surfaced to sponsors as "Community Impact" stat cards on the token viewer
  (`app/sponsor-view/[token]/page.tsx:65-69, 216-228`), so putting them in a report exposes
  nothing new.
- **Photos.** `teams.media_urls` is a jsonb array of Supabase-hosted URLs, host-validated by
  `lib/schemas/team.ts:93-100`, and `app/sponsor-view/[token]/page.tsx:57, 86-93` already
  renders `media_urls[0]` to a sponsor through `safeMediaUrls`.
- **Outcomes.** `team_achievements` (`0001_init.sql:92-101`: `season`, `event_name`, `award`,
  `description`, no PII columns). `0060_achievements_visibility.sql:12-33` widened SELECT to
  the owner, admins, public non-deleted teams, and sponsors with a live submission — and its
  header comment at `:9` states explicitly that "No student PII lives in team_achievements".
- **Recognition (prompt 14).** `sponsor_recognition_awards` with the pinned
  `tier_name_snapshot` / `benefits_snapshot`, and `recognition_benefit_deliveries` with
  `status`, `delivered_at`, `proof_url` and the `no_minors_confirmed_at` affirmation that a
  proof cannot exist without.
- **Aggregation precedent.** `app/(admin)/analytics/page.tsx:20-55` already computes
  platform-wide numbers (ledger sum, active sponsors, team count, conversion rate) in a Server
  Component with the RLS-respecting server client.
- **Export precedent.** `app/api/admin/export/route.ts` — `requireAdmin()` at `:54`, the
  **admin client** at `:62` (RLS bypassed), formula-injection escaping at `:26-40`,
  1000-row PostgREST paging at `:98-111`, an `audit_log` row at `:148-158`, and a
  `Content-Disposition` attachment at `:163-168`. Read all of it; several of these are
  patterns to copy verbatim.
- **Cron.** `app/api/cron/expire-submissions/route.ts:11-32` is the `CRON_SECRET` bearer check
  with `crypto.timingSafeEqual`. `vercel.json` currently schedules exactly one job at
  `0 2 * * *`.

**What is missing**

No report of any kind, no snapshot table, no sponsor-reachable export, no platform aggregate
outside the admin analytics page, and no PDF path. `grep -rin "impact.report\|csr\|esg" app lib
supabase` returns nothing.

**Two corrections to the brief, both verified in the code**

1. **The hardcoded landing-page stats are not in `lib/site-config.ts`.** That file holds copy
   and product fixtures only — `SHOWCASE_TEAM` (`:17`), `PORTFOLIO_MOCK` (`:35-43`),
   `DISPATCH_REVIEW` (`:48-59`), `HERO_*` (`:109-110`) — and contains no platform statistics.
   The actual hardcoded numbers live in two places:
   - `app/page.tsx:80-87` — a "Platform Metrics" card reading **`100%`** ("of pitches read by a
     human admin before dispatch") and **`< 24h`** ("average turnaround for review and URL
     signing").
   - `components/landing/hero.tsx:63-87` — three `StatCard`s inside a **mock product
     screenshot** ("Potential Matches 12", "Active Pitches 4", "Funds Secured $4,200"). These
     are illustrative UI chrome, not claims about the platform.

   Neither is a funding aggregate, and `100%` / `< 24h` are *process* claims that live
   numbers cannot express. **Do not replace them.** §Landing page specifies what to actually do:
   add a live block beside them, backed by real data, with a fallback constant that does move
   into `lib/site-config.ts`.
2. **There is no "received amount" separate from the pledged amount.** Prompt 01 copies
   `transactions_ledger.amount_cents` into `funding_fulfillments.amount_cents` and never
   rewrites it. "Received" is a **status and a timestamp**, not a second number. So
   *pledged vs received* in this report means: sum of all non-cancelled fulfillments, versus
   sum of those whose status has reached `payment_received` or `receipted`. Say that in the
   report's own footnotes so a finance reader is not left guessing.

## What you are building

1. Migration `0088_impact_reports.sql`:
   - table `impact_report_snapshots` (the frozen artifact),
   - table `public_platform_stats` (one row, six integers, anon-readable),
   - column `teams.media_no_minors_confirmed_at`,
   - RPCs `upsert_impact_snapshot(...)`, `close_impact_report_year(...)`,
     `reopen_impact_report_year(...)`, `refresh_public_platform_stats()`,
   - RLS + per-role policies + REVOKE/GRANT on every SECURITY DEFINER function.
2. `lib/impact-report/projection.ts` — **the COPPA allowlist, enforced as code.** The single
   place a team, an achievement, a fulfillment or a benefit becomes report output.
3. `lib/impact-report/build.ts` — assembles a sponsor or platform payload from the projection.
4. `app/actions/impact.ts` — regenerate / close / reopen / affirm-media actions.
5. `app/api/sponsor/impact-report/route.ts` — sponsor-scoped JSON/CSV download.
6. `app/api/admin/impact-report/route.ts` — platform aggregate CSV for grant applications.
7. `app/api/cron/impact-rollup/route.ts` + a `vercel.json` entry.
8. Print-optimised sponsor report page, sponsor year index, admin console.
9. Live landing-page stats with a static fallback.
10. Tests — including the two the brief names as mandatory.

## COPPA — read this before writing a single line

**The report must contain ZERO student PII.** Not a name, not a face identifiable as a minor,
not an individual student's story, not a quote attributed to a student, not a classroom roster
number tied to an individual. This is Core Mandate #1 and it does not bend for a nicer-looking
PDF.

**The allowlist is enforced in code, as a projection — not by convention, not by a `select *`
plus a promise.** Two layers, both required:

1. The Supabase `.select()` string is **generated from the allowlist constant**, so the
   database never returns a non-allowlisted column into the process.
2. `projectTeam()` / `projectAchievement()` / `projectFulfillment()` / `projectBenefit()`
   build their output objects by **explicit key enumeration**. No object spread, no
   `Object.assign`, no `...rest`. A column added to `teams` next year cannot leak into a
   report by accident, because nothing copies unknown keys.

### Allowed into the report — the complete list

**Team (from `teams`)**

| Field | Why it is safe |
|---|---|
| `ftc_team_number` | A public FIRST registry identifier for a *team*, not a person |
| `team_name` | Public competition name |
| `organization` | School or org name — an institution, not a person |
| `city`, `state` | Team locality, no street address |
| `tax_status` | `501c3` / `School` / `None`; the sponsor's finance team needs it |
| `founded_year`, `seasons_competed` | Team history |
| `team_size` | An integer **count**. Never a list, never names |
| `students_reached`, `events_hosted`, `volunteer_hours` | Aggregate counts, already shown to sponsors at `app/sponsor-view/[token]/page.tsx:65-69` |
| `tagline`, `mission_statement`, `outreach_summary` | Team-voice copy already dispatched to sponsors via `emails/submission-email.tsx:96-99, 128-133` |
| `logo_url` | Team logo, `team-logos` bucket |
| `media_urls` | **Conditional** — see §Photos below |

**Achievements (from `team_achievements`)**: `season`, `event_name`, `award`, `description`.
That is the whole table minus `id`/`team_id`/`created_at`, and `0060:9` already records that
none of it is student PII.

**Funding (from `funding_fulfillments`)**: `amount_cents`, `status`, `pledged_at`,
`payment_received_at`, `receipted_at`. **Not** `payment_reference` — prompt 01 §Guardrails
item 6 forbids it leaving the row, and a CSR report is a document that gets emailed around.
**Not** `notes` (free text, may name a person at the sponsor).

**Recognition (from prompt 14)**: `tier_name_snapshot`, `amount_cents`, and per benefit
`benefit_type`, `status`, `delivered_at`, `proof_url`.

**Sponsor (from `sponsors`, own row only)**: `company_name`, `logo_url`. Nothing else —
`contact_name`, `contact_email`, `contact_title`, `funding_cap_cents`, `funding_used_cents`,
`notes` and `geo_states` are internal and stay internal.

### Forbidden, explicitly, with the reason

Encode this as a named constant `IMPACT_FORBIDDEN_KEYS` and assert against it in the tests:

- **Everything on `profiles`.** `full_name`, `email`, `phone_number`, `date_of_birth`,
  `address_line1`, `city`, `state`, `zip_code`, `coach_credentials_url`, `referral_source`.
  The report never joins `profiles`. Not even the coach's name — the report is about the team.
- `teams.coach_photo_url` — a photograph of a named adult, and it is a retention-managed
  artifact besides.
- `teams.coach_experience`, `teams.community_endorsements`, `teams.subteam_breakdown` —
  free-text fields that in practice name individuals ("our captain Maya rebuilt the
  intake…"). A sanitiser cannot reliably find a first name. Exclude the fields.
- `teams.press_links` — outbound links to articles that routinely name and photograph
  students. Linking to them from a report we publish is the same exposure at one remove.
- `teams.past_sponsors` — not PII, but naming other companies inside one sponsor's own CSR
  document is a needless awkwardness. Excluded on judgment, not on law; say so in the comment.
- Every free-text field on `submissions` (`custom_pitch_alignment`,
  `specific_needs_statement`, `local_connection_notes`) — coach-written prose about a specific
  ask, not impact, and the highest-risk place for an incidental student mention.
- `funding_fulfillments.payment_reference`, `funding_fulfillments.notes`.
- Anything from `audit_log`, `notifications`, `submission_access_tokens`.

### Photos — fail closed

`recognition_benefit_deliveries.proof_url` (prompt 14) may be included: a proof photo cannot
exist without `no_minors_confirmed_at`, enforced by the
`proof_requires_no_minors_affirmation` CHECK constraint.

`teams.media_urls` carries **no such affirmation** — it predates prompt 14 and is a general
portfolio gallery. So this migration adds one:

```sql
ALTER TABLE teams ADD COLUMN IF NOT EXISTS media_no_minors_confirmed_at timestamptz;
COMMENT ON COLUMN teams.media_no_minors_confirmed_at IS
  'Set when the coach affirms that every image in media_urls depicts robots, workspaces, '
  'signage or events with no identifiable minors. NULL means portfolio photos are EXCLUDED '
  'from CSR impact reports. Cleared automatically whenever media_urls changes.';
```

The projection includes `media_urls` **only when `media_no_minors_confirmed_at IS NOT NULL`**,
and caps the array at 6 images. Default NULL means no portfolio photos in any report until a
coach opts in — fail closed, which is the only acceptable default for this.

Adding a column to `teams` is safe: `guard_submission_writable_columns()` fails closed against
an allowlist on **`submissions`** (_CONTEXT §8.7), not on `teams`, and `teams` RLS policies are
column-agnostic (the same reasoning `0058_missing_team_columns.sql:8` records for the two
columns it added).

**Be honest about what the control is.** We cannot detect a face. The control set is: a
coach's explicit affirmation, an admin review queue (prompt 14's proof panel, extended here to
cover portfolio media), and a takedown lever. Do not write UI copy claiming photos are
"automatically screened".

## Data model

### `impact_report_snapshots` — snapshot, do not recompute

A closed year must be **stable and reproducible**: the CFO who downloaded the 2026 report in
January must get the same document in July, even though the team has since edited its
portfolio, added achievements and changed its photos. A live query cannot promise that. Store
the rendered payload.

```sql
CREATE TABLE IF NOT EXISTS impact_report_snapshots (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'sponsor' = one company's report. 'platform' = the aggregate used for grant
  -- applications and the landing page. The CHECK below keeps sponsor_id consistent
  -- with scope so a platform row can never be mistaken for a sponsor row by a policy.
  scope                 text NOT NULL CHECK (scope IN ('sponsor', 'platform')),
  sponsor_id            uuid REFERENCES sponsors(id) ON DELETE CASCADE,
  report_year           int  NOT NULL CHECK (report_year BETWEEN 2000 AND 2100),
  status                text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  -- The frozen document, produced by lib/impact-report/projection.ts and NOTHING else.
  payload               jsonb NOT NULL,
  -- Bumped when the projection's shape changes, so an old snapshot renders with the
  -- renderer it was built for instead of crashing on a missing key.
  payload_schema_version int NOT NULL DEFAULT 1,
  generated_at          timestamptz NOT NULL DEFAULT now(),
  generated_by          uuid REFERENCES profiles(id) ON DELETE SET NULL,
  closed_at             timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT scope_matches_sponsor CHECK ((scope = 'sponsor') = (sponsor_id IS NOT NULL)),
  CONSTRAINT closed_has_timestamp  CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);

-- Two PARTIAL unique indexes, not one composite: in Postgres NULLs are distinct, so a plain
-- UNIQUE (sponsor_id, report_year) would happily allow fifty platform rows for 2026.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_impact_snapshot_sponsor_year
  ON impact_report_snapshots(sponsor_id, report_year) WHERE sponsor_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_impact_snapshot_platform_year
  ON impact_report_snapshots(report_year) WHERE sponsor_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_impact_snapshots_year ON impact_report_snapshots(report_year DESC);
```

**When it is written:**

| Trigger | What happens |
|---|---|
| Nightly cron (`/api/cron/impact-rollup`) | Regenerates every **open** snapshot for the current year, and creates one for each sponsor with at least one non-cancelled fulfillment in that year |
| Year-end (same cron, on 2 January) | Regenerates the prior year one final time, then `close_impact_report_year(prior_year)` |
| Admin "Regenerate" button | Regenerates one open snapshot on demand |
| Sponsor opening a report for an **open** year | Renders the stored snapshot and shows `generated_at`. **It does not regenerate.** A page view must never be a write |

A `closed` snapshot is immutable: `upsert_impact_snapshot` refuses it with `year_closed`. An
admin who genuinely needs to correct a closed year calls `reopen_impact_report_year`, which is
audited, regenerates, and closes it again. That is deliberately a three-step, logged operation
— reopening a published financial-adjacent document should feel heavier than clicking refresh.

### `public_platform_stats` — the anon-readable projection

The landing page must not read `impact_report_snapshots`; those rows contain per-sponsor
payloads and must never be anon-readable. Instead the rollup writes a **separate single-row
table containing nothing but integers**:

```sql
CREATE TABLE IF NOT EXISTS public_platform_stats (
  -- Single-row table. The CHECK plus the PK make a second row impossible.
  id                     boolean PRIMARY KEY DEFAULT true CHECK (id),
  teams_supported        int    NOT NULL DEFAULT 0,
  sponsors_active        int    NOT NULL DEFAULT 0,
  dollars_pledged_cents  bigint NOT NULL DEFAULT 0,
  dollars_received_cents bigint NOT NULL DEFAULT 0,
  students_reached       int    NOT NULL DEFAULT 0,
  events_hosted          int    NOT NULL DEFAULT 0,
  volunteer_hours        int    NOT NULL DEFAULT 0,
  refreshed_at           timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public_platform_stats (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
```

Seven numbers and a timestamp. No names, no ids, no per-sponsor detail, nothing that
identifies anyone. That is what makes an anon SELECT policy defensible on it and indefensible
on the snapshot table.

### RLS policies

`ALTER TABLE … ENABLE ROW LEVEL SECURITY` on both new tables.

**`impact_report_snapshots`**

- `impact_snapshots_select_admin` · SELECT · `USING (is_admin())`
- `impact_snapshots_select_sponsor` · SELECT ·
  ```sql
  USING (
    scope = 'sponsor'
    AND sponsor_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM profiles p
                 WHERE p.id = current_profile_id() AND p.role = 'sponsor'
                   AND p.sponsor_id IS NOT NULL AND p.sponsor_id = impact_report_snapshots.sponsor_id)
  )
  ```
  The `scope = 'sponsor'` clause is not redundant with the CHECK constraint — it is the belt
  that stops a future platform row with a stray `sponsor_id` being visible. Keep it.
- **No coach policy.** A CSR report is a sponsor's internal document; the team's own facts are
  already on their dashboard. Do not add one "for convenience".
- **No INSERT / UPDATE / DELETE policies.** Every write is service-role through the RPCs —
  same stance as `transactions_ledger`, `audit_log`, and prompts 01 and 14.

**`public_platform_stats`**

- `platform_stats_select_public` · SELECT · `TO anon, authenticated` · `USING (true)`
- **No INSERT / UPDATE / DELETE policies.** Written only by `refresh_public_platform_stats()`.

### `upsert_impact_snapshot`

```sql
upsert_impact_snapshot(
  p_actor_profile_id uuid,
  p_scope            text,
  p_sponsor_id       uuid,
  p_report_year      int,
  p_payload          jsonb,
  p_schema_version   int DEFAULT 1
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
```

1. Three-branch actor resolution, exactly as prompt 01's `record_fulfillment_transition` §1:
   Clerk `sub` present → assert `current_profile_id() = p_actor_profile_id`; else
   `is_trusted_server_context()` → trust the parameter; else `unauthorized`. Never a bare
   `ELSE` (0065's shape, disproven by 0072), never `(auth.jwt()->>'sub') IS NULL` on its own.
2. Admin **or** trusted-server only → `unauthorized`. Sponsors never write their own report.
3. Validate `p_scope` against `sponsor_id` presence → `scope_mismatch`.
4. Lock the existing row `FOR UPDATE`; if `status = 'closed'` → **`year_closed`**. This is the
   immutability guarantee, and it lives in the database rather than in the action so that no
   future caller can route around it.
5. UPSERT on the appropriate partial unique index, setting `payload`, `payload_schema_version`,
   `generated_at = now()`, `generated_by = v_actor`, `updated_at = now()`.
6. `audit_log`: `action = 'impact_snapshot_generated'`, `entity_type =
   'impact_report_snapshots'`, `entity_id = <row id>`, `metadata = { scope, sponsor_id,
   report_year, teams: <count>, bytes: <octet_length(p_payload::text)> }`. **Do not put the
   payload in the audit metadata** — it is a full document and `audit_log` is forever.
7. Return `{ ok: true, id, generated_at }`.

`close_impact_report_year(p_actor_profile_id uuid, p_year int)` — admin/trusted only; flips
every `open` snapshot for that year to `closed` with `closed_at = now()`; audits
`impact_year_closed` with the affected count; returns the count.

`reopen_impact_report_year(p_actor_profile_id uuid, p_year int, p_reason text)` — admin only,
`p_reason` at least 10 characters → `reason_required`; audits `impact_year_reopened` with the
reason.

### `refresh_public_platform_stats()`

```sql
CREATE OR REPLACE FUNCTION refresh_public_platform_stats()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
```

Recomputes and UPSERTs the single row:

- `teams_supported` — `COUNT(DISTINCT team_id)` over `funding_fulfillments` where
  `status <> 'cancelled'` and `team_id IS NOT NULL`.
- `sponsors_active` — `COUNT(*) FROM sponsors WHERE status = 'active'`.
- `dollars_pledged_cents` — `SUM(amount_cents)` over non-cancelled fulfillments.
- `dollars_received_cents` — `SUM(amount_cents)` over fulfillments whose status is
  `payment_received` or `receipted`.
- `students_reached`, `events_hosted`, `volunteer_hours` — summed over the **distinct funded
  teams only** (`teams` joined to that same fulfillment set, `deleted_at IS NULL`), never over
  all teams on the platform. Advertising the reach of teams nobody funded would be a lie.
- `refreshed_at = now()`.

**Why this one is SQL while the report projection is TypeScript**, so the split does not look
arbitrary: this function emits seven scalars and touches no per-entity text, so there is no
allowlist to enforce and nothing a Vitest suite could usefully assert about its output shape.
The report payload is a per-team document assembled from fifteen columns across four tables,
where the allowlist *is* the security control and must be unit-testable. Aggregates in SQL,
projections in TypeScript. Write that sentence as a comment in the migration.

All four functions get, with their full argument type lists:

```sql
REVOKE EXECUTE ON FUNCTION <name>(<types>) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION <name>(<types>) FROM anon;
REVOKE EXECUTE ON FUNCTION <name>(<types>) FROM authenticated;
GRANT  EXECUTE ON FUNCTION <name>(<types>) TO service_role;
```

None of them is called from inside an RLS policy, so unlike `can_read_fulfillment` /
`can_read_recognition_award` there is no revoke exception here.

### Media affirmation reset

The affirmation must not survive a change to the thing it affirms:

```sql
CREATE OR REPLACE FUNCTION trg_reset_media_affirmation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.media_urls IS DISTINCT FROM OLD.media_urls THEN
    NEW.media_no_minors_confirmed_at := NULL;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS reset_media_affirmation ON teams;
CREATE TRIGGER reset_media_affirmation
  BEFORE UPDATE OF media_urls ON teams
  FOR EACH ROW EXECUTE FUNCTION trg_reset_media_affirmation();
```

A coach adding a photo after affirming must re-affirm. Fail closed. Four REVOKE/GRANT lines on
the trigger function too.

## The projection — `lib/impact-report/projection.ts`

This module is the security control. Treat it accordingly: heavy comments, no cleverness.

```ts
/**
 * COPPA ALLOWLIST. Core Mandate #1.
 *
 * These arrays are the ONLY columns that may appear in a CSR impact report. They are used
 * twice: to build the PostgREST `.select()` string (so the database never returns anything
 * else into this process) and to drive the explicit projections below (so nothing unknown can
 * be copied into the output). Adding a column here is a COPPA decision, not a formatting one.
 */
export const IMPACT_TEAM_FIELDS = [
  'id', 'ftc_team_number', 'team_name', 'organization', 'city', 'state', 'tax_status',
  'founded_year', 'seasons_competed', 'team_size',
  'students_reached', 'events_hosted', 'volunteer_hours',
  'tagline', 'mission_statement', 'outreach_summary', 'logo_url',
  'media_urls', 'media_no_minors_confirmed_at',
] as const

export const IMPACT_ACHIEVEMENT_FIELDS = ['season', 'event_name', 'award', 'description'] as const
export const IMPACT_FULFILLMENT_FIELDS =
  ['amount_cents', 'status', 'pledged_at', 'payment_received_at', 'receipted_at'] as const
export const IMPACT_BENEFIT_FIELDS =
  ['benefit_type', 'status', 'delivered_at', 'proof_url'] as const

/** Asserted against by the tests. Every one of these has a reason recorded in prompt 15. */
export const IMPACT_FORBIDDEN_KEYS = [
  'full_name', 'email', 'contact_email', 'contact_name', 'contact_title',
  'phone_number', 'date_of_birth', 'address_line1', 'zip_code', 'referral_source',
  'coach_credentials_url', 'coach_photo_url', 'coach_experience',
  'community_endorsements', 'subteam_breakdown', 'press_links', 'past_sponsors',
  'custom_pitch_alignment', 'specific_needs_statement', 'local_connection_notes',
  'payment_reference', 'notes', 'clerk_user_id',
] as const

/** Build the PostgREST select string from the allowlist. Never hand-write one. */
export function impactTeamSelect(): string   // 'id,ftc_team_number,team_name,…'

/**
 * Explicit key enumeration. NO SPREAD. A column added to `teams` next season cannot reach a
 * report through this function without someone editing it on purpose.
 * `media_urls` is emitted only when media_no_minors_confirmed_at is set, capped at 6.
 */
export function projectTeam(row: RawTeamRow): ImpactTeam
export function projectAchievement(row: RawAchievementRow): ImpactAchievement
export function projectFulfillment(row: RawFulfillmentRow): ImpactFulfillment
export function projectBenefit(row: RawBenefitRow): ImpactBenefit

/** Test-and-CI safety net: deep-walks a payload and returns any forbidden key it finds. */
export function findForbiddenKeys(payload: unknown): string[]
```

`lib/impact-report/build.ts` composes them:

```ts
export const IMPACT_PAYLOAD_SCHEMA_VERSION = 1

export async function buildSponsorImpactPayload(
  adminClient: SupabaseClient<Database>, sponsorId: string, year: number
): Promise<SponsorImpactPayload>

export async function buildPlatformImpactPayload(
  adminClient: SupabaseClient<Database>, year: number
): Promise<PlatformImpactPayload>
```

`SponsorImpactPayload` shape (freeze it; `payload_schema_version` guards changes):

```ts
{
  schema_version: 1,
  year: number,
  generated_at: string,
  sponsor: { company_name: string; logo_url: string | null },
  totals: {
    pledged_cents: number
    received_cents: number
    outstanding_cents: number        // pledged - received, never negative
    teams_supported: number
    students_reached: number         // summed over the funded teams in this year
    events_hosted: number
    volunteer_hours: number
    benefits_promised: number
    benefits_delivered: number
  },
  teams: Array<{
    team: ImpactTeam
    achievements: ImpactAchievement[]
    fulfillments: ImpactFulfillment[]
    recognition: { tier_name: string | null; benefits: ImpactBenefit[] }
  }>,
  notes: string[]   // the pledged-vs-received footnote, the photo-affirmation footnote
}
```

Year boundary: a fulfillment belongs to a report year by **`pledged_at`** (the commitment
date), not by `payment_received_at`. A December pledge paid in February stays in the December
report and shows as outstanding until the following regeneration. State that in `notes` —
finance readers will ask.

## Output format — print-optimised HTML, decisively

**Recommendation: a print-optimised HTML page the sponsor saves as PDF from their browser. Do
not add a PDF dependency.**

The reasoning, since this is the kind of decision that gets relitigated:

- `package.json` has **no PDF library** and no headless browser. React Email
  (`@react-email/components`, `@react-email/render`) renders HTML for inboxes — it cannot
  produce a PDF, so "we already have React Email" is not an argument for a PDF path.
- Server-side PDF means one of: `@react-pdf/renderer` (a second, incompatible layout engine —
  every style in the report written twice, and it drops the CSS the rest of the app uses), or
  `puppeteer`/`playwright-chromium` (a ~300 MB Chromium in a serverless function; Vercel's
  function size limits make this a non-starter on this project's plan), or a third-party
  HTML→PDF API (a new vendor, a new secret, and every sponsor's report leaving our
  infrastructure — for a document we just spent a whole section restricting).
- Browser print produces a real, paginated, selectable-text PDF with correct page breaks, at
  zero bundle cost, using the styles already in the app. The person who needs the file is
  already looking at it in a browser.

**The tradeoff, stated plainly:** there is no server-generated PDF, so we cannot attach one to
an email or archive a byte-identical file. That is acceptable because the *snapshot* is what
we archive — the payload is frozen in `impact_report_snapshots`, so the document is
reproducible even though the PDF is not byte-identical. If email attachment becomes a real
requirement later, the same route can be fed to a hosted HTML→PDF service without touching the
data model.

Implementation notes:

- Tailwind v4's `print:` variants cover most of it. `@page { size: letter; margin: 0.6in; }`
  has no Tailwind variant — put it in a `<style>` block on the report page.
- The portal chrome must not print. Read `components/ui/portal-shell.tsx` first; if the nav +
  sidebar sit in one wrapper, add `print:hidden` to it. If they do not, add `data-print-hide`
  to each chrome element and one `@media print { [data-print-hide] { display: none !important } }`
  rule on the report page. Do not restructure the shell.
- `break-inside: avoid` on each team card (`print:break-inside-avoid`), a repeated header, and
  a visible `generated_at` + `payload_schema_version` in the footer of every page so a printed
  copy is traceable to its snapshot.
- Images: `media_urls` and `proof_url` are public bucket URLs; they print fine. Give each a
  `loading="eager"` so print does not race lazy loading.

## Where it lives — a sibling route, not an extension

**Decision: add sponsor-scoped and admin-aggregate routes as siblings. Do not extend
`app/api/admin/export/route.ts`.**

That route's entire security model is positional: `requireAdmin()` at `:54` returns or throws,
and *everything below it assumes admin*, which is why it can safely use the **admin client** at
`:62` and query with no owner filter at all. Threading a sponsor scope through it means adding
a role branch inside a function where a single missing `.eq('sponsor_id', …)` dumps every
sponsor's data into one sponsor's download. The two routes also differ in output shape, in
filename, and in what belongs in their audit metadata (`:148-158` records
`includes_sponsor_contact_emails: true` — a fact that must be *false* for a CSR report and
should not be a variable).

So:

**`app/api/sponsor/impact-report/route.ts`** — `GET ?year=YYYY&format=json|csv`

- `requireSponsor()` (returns `user`, `sponsorId`, `adminClient`). On throw → `403` JSON.
  Never a redirect: `middleware.ts:60-62` returns JSON `401` for unauthenticated `/api/*` and
  the route must match that contract.
- **Reads the snapshot with the RLS-respecting server client** (`lib/supabase/server.ts`),
  filtered `.eq('sponsor_id', sponsorId).eq('report_year', year).eq('scope', 'sponsor')`.
  Two independent barriers: the explicit filter, and RLS underneath it. Use the admin client
  **only** for the `audit_log` write.
- **Any `sponsorId` in the query string is ignored.** The sponsor is resolved from the session,
  full stop. If a caller supplies one that differs, return `403` and audit it — that is an
  attempted cross-tenant read and we want to see it.
- 404 JSON when no snapshot exists for that year, with a message telling them which years do.
- CSV uses the escaping and paging helpers from `app/api/admin/export/route.ts:26-47` — copy
  `escapeCell` (the formula-injection defense at `:29-35` matters just as much here; team names
  are attacker-influenced and a CFO opens this in Excel). Factor them into
  `lib/csv.ts` and import from both rather than duplicating; that is the one refactor this
  slice is allowed, and it is a pure move.
- `Content-Disposition: attachment; filename="impact-report-<year>.csv"`.
- `audit_log` action `export_sponsor_impact_report`, metadata
  `{ sponsor_id, report_year, format, snapshot_id }`.

**`app/api/admin/impact-report/route.ts`** — `GET ?year=YYYY&format=json|csv`, `requireAdmin()`,
serves the **platform** snapshot for grant applications. Audits
`export_platform_impact_report`.

**Pages**

- `app/(sponsor)/sponsor/impact/page.tsx` — year index: one card per available snapshot with
  year, totals, `generated_at`, status chip (Open / Closed), a "View report" link and a
  "Download CSV" link. Empty state when there are no snapshots yet.
- `app/(sponsor)/sponsor/impact/[year]/page.tsx` — the print-optimised report, rendered from
  the stored payload. A "Print / Save as PDF" button (`window.print()`, so a tiny client
  component). For an open year, a muted line: "Figures as of `<generated_at>`. This year is
  still open and will be finalised in January."
- `app/(admin)/impact/page.tsx` — platform aggregate for the current and prior year, the
  per-sponsor snapshot list with Regenerate, and Close / Reopen year. Admin group routes are
  top-level, so the sidebar entry in `components/admin/admin-sidebar.tsx:29-34` is
  `href: '/impact'`.
- Sponsor sidebar entry in `components/sponsor/sponsor-sidebar.tsx:27-30` after `Funding`.

Neither page is public. **No `middleware.ts` change is required** — every new path sits under
`/sponsor/*`, `/impact` or `/api/*`, all of which the existing matcher already handles.

## The rollup cron

**`app/api/cron/impact-rollup/route.ts`** — one route doing two jobs, because cron slots are a
budgeted resource on this project's Vercel plan (`vercel.json` currently declares exactly one
job; check the plan's cron allowance in the dashboard before adding a second schedule).

- Copy the auth block from `app/api/cron/expire-submissions/route.ts:11-32` verbatim: bearer
  header, `env.CRON_SECRET`, length check, `crypto.timingSafeEqual` in a try/catch. Not a
  paraphrase — that block is timing-attack-hardened and easy to weaken by rewriting.
- Every run: `refresh_public_platform_stats()`, then regenerate every **open** snapshot for the
  current year plus a `platform` snapshot for it.
- On 2 January (`UTC month === 0 && date === 2`): regenerate the prior year one last time, then
  `close_impact_report_year(prior_year)`.
- Writes one `audit_log` row per run (`cron_impact_rollup`) with counts — the same reasoning
  `app/api/cron/expire-submissions/route.ts:105-108` records: Vercel Hobby retains about an
  hour of logs, so without an audit row "did it run?" is unanswerable.
- Add to `vercel.json`:
  ```json
  { "path": "/api/cron/impact-rollup", "schedule": "0 3 * * *" }
  ```
  03:00 UTC, an hour after the expiry sweep, so the fulfillment states it reads are settled.
- `/api/cron(.*)` is already public in `middleware.ts:16` — no change needed.

## Landing page — live numbers without slowing it down or gating it

Recap of the correction in §Current state: the numbers on the landing page today are
`100%` and `< 24h` at `app/page.tsx:80-87` (process claims) and mock product figures at
`components/landing/hero.tsx:63-87` (illustrative chrome). **Leave both alone.** Add a live
block instead.

- `lib/site-config.ts` gains:
  ```ts
  /**
   * Fallback for the landing page's live impact block. Used when public_platform_stats is
   * unreachable or has never been refreshed. All zeros on purpose: pre-launch the honest
   * number is zero, and the block hides itself entirely when every figure is zero rather
   * than advertising "$0 funded".
   */
  export const PLATFORM_STATS_FALLBACK = {
    teamsSupported: 0, dollarsReceivedCents: 0, studentsReached: 0, volunteerHours: 0,
  } as const
  ```
- `app/page.tsx` reads the single row from `public_platform_stats` on the unauthenticated
  branch only (the authed branch redirects at `:17-31` before rendering anything). The read is
  one row of seven integers through an anon-visible policy — **no auth dependency**, and the
  page already builds a Supabase client.
- Add `export const revalidate = 3600` to `app/page.tsx`. The landing page is otherwise static;
  an hourly ISR window means at most one query per hour per region, and a stale number on a
  marketing page is harmless.
- Wrap the read in a try/catch falling back to `PLATFORM_STATS_FALLBACK`. **A stats query
  failure must never break the landing page.**
- Render the block only when at least one figure is greater than zero. Pre-launch it does not
  appear at all.
- Format money with the same `(cents / 100).toLocaleString(...)` idiom used at
  `app/(sponsor)/sponsor/funding/page.tsx:58`.

## Server actions

New file `app/actions/impact.ts`, canonical 5-step shape. Map RPC codes through a local
`mapImpactError()` in the style of `mapDecisionError` (`app/actions/sponsor-decision.ts:25-38`).

```ts
regenerateImpactSnapshot(input: { scope: 'sponsor' | 'platform'; sponsorId?: string; year: number })
closeImpactYear(input: { year: number })
reopenImpactYear(input: { year: number; reason: string })   // reason min 10 chars
```
- All `requireAdmin()`. All audit (the RPCs write their own rows; the actions add
  `admin_regenerate_impact_snapshot` etc. with the actor). All
  `revalidatePath('/impact')` + `revalidatePath('/sponsor/impact')`.
- `regenerateImpactSnapshot` calls `buildSponsorImpactPayload` / `buildPlatformImpactPayload`
  and then `upsert_impact_snapshot`. It surfaces `year_closed` as
  *"That year is closed. Reopen it first if you need to correct it."*

```ts
confirmPortfolioMediaNoMinors(input: { teamId: string; confirmed: boolean })
```
- Guard: `requireVerifiedCoach()`. Ownership proven before the write (`.eq('owner_id', user.id)`
  — a zero-row UPDATE is not an error, the lesson `app/actions/team.ts:199-211` records).
- Sets or clears `media_no_minors_confirmed_at`. Audit `confirm_portfolio_media_no_minors`.
- Surfaced in the coach portfolio tab next to the media uploader, with copy that states the
  rule concretely: *"I confirm these photos show robots, workspaces, signage or events — no
  identifiable students. Photos without this confirmation are excluded from sponsor impact
  reports."*

## Out of scope

- Any change to how money is recorded or settled. `funding_fulfillments`,
  `transactions_ledger`, `sponsors.funding_used_cents`, the settle RPCs, capacity release —
  all read-only from here.
- Any change to prompt 14's tier or delivery tables. This slice reads them.
- Adding a PDF library, a headless browser, or an HTML→PDF vendor. §Output format is decided.
- Extending or refactoring `app/api/admin/export/route.ts` beyond lifting `escapeCell` /
  `rowToCsv` into `lib/csv.ts` unchanged.
- Making `media_urls` private or adding signed URLs (`0066:175-179` tracks that separately).
- Automated image moderation.
- A coach-facing version of the report, per-submission reporting, or multi-year comparison
  charts.
- Emailing the report to anyone. It is a download and a page. Nothing here goes near
  `lib/dispatch.ts` or adds a sender to `lib/notify.ts`.

## Guardrails specific to this slice

1. **COPPA is the point of this prompt.** If you find yourself widening the allowlist to make a
   section look fuller, stop. An empty section is correct; a student's name is a breach.
2. **No spread operators in the projection.** `{ ...row }`, `Object.assign`, and `...rest` are
   banned in `lib/impact-report/projection.ts`. The tests assert it by reading the file.
3. **The `.select()` string comes from the allowlist constant.** Never hand-write one and never
   `select('*')` against `teams`, `profiles`, or `submissions` anywhere in this slice.
4. **Never join `profiles`.** Not for a coach name, not for an email, not for a "prepared by".
5. **Never `auth.uid()`.** Use `current_profile_id()`, `is_admin()`,
   `is_trusted_server_context()`.
6. **REVOKE EXECUTE … FROM PUBLIC, anon, authenticated; GRANT … TO service_role** on
   `upsert_impact_snapshot`, `close_impact_report_year`, `reopen_impact_report_year`,
   `refresh_public_platform_stats`, `trg_reset_media_affirmation`. None is called from an RLS
   policy, so there is no exception here.
7. **`impact_report_snapshots` is never anon-readable.** Only `public_platform_stats` is, and
   only because it holds seven integers. If you find yourself wanting to widen the snapshot
   policy for the landing page, add a field to `public_platform_stats` instead.
8. **The sponsor route resolves the sponsor from the session.** A `sponsorId` query parameter
   is ignored and, if it contradicts the session, is a 403 plus an audit row.
9. **A page render must never write a snapshot.** Regeneration happens in the cron and in the
   admin action. A GET that mutates turns every crawler into a rewrite of the record.
10. **A closed year is immutable.** The refusal lives in `upsert_impact_snapshot`, not in the
    action, so no future caller can route around it.
11. **`$$`-quoted blocks ⇒ apply with `psql -f`** (_CONTEXT §8.2). Run it twice.
12. **Do not add a column to `submissions`** — `guard_submission_writable_columns()` fails
    closed (0064). The one new column is on `teams`, which has no such guard.
13. **Sponsors must never see another sponsor's report.** Prove it with tests, not by reading
    the policy.

## Files you will touch

**Create:**
- `supabase/migrations/0088_impact_reports.sql`
- `lib/impact-report/projection.ts`
- `lib/impact-report/build.ts`
- `lib/csv.ts` (pure move of `escapeCell` / `rowToCsv`)
- `app/actions/impact.ts`
- `app/api/sponsor/impact-report/route.ts`
- `app/api/admin/impact-report/route.ts`
- `app/api/cron/impact-rollup/route.ts`
- `app/(sponsor)/sponsor/impact/page.tsx`
- `app/(sponsor)/sponsor/impact/[year]/page.tsx`
- `components/impact/impact-report-view.tsx`
- `components/impact/print-button.tsx`
- `app/(admin)/impact/page.tsx`
- `lib/__tests__/impact-projection.test.ts`
- `tests/e2e/impact-report.spec.ts`

**Modify:**
- `app/api/admin/export/route.ts` (import the two helpers from `lib/csv.ts`; no behaviour change)
- `vercel.json` (one cron entry)
- `lib/site-config.ts` (`PLATFORM_STATS_FALLBACK`)
- `app/page.tsx` (live stats block + `revalidate`)
- `components/sponsor/sponsor-sidebar.tsx`, `components/admin/admin-sidebar.tsx` (one entry each)
- `components/coach/portfolio-tab.tsx` (the media affirmation checkbox)
- `components/ui/portal-shell.tsx` (print-hiding the chrome — read it first)
- `lib/dev-preview.ts`, `lib/dev-bypass.ts` (fixtures for the new sponsor and admin surfaces)
- `lib/supabase/types.ts` (two tables + one column; match the existing style)

## Tests

**Unit — `lib/__tests__/impact-projection.test.ts` (Vitest). The two the brief requires are
first, and neither is optional:**

- **No student-PII field appears in the output projection.** Build a raw fixture row for
  `teams` containing **every** column in the real table, with every forbidden field populated
  with a recognisable sentinel (`'FORBIDDEN_full_name'`, `'FORBIDDEN_email'`, …). Then:
  - `Object.keys(projectTeam(row))` ⊆ `IMPACT_TEAM_FIELDS` minus the internal-only ones;
  - `findForbiddenKeys(payload)` returns `[]`;
  - `JSON.stringify(payload)` contains no occurrence of the string `FORBIDDEN`.
  Repeat for `projectAchievement`, `projectFulfillment`, `projectBenefit`, and for a full
  `SponsorImpactPayload` assembled from mocked query results.
- `impactTeamSelect()` is derived from `IMPACT_TEAM_FIELDS` (assert equality against a join of
  the constant, so hand-editing one without the other fails).
- `media_urls` is **absent** when `media_no_minors_confirmed_at` is null, **present and capped
  at 6** when it is set.
- Adding a new key to the fixture row that is not in the allowlist does not change the
  projection's output at all — the regression test for someone reintroducing a spread.
- `totals.outstanding_cents` is never negative, and equals pledged minus received.
- Year bucketing: a fulfillment pledged 2026-12-30 and received 2027-02-01 appears in the 2026
  report, counted as pledged and **not** as received.

**Unit — invariants (extend `lib/__tests__/remediation-invariants.test.ts` or add a sibling),
in the file-reading regex style that file already uses:**
- `lib/impact-report/projection.ts` contains no `...` spread inside an object literal, no
  `Object.assign`, and no `select('*')`.
- `app/api/sponsor/impact-report/route.ts` contains `requireSponsor` and does **not** contain
  `createAdminClient` in the data-read path (only in the audit write).
- No file under `lib/impact-report/` references `profiles`.

**E2E — `tests/e2e/impact-report.spec.ts` (Playwright). Security boundaries are mandatory:**
- **Sponsor B cannot fetch Sponsor A's report.** Three ways, all must fail:
  `GET /api/sponsor/impact-report?year=2026` as B returns only B's data;
  `GET /api/sponsor/impact-report?year=2026&sponsorId=<A>` as B returns B's data or 403, never
  A's; and directly against PostgREST,
  `GET /rest/v1/impact_report_snapshots?select=*` as B returns `[]` for A's rows.
- Anon `GET /rest/v1/impact_report_snapshots?select=*` returns `[]`.
- Anon `GET /rest/v1/public_platform_stats?select=*` returns exactly one row (this one is
  deliberately readable — assert it works, and assert the row contains no string column
  beyond the timestamp).
- No authenticated role can UPDATE or DELETE `impact_report_snapshots` or
  `public_platform_stats`.
- **Closed-year stability:** generate 2026, close it, then edit a funded team's
  `students_reached`, add an achievement, and change its `media_urls`. Re-fetch the report:
  the payload is **byte-identical**, and `regenerateImpactSnapshot` returns the
  `year_closed` message.
- **Open-year regeneration:** the same edits on an open year *do* show up after Regenerate,
  and `generated_at` advances.
- A team that has not affirmed its media contributes **no** `media_urls` to the report;
  after `confirmPortfolioMediaNoMinors`, regenerating includes them; editing `media_urls`
  clears the affirmation and the next regeneration drops them again.
- The report page prints: assert `@media print` hides the portal chrome
  (`page.emulateMedia({ media: 'print' })`, then the sidebar is not visible).
- The cron route returns 401 without the bearer token and 200 with it, and running it twice in
  a row produces one `public_platform_stats` row with an advanced `refreshed_at` and no
  duplicate snapshots.
- The landing page renders with the stats block hidden when every figure is zero, and shows it
  once `public_platform_stats` has non-zero values.

## Acceptance criteria

- [ ] A sponsor can open `/sponsor/impact`, see a year, open the report, and save it as a PDF
      from the browser print dialog with the portal chrome absent and page breaks landing
      between team cards.
- [ ] The report shows pledged vs received as distinct figures, and the difference is labelled
      outstanding with a footnote explaining that the platform never handles funds.
- [ ] Every team section shows team number, region, non-PII facts, students reached, events
      hosted, volunteer hours, achievements, and delivered recognition benefits.
- [ ] `findForbiddenKeys()` returns `[]` for a payload built from a fixture in which every
      forbidden column is populated, and the serialised payload contains no sentinel value.
- [ ] `grep -rn "profiles" lib/impact-report/` returns nothing.
- [ ] `grep -rn "\.\.\." lib/impact-report/projection.ts` shows no object spread.
- [ ] A team with `media_no_minors_confirmed_at IS NULL` contributes zero photos to any report.
- [ ] Editing `media_urls` clears the affirmation automatically (trigger-verified, not
      action-verified).
- [ ] Sponsor B receives none of Sponsor A's data from the sponsor route, from a forged
      `sponsorId` parameter, or directly from PostgREST.
- [ ] Anon reading `impact_report_snapshots` gets `[]`; anon reading `public_platform_stats`
      gets one row.
- [ ] A closed year's payload is byte-identical before and after the underlying team data
      changes, and regeneration is refused with a clear message.
- [ ] An admin can reopen a closed year with a reason, regenerate, and re-close — each step
      leaving an `audit_log` row.
- [ ] `/api/cron/impact-rollup` rejects a missing or wrong bearer token and refreshes
      `public_platform_stats` with a correct token; `vercel.json` schedules it.
- [ ] The landing page shows live numbers when they exist, hides the block entirely when every
      figure is zero, and still renders if the stats query throws.
- [ ] The admin platform aggregate CSV downloads and contains no sponsor contact details.
- [ ] `app/api/admin/export/route.ts` behaves identically to before (same headers, same rows) —
      only its import of the two CSV helpers changed.
- [ ] The migration applies cleanly twice in a row with `psql -f`.
- [ ] `npm run typecheck && npm run lint && npm run build && npm run test` all pass.

## Rollback

```sql
BEGIN;

-- 1. Detach the trigger from teams first; teams itself is otherwise unmodified except for
--    the one nullable column, which is harmless to leave in place.
DROP TRIGGER IF EXISTS reset_media_affirmation ON teams;
DROP FUNCTION IF EXISTS trg_reset_media_affirmation();

-- 2. Drop this migration's tables.
DROP TABLE IF EXISTS impact_report_snapshots;
DROP TABLE IF EXISTS public_platform_stats;

DROP FUNCTION IF EXISTS upsert_impact_snapshot(uuid, text, uuid, int, jsonb, int);
DROP FUNCTION IF EXISTS close_impact_report_year(uuid, int);
DROP FUNCTION IF EXISTS reopen_impact_report_year(uuid, int, text);
DROP FUNCTION IF EXISTS refresh_public_platform_stats();

-- 3. teams.media_no_minors_confirmed_at is INTENTIONALLY NOT DROPPED. It holds a coach's
--    explicit consent decision; dropping it destroys that consent record and a re-apply
--    would silently re-include photos the coach had never re-affirmed. Leave the column.
--    Drop it manually only if the feature is being abandoned permanently.

COMMIT;
```

Order for the code revert: remove the `vercel.json` cron entry and deploy **before** dropping
the functions, or the 03:00 run will 500 on a missing RPC. `app/page.tsx` must lose its
`public_platform_stats` read before the table is dropped — that read is wrapped in a try/catch
falling back to `PLATFORM_STATS_FALLBACK`, so the landing page degrades rather than breaking,
but do not rely on it. `git revert` of this prompt's commit restores
`app/api/admin/export/route.ts`'s inline helpers along with everything else.

## Commit

```
feat(impact): sponsor CSR impact reports and platform aggregate

A sponsor had no way to justify the spend internally: the only export
was the admin submissions CSV, which is both unreachable to them and the
wrong document. Adds impact_report_snapshots — a frozen, per-sponsor,
per-year payload written by a nightly rollup and closed each January so a
published report never changes underneath its reader — plus a
public_platform_stats row of seven integers behind an anon policy that
finally puts live numbers on the landing page. The payload is built by a
single code projection whose COPPA allowlist drives both the PostgREST
select and the explicit key-by-key output, so no student PII can reach a
report by accident; portfolio photos are excluded until a coach affirms
they contain no identifiable students, and that affirmation is cleared
automatically whenever the photos change. Output is a print-optimised
HTML report (browser Save-as-PDF) and a sponsor-scoped CSV route that
resolves the sponsor from the session and never from the query string.
```
