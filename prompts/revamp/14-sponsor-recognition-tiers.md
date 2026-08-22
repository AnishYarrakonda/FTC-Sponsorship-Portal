# Prompt 14 — Sponsor recognition tiers & benefit fulfillment

> **Prerequisites:** `01` (the `funding_fulfillments` state machine — this slice hangs off it)
> **Reserved migration:** `0087_recognition_tiers.sql` — verify it is still free with `ls supabase/migrations | tail -3`
> **Scope:** large · ~18 files
> **Leaves the repo:** green and shippable on its own

## Why this exists

A corporation does not write a $10,000 check out of goodwill alone. Marketing pays for
visibility, and the CFO signing the cheque needs a line item. Today this product promises a
sponsor **nothing concrete** in return for money. Read the two sponsor-facing artifacts and
you will not find a single deliverable:

- `emails/submission-email.tsx` — the only pitch a sponsor ever receives — ends with a budget
  table (`:138-158`), a "View Proposal & Respond" button (`:163-172`) and a tax-deductibility
  footnote (`:180-185`). It never says what the sponsor gets.
- `app/sponsor-view/[token]/page.tsx` renders eight cards (story, credibility, impact,
  budget, media, engineering) and a decision panel (`:308-314`). Not one of them describes a
  benefit flowing back to the sponsor.

So the sponsor is asked to fund a "Budget Breakdown" with no stated return, and after they
fund, nothing in the system ever asks the team to put a logo anywhere. `grep -rin
"recognition\|logo_on\|benefit" app lib supabase --include=*.ts --include=*.tsx
--include=*.sql` returns only `logo_url` columns and unrelated matches.

This slice adds the recognition ladder, pins what was promised at the moment money settles,
gives the coach a delivery checklist with photo proof, and shows the sponsor owed-vs-delivered.

## Current state (verified)

**What exists**

- **The money spine, from prompt 01.** `funding_fulfillments` (one row per settled
  `transactions_ledger` commitment, `amount_cents` copied 1:1 from the ledger row) with the
  lifecycle `pledged → agreement_signed → payment_sent → payment_received → receipted`
  (plus `cancelled`), the append-only `funding_fulfillment_events` trail,
  `can_read_fulfillment(uuid)`, and `record_fulfillment_transition(...)`. Rows are created
  inside the settle transaction by both settle RPCs.
- `supabase/migrations/0017_transactions_ledger.sql:4-14` — `transactions_ledger`, append-only,
  `amount_cents bigint CHECK (amount_cents > 0)`, admin-only SELECT at `:23-24` (0069 later
  adds sponsor and coach SELECT).
- **Storage.** `pitch-media` is created public at `supabase/migrations/0005_pitch_storage.sql:2-4`
  ("public for easy email rendering"). Its live INSERT policy is
  `supabase/migrations/0051_clerk_auth.sql:321-329`:
  ```sql
  bucket_id = 'pitch-media' AND (auth.jwt() ->> 'sub') = (storage.foldername(name))[1]
  ```
  Public SELECT is `0005:16-18`. `0048_storage_limits.sql:44-47` caps the bucket at 5 MB and
  `array['image/jpeg','image/png','image/webp','image/gif']`.
- **Upload precedent.** `app/actions/team.ts:203-243` (`uploadTeamLogo`) is the shape to copy:
  prove ownership *before* writing anything (`:203-211`), `validateUploadedFile(file, {
  allowedMimes: IMAGE_MIMES, maxBytes, label })` from `lib/file-validation.ts` (`:218-223`),
  then a path built from the **verified** extension and the Clerk id:
  `` `${clerkUserId}/${teamId}.${ext}` `` (`:226`).
- **RPC error mapping.** `app/actions/sponsor-decision.ts:25-38` (`mapDecisionError`) is the
  house style: a `Record<string, string>` from RPC error code to user-facing sentence, with a
  generic fallback.
- **Audit + notify.** `app/actions/admin.ts:59-64` is the canonical `audit_log` insert;
  `lib/notify.ts:255-320` is `createInAppNotification`, which writes the inbox row **and**
  emails the recipient unless `skipEmail: true`.
- **Dispatch.** `lib/dispatch.ts:36-40` is `dispatchApprovedSubmission(submissionId,
  accessToken?, options?)`. It loads the submission with the admin client (`:44-57`), builds
  `SubmissionEmail` props (`:90-109`) and sends with a sha256 `idempotencyKey` (`:119-121`).
  `lib/dispatch-budget.ts` exists **only** because importing `lib/dispatch.ts` constructs a
  Resend client at module scope (`lib/dispatch.ts:10`) — any helper needed by both dispatch
  and a page must live outside `lib/dispatch.ts`.
- **Nav.** `components/coach/coach-sidebar.tsx:29-33` navigates entirely by query tab
  (`/dashboard?tab=…`), matched against `TABS` / `TAB_ALIASES` in
  `components/coach/dashboard-shell.tsx:38-53`.
  `components/sponsor/sponsor-sidebar.tsx:27-30` and `components/admin/admin-sidebar.tsx:29-34`
  use real routes.
- **Public routes.** `middleware.ts:5-19`. `/sponsor-view(.*)` is already public (`:12`).

**What is missing**

No tier concept, no benefit concept, no delivery tracking, no proof storage, no admin screen
for any of it, and no mention of a sponsor deliverable in either sponsor-facing artifact.
There is also **no settings/config table anywhere** — `grep -rniE "create table.*(settings|config)"
supabase/migrations` returns nothing — so this migration introduces the project's first
admin-editable configuration table, and it must behave like one.

**Two facts that shape the design (both verified, both easy to get wrong)**

1. **There is no separate "received amount".** `funding_fulfillments.amount_cents` is copied
   from `transactions_ledger.amount_cents` at settle and is never rewritten by
   `record_fulfillment_transition` — the transition RPC moves `status` and stamps `*_at`
   columns, nothing more. So "the settled ledger amount" and "the fulfillment's amount" are
   the same number by construction. §Data model picks a single read site and says why.
2. **`pitch-media` has no UPDATE and no DELETE policy.** `0005` and `0051:321-329` define only
   INSERT and public SELECT for that bucket; only `pitch-storage` (`0051:330-337`) and
   `team-logos` got delete/update policies. A coach therefore **cannot overwrite or remove** a
   `pitch-media` object from the browser client. Design around it (see §Photo proof) — do not
   add a DELETE policy in this slice.

## What you are building

1. Migration `0087_recognition_tiers.sql`:
   - two enums (`recognition_benefit_type`, `recognition_delivery_status`),
   - table `recognition_tiers` (admin-editable, seeded),
   - table `sponsor_recognition_awards` (the pinned promise, one per fulfillment),
   - table `recognition_benefit_deliveries` (one row per promised benefit),
   - `recognition_tier_for_amount(bigint)` — **the only place threshold math exists**,
   - `recognition_tier_ladder()` — the pitch-time preview,
   - `can_read_recognition_award(uuid)` — policy helper, not revoked,
   - trigger `trg_create_recognition_award` on `funding_fulfillments`,
   - RPCs `record_benefit_delivery(...)`, `void_benefit_proof(...)`,
     `admin_upsert_recognition_tier(...)`, `admin_archive_recognition_tier(...)`,
   - RLS + per-role policies + REVOKE/GRANT on every SECURITY DEFINER function,
   - a backfill for fulfillments that predate this migration.
2. `lib/recognition.ts` — benefit/status constants, labels, and the ladder fetch helper.
   **No threshold arithmetic.**
3. `lib/schemas/recognition.ts` + four new keys in `lib/schemas/limits.ts`.
4. `app/actions/recognition.ts` — five server actions.
5. Coach delivery checklist (new dashboard tab), sponsor owed-vs-delivered page, admin tier
   editor.
6. The recognition ladder inside the pitch — `emails/submission-email.tsx` and
   `app/sponsor-view/[token]/page.tsx`, both fed **only** through the existing gated path.
7. Dev-preview fixtures + tests.

## Data model

### Enums

```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'recognition_benefit_type') THEN
    CREATE TYPE recognition_benefit_type AS ENUM (
      'logo_on_robot',
      'logo_on_team_shirt',
      'logo_on_website',
      'social_media_mention',
      'event_signage',
      'mention_in_outreach_materials'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'recognition_delivery_status') THEN
    CREATE TYPE recognition_delivery_status AS ENUM (
      'promised', 'in_progress', 'delivered', 'waived', 'not_applicable'
    );
  END IF;
END $$;
```

All values declared at type creation so a from-scratch replay works (_CONTEXT §8.1).
`waived` means the **sponsor** said "don't bother"; `not_applicable` means an **admin**
determined the benefit cannot exist for this team (an incubator team with no robot yet).
Neither is a failure.

### `recognition_tiers` — the admin-editable configuration

```sql
CREATE TABLE IF NOT EXISTS recognition_tiers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 60),
  -- Display order, low = entry tier. Unique among live tiers only (see index below), so an
  -- archived tier does not permanently burn a rank number.
  rank              int  NOT NULL CHECK (rank >= 0),
  -- Thresholds in CENTS, to match every other money column in the schema
  -- (transactions_ledger.amount_cents, sponsors.funding_cap_cents, teams.financial_ask_cents).
  min_amount_cents  bigint NOT NULL CHECK (min_amount_cents >= 0),
  -- NULL = open-ended top tier. Exclusive upper bound.
  max_amount_cents  bigint CHECK (max_amount_cents IS NULL OR max_amount_cents > min_amount_cents),
  benefits          recognition_benefit_type[] NOT NULL DEFAULT '{}'::recognition_benefit_type[],
  description       text CHECK (description IS NULL OR char_length(description) <= 500),
  -- Soft delete. Archiving a tier stops it being awarded; it NEVER touches awards already
  -- pinned against it (that is the whole point of the snapshot below).
  archived_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_recognition_tier_rank_live
  ON recognition_tiers(rank) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_recognition_tier_min_live
  ON recognition_tiers(min_amount_cents) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_recognition_tiers_live
  ON recognition_tiers(min_amount_cents DESC) WHERE archived_at IS NULL;
```

Seed four tiers in the migration, guarded by `WHERE NOT EXISTS` on `name` so a replay is a
no-op. These are defaults an admin is expected to edit, not a specification:

| rank | name | min | max | benefits |
|---|---|---|---|---|
| 0 | Supporter | $250 | $1,000 | `logo_on_website` |
| 1 | Bronze | $1,000 | $2,500 | `logo_on_website`, `social_media_mention` |
| 2 | Silver | $2,500 | $7,500 | + `logo_on_team_shirt`, `mention_in_outreach_materials` |
| 3 | Gold | $7,500 | NULL | + `logo_on_robot`, `event_signage` |

**No `EXCLUDE` constraint on the ranges.** It would need `btree_gist`, and adding an extension
to satisfy a constraint we can enforce in the one function that writes the table is not worth
the deploy risk. Overlap is rejected by `admin_upsert_recognition_tier` (below), and
`recognition_tier_for_amount` is total-order safe even if a gap or overlap somehow exists.

### `sponsor_recognition_awards` — the pinned promise

**Pinning mechanism: snapshot, not tier versioning.** Both were on the table; snapshot wins on
three concrete grounds. (a) The coach's checklist needs one row per promised benefit anyway —
each carries its own status, proof and timestamps — so materialising the benefit list is work
we must do regardless; versioning would leave us doing *both*. (b) Versioning makes every read
a two-hop join (`award → tier_version → tier`) and makes "what did we promise Acme in March"
answerable only by reconstructing history. (c) An admin editing a threshold is a routine
operation here (there is no config UI at all today, so it *will* be used); a design where the
routine operation forks a row into a version chain accumulates dead rows forever.

```sql
CREATE TABLE IF NOT EXISTS sponsor_recognition_awards (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- One award per settled commitment. UNIQUE is what makes the trigger and the backfill
  -- idempotent. CASCADE, unlike prompt 01's RESTRICT on transaction_id: a fulfillment row is
  -- the parent record and an award without one is meaningless.
  fulfillment_id        uuid NOT NULL UNIQUE REFERENCES funding_fulfillments(id) ON DELETE CASCADE,
  -- Denormalised from the fulfillment so every RLS policy on this table is a single sublink,
  -- exactly like ledger_select_sponsor / ledger_select_coach in 0069. Mirror the fulfillment's
  -- nullability: sponsor_id NOT NULL/RESTRICT, team_id nullable ON DELETE SET NULL so a Clerk
  -- account deletion (which runs no app code) is never blocked by this table.
  sponsor_id            uuid NOT NULL REFERENCES sponsors(id) ON DELETE RESTRICT,
  team_id               uuid          REFERENCES teams(id)    ON DELETE SET NULL,
  -- The amount the tier was derived from. Copied, never recomputed. See §Threshold math.
  amount_cents          bigint NOT NULL CHECK (amount_cents > 0),

  -- ── THE SNAPSHOT ──────────────────────────────────────────────────────────────────
  -- tier_id is a breadcrumb for admin reporting only. It is SET NULL on delete and NOTHING
  -- reads through it to decide what was promised. Every value the product displays or
  -- enforces comes from the *_snapshot columns and from recognition_benefit_deliveries.
  tier_id               uuid REFERENCES recognition_tiers(id) ON DELETE SET NULL,
  tier_name_snapshot    text   NOT NULL,
  tier_rank_snapshot    int    NOT NULL,
  tier_min_amount_cents_snapshot bigint NOT NULL,
  benefits_snapshot     recognition_benefit_type[] NOT NULL,
  -- ──────────────────────────────────────────────────────────────────────────────────

  awarded_at            timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recognition_awards_sponsor ON sponsor_recognition_awards(sponsor_id);
CREATE INDEX IF NOT EXISTS idx_recognition_awards_team    ON sponsor_recognition_awards(team_id);
```

`benefits_snapshot` is redundant with the delivery rows *by design*: the delivery rows can be
marked `not_applicable`, so only the array still answers "what did we originally promise".
Keep both.

### `recognition_benefit_deliveries` — the checklist

```sql
CREATE TABLE IF NOT EXISTS recognition_benefit_deliveries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  award_id          uuid NOT NULL REFERENCES sponsor_recognition_awards(id) ON DELETE CASCADE,
  benefit_type      recognition_benefit_type NOT NULL,
  status            recognition_delivery_status NOT NULL DEFAULT 'promised',
  -- Public pitch-media URL. COPPA: this is a photo of a ROBOT, a SHIRT, SIGNAGE or a WEBSITE.
  -- Never a photo of a student, never a face. See §Photo proof.
  proof_url         text CHECK (proof_url IS NULL OR char_length(proof_url) <= 1000),
  proof_uploaded_at timestamptz,
  -- Set when the coach ticks the no-minors affirmation. A proof_url may only be written in
  -- the same statement that stamps this; enforced in record_benefit_delivery, asserted by
  -- the CHECK below so no future writer can bypass it.
  no_minors_confirmed_at timestamptz,
  delivered_at      timestamptz,
  coach_note        text CHECK (coach_note IS NULL OR char_length(coach_note) <= 1000),
  -- The COPPA takedown lever. An admin voiding a proof clears proof_url and stamps these.
  admin_voided_at   timestamptz,
  admin_void_reason text CHECK (admin_void_reason IS NULL OR char_length(admin_void_reason) <= 500),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uniq_delivery_per_benefit UNIQUE (award_id, benefit_type),
  -- Fails CLOSED: a proof cannot exist without the affirmation, at the storage layer of the
  -- database, not merely in the action that happens to write it today.
  CONSTRAINT proof_requires_no_minors_affirmation
    CHECK (proof_url IS NULL OR no_minors_confirmed_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_benefit_deliveries_award ON recognition_benefit_deliveries(award_id);
-- The coach's "what do I still owe" list and the sponsor's "what am I still owed" list read
-- exactly this predicate.
CREATE INDEX IF NOT EXISTS idx_benefit_deliveries_open
  ON recognition_benefit_deliveries(award_id, status)
  WHERE status IN ('promised', 'in_progress');
```

Attach the project's shared `updated_at` trigger if one exists
(`grep -rn "set_updated_at\|handle_updated_at" supabase/migrations | head`); if there is no
shared helper, set `updated_at = now()` inside each RPC and do not invent a trigger — same
instruction prompt 01 gives for `funding_fulfillments`.

### Threshold math — one function, one call site each

**The tier is derived from `funding_fulfillments.amount_cents`.**

Justification, and read this before arguing for the alternative: prompt 01 copies
`transactions_ledger.amount_cents` into `funding_fulfillments.amount_cents` inside the settle
transaction and `record_fulfillment_transition` never rewrites it, so *the two candidate
values are the same integer*. What differs is only which table you join. Reading the
fulfillment is strictly better because the trigger that pins the award already has the
fulfillment row in `NEW`, so there is no join at all, no chance of picking up a second ledger
row for the same submission, and no dependency on `transactions_ledger`'s RLS (admin-only
until 0069) from a path that also runs for coaches.

There is deliberately **no "received amount"** input. Tier is pinned at *settle*, not at
`payment_received`, because: the coach must know what to deliver the day the sponsorship is
agreed, not six weeks later; the sponsor must see what they bought at the moment they commit;
and prompt 01's model has no partial-receipt amount to read even if we wanted one — a partial
commitment already produces its own smaller ledger row and therefore its own smaller
fulfillment and its own (lower) tier.

```sql
-- THE ONLY PLACE A THRESHOLD IS COMPARED TO AN AMOUNT. Anywhere else in the stack —
-- TypeScript, a React component, a second SQL function — is a bug.
CREATE OR REPLACE FUNCTION recognition_tier_for_amount(p_amount_cents bigint)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT t.id
    FROM recognition_tiers t
   WHERE t.archived_at IS NULL
     AND p_amount_cents >= t.min_amount_cents
     AND (t.max_amount_cents IS NULL OR p_amount_cents < t.max_amount_cents)
   ORDER BY t.min_amount_cents DESC
   LIMIT 1;
$$;
```

`ORDER BY … DESC LIMIT 1` is what makes this total: with a mis-entered overlap the highest
qualifying tier wins deterministically rather than the query erroring or returning two rows.
An amount below the lowest tier returns `NULL`, which means **no award row is created at all**
— a $100 pledge earns no recognition, and the product says nothing rather than inventing a
tier. State that in a SQL comment.

```sql
REVOKE EXECUTE ON FUNCTION recognition_tier_for_amount(bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION recognition_tier_for_amount(bigint) FROM anon;
REVOKE EXECUTE ON FUNCTION recognition_tier_for_amount(bigint) FROM authenticated;
GRANT  EXECUTE ON FUNCTION recognition_tier_for_amount(bigint) TO service_role;
```

### `recognition_tier_ladder()` — the pitch-time preview

The pitch has to show the ladder *before* any fulfillment exists. Rather than let a component
build it from a raw table read (which is how threshold logic escapes into the UI), expose one
function returning the whole live ladder, already ordered:

```sql
CREATE OR REPLACE FUNCTION recognition_tier_ladder()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'rank'), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
               'id', t.id, 'name', t.name, 'rank', t.rank,
               'min_amount_cents', t.min_amount_cents,
               'max_amount_cents', t.max_amount_cents,
               'benefits', to_jsonb(t.benefits),
               'description', t.description
             ) AS x
        FROM recognition_tiers t
       WHERE t.archived_at IS NULL
    ) s;
$$;
```

Same four REVOKE/GRANT lines. Called server-side only, via the admin client, from
`lib/recognition.ts`.

### RLS policies

`ALTER TABLE … ENABLE ROW LEVEL SECURITY` on all three tables.

**`recognition_tiers`** — this is public-facing product copy, not private data:

- `recognition_tiers_select_all` · SELECT · `TO anon, authenticated` · `USING (archived_at IS NULL)`
  — the ladder appears on a token-gated page rendered for a signed-out sponsor, and the
  thresholds are advertised in the pitch email anyway. Archived tiers stay hidden.
- `recognition_tiers_select_admin` · SELECT · `USING (is_admin())` — admins also see archived.
- **No INSERT / UPDATE / DELETE policies.** Writes go through
  `admin_upsert_recognition_tier` / `admin_archive_recognition_tier` on the service role.

**`sponsor_recognition_awards`**

- `recognition_awards_select_admin` · SELECT · `USING (is_admin())`
- `recognition_awards_select_sponsor` · SELECT ·
  `USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = current_profile_id() AND p.role = 'sponsor' AND p.sponsor_id IS NOT NULL AND p.sponsor_id = sponsor_recognition_awards.sponsor_id))`
  — byte-for-byte the shape of `ledger_select_sponsor` (0069) and of
  `fulfillments_select_sponsor` (prompt 01).
- `recognition_awards_select_coach` · SELECT ·
  `USING (sponsor_recognition_awards.team_id IS NOT NULL AND EXISTS (SELECT 1 FROM teams t WHERE t.id = sponsor_recognition_awards.team_id AND t.owner_id = current_profile_id()))`
- **No INSERT / UPDATE / DELETE policies.**

**`recognition_benefit_deliveries`**

- `benefit_deliveries_select` · SELECT · `USING (can_read_recognition_award(award_id))`
- **No INSERT / UPDATE / DELETE policies.** The coach's checkbox goes through
  `record_benefit_delivery`, called by a server action on the admin client. This is the same
  no-write-policies stance prompt 01 takes for `funding_fulfillments` and that
  `transactions_ledger` and `audit_log` already take.

### `can_read_recognition_award(uuid)`

An inline sublink from the deliveries policy back into `sponsor_recognition_awards` makes the
planner evaluate *that* table's policies, which themselves sublink into `profiles` and `teams`
— the exact nesting that produced 42P17 in 0066 and that prompt 01 wraps in
`can_read_fulfillment()`. Follow the precedent:

```sql
CREATE OR REPLACE FUNCTION can_read_recognition_award(p_award_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM sponsor_recognition_awards a
     WHERE a.id = p_award_id
       AND (
         is_admin()
         OR EXISTS (SELECT 1 FROM profiles p
                     WHERE p.id = current_profile_id() AND p.role = 'sponsor'
                       AND p.sponsor_id IS NOT NULL AND p.sponsor_id = a.sponsor_id)
         OR (a.team_id IS NOT NULL AND EXISTS (
               SELECT 1 FROM teams t WHERE t.id = a.team_id AND t.owner_id = current_profile_id()))
       )
  );
$$;
```

**Do NOT revoke EXECUTE on this one.** Like `is_admin()`, `current_profile_id()`,
`sponsor_can_view_team()` and prompt 01's `can_read_fulfillment()`, it is evaluated inside an
RLS policy as the calling role; revoking from `authenticated` makes every read raise 42501.
0062's own comment warns about this.

### Award creation — a trigger, not another settle-RPC rewrite

Prompt 01 had no choice but to edit both settle RPCs: the new `transaction_id` only exists
inside them. **This slice has a choice, and takes the safer one.** The `funding_fulfillments`
INSERT *is* the settle event, it runs in the settle transaction, and a row-level trigger sees
it. Reproducing `sponsor_decide_submission_atomic` (~135 lines) and
`record_sponsor_decision_atomic` (~100 lines) verbatim for a **third** time, where a single
dropped line silently reintroduces the double-debit or strands a partial's remainder, is a
risk with no upside here. Triggers are an established idiom in this schema —
`trg_release_reservation_on_delete` (0067) exists precisely to catch a CASCADE that runs no
app code.

```sql
CREATE OR REPLACE FUNCTION trg_create_recognition_award()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tier recognition_tiers%ROWTYPE;
  v_award_id uuid;
  v_benefit recognition_benefit_type;
BEGIN
  SELECT * INTO v_tier FROM recognition_tiers
   WHERE id = recognition_tier_for_amount(NEW.amount_cents);

  -- Below the entry tier, or no live tiers configured: no recognition, no row, no noise.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  INSERT INTO sponsor_recognition_awards (
    fulfillment_id, sponsor_id, team_id, amount_cents,
    tier_id, tier_name_snapshot, tier_rank_snapshot,
    tier_min_amount_cents_snapshot, benefits_snapshot
  ) VALUES (
    NEW.id, NEW.sponsor_id, NEW.team_id, NEW.amount_cents,
    v_tier.id, v_tier.name, v_tier.rank, v_tier.min_amount_cents, v_tier.benefits
  )
  ON CONFLICT (fulfillment_id) DO NOTHING
  RETURNING id INTO v_award_id;

  IF v_award_id IS NULL THEN            -- already awarded; nothing to materialise
    RETURN NEW;
  END IF;

  -- Materialise the promise. THIS is the pinning: once these rows exist, editing the tier
  -- cannot reach them.
  FOREACH v_benefit IN ARRAY v_tier.benefits LOOP
    INSERT INTO recognition_benefit_deliveries (award_id, benefit_type)
    VALUES (v_award_id, v_benefit)
    ON CONFLICT (award_id, benefit_type) DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS create_recognition_award ON funding_fulfillments;
CREATE TRIGGER create_recognition_award
  AFTER INSERT ON funding_fulfillments
  FOR EACH ROW EXECUTE FUNCTION trg_create_recognition_award();
```

Four REVOKE/GRANT lines on `trg_create_recognition_award()` as well — a trigger function is
still a SECURITY DEFINER function reachable by name, and Postgres defaults to PUBLIC.

Notifying the coach is **not** done here. A trigger must not perform side effects the settle
transaction can roll back or that a DB-level test cannot control; the notification is sent by
whichever server action observes the new award (see §Server actions, `syncRecognitionForFulfillment`)
— or on first render of the checklist. Do not call `pg_notify` or write a notification row
from the trigger.

### `record_benefit_delivery`

```sql
record_benefit_delivery(
  p_delivery_id       uuid,
  p_actor_profile_id  uuid,
  p_status            recognition_delivery_status,
  p_proof_url         text    DEFAULT NULL,
  p_no_minors_confirmed boolean DEFAULT false,
  p_note              text    DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
```

Body, in order:

1. **Actor resolution — the three-branch form**, copied from prompt 01's
   `record_fulfillment_transition`:
   ```plpgsql
   IF (auth.jwt() ->> 'sub') IS NOT NULL THEN
     v_actor := current_profile_id();
     IF v_actor IS NULL OR v_actor <> p_actor_profile_id THEN
       RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
     END IF;
   ELSIF is_trusted_server_context() THEN
     v_actor := p_actor_profile_id;
   ELSE
     RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
   END IF;
   ```
   0065's bare `ELSE` is the pre-0072 shape and admits the anon key. Do not copy it.
2. Load the delivery joined to its award `FOR UPDATE` on `recognition_benefit_deliveries`;
   not found → `delivery_not_found`.
3. Derive `v_actor_role`: admin → `'admin'`; profile whose `sponsor_id = award.sponsor_id` →
   `'sponsor'`; owner of `award.team_id` → `'coach'`; otherwise → `unauthorized`.
4. **Who may set what** — enforce here, comment it in SQL:

   | Target status | coach | sponsor | admin |
   |---|---|---|---|
   | `in_progress` | ✅ | ❌ | ✅ |
   | `delivered` | ✅ | ❌ | ✅ |
   | `promised` (undo) | ✅ | ❌ | ✅ |
   | `waived` | ❌ | ✅ | ✅ |
   | `not_applicable` | ❌ | ❌ | ✅ |

   A sponsor cannot mark their own benefit delivered — that is the team's claim to make. A
   coach cannot waive a benefit they owe. Violations → `role_not_permitted`.
5. Terminal guard: a row with `status = 'waived'` may only be moved by an admin →
   `already_waived`.
6. `p_status = p_current` → `already_in_status` (a soft error the action treats as success,
   same convention as prompt 01).
7. **Proof rules.** If `p_proof_url IS NOT NULL`: require `p_no_minors_confirmed = true` →
   `no_minors_affirmation_required`; require the URL to be an `https://` URL on the project's
   Supabase host containing `/pitch-media/` → `invalid_proof_url` (the real gate is the
   storage RLS policy, this stops a wrong-bucket or off-host string being stored); stamp
   `proof_uploaded_at = now()`, `no_minors_confirmed_at = now()`, and clear
   `admin_voided_at`/`admin_void_reason`. Proof is **optional** for `delivered` — a
   `logo_on_website` benefit is verified by visiting the site.
8. UPDATE: `status`, `delivered_at = now()` when moving to `delivered` (NULL it when moving
   back to `promised`/`in_progress`), `coach_note` from `p_note`, `updated_at = now()`.
9. INSERT `audit_log`: `action = 'benefit_delivery_recorded'`, `entity_type =
   'recognition_benefit_deliveries'`, `entity_id = p_delivery_id`, `metadata = {award_id,
   benefit_type, from_status, to_status, actor_role, has_proof}`. `has_proof` is a boolean —
   **do not put the proof URL in `audit_log.metadata`**; it is a public URL to a photograph and
   `audit_log` has no expiry.
10. `RETURN jsonb_build_object('ok', true, 'status', p_status, 'from_status', v_from);`

### `void_benefit_proof` — the COPPA takedown lever

```sql
void_benefit_proof(p_delivery_id uuid, p_actor_profile_id uuid, p_reason text) RETURNS jsonb
```

Admin only (same three-branch actor resolution, then `is_admin()`-equivalent check on the
resolved profile → else `unauthorized`). Requires a reason of at least 10 characters →
`reason_required`. Clears `proof_url` and `no_minors_confirmed_at`, stamps `admin_voided_at`
and `admin_void_reason`, drops the status back to `in_progress`, writes `audit_log` action
`void_benefit_proof`.

It deliberately does **not** delete the storage object: `pitch-media` has no DELETE policy
(§Current state, fact 2) and the service role deleting from a bucket with no delete policy is
a separate change. Removing it from the product is what matters; the orphaned object is a
tracked follow-up, and the void reason tells an admin to purge it out of band if it is
genuinely a COPPA violation rather than a bad crop.

### `admin_upsert_recognition_tier` / `admin_archive_recognition_tier`

```sql
admin_upsert_recognition_tier(
  p_actor_profile_id uuid,
  p_tier_id          uuid,     -- NULL = create
  p_name             text,
  p_rank             int,
  p_min_amount_cents bigint,
  p_max_amount_cents bigint,
  p_benefits         recognition_benefit_type[],
  p_description      text
) RETURNS jsonb
```

- Three-branch actor resolution, then admin-only → `unauthorized`.
- `LOCK TABLE recognition_tiers IN SHARE ROW EXCLUSIVE MODE;` before validating, so two
  concurrent admin saves cannot both pass the overlap check.
- Validate: `p_max_amount_cents IS NULL OR p_max_amount_cents > p_min_amount_cents` →
  `invalid_range`; the `[min, max)` interval must not overlap any other live tier →
  `overlapping_tier` (return the conflicting tier's name in the JSON so the UI can name it);
  at most one live tier may have `max_amount_cents IS NULL` → `multiple_open_tiers`.
- Upsert, `updated_at = now()`, write `audit_log` action `recognition_tier_upserted` with the
  full before/after in `metadata` (this is configuration, not personal data — a full snapshot
  is the right thing to keep).
- **Return, in the JSON, `awards_affected: 0`** and comment why: editing a tier is by
  construction incapable of touching `sponsor_recognition_awards`. There is no UPDATE
  statement against that table anywhere in this function, and the acceptance criteria assert
  it empirically.

`admin_archive_recognition_tier(p_actor_profile_id, p_tier_id)` stamps `archived_at = now()`,
refuses if it is the only live tier → `last_live_tier`, audits `recognition_tier_archived`.

All four RPCs get:

```sql
REVOKE EXECUTE ON FUNCTION <name>(<full arg type list>) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION <name>(<full arg type list>) FROM anon;
REVOKE EXECUTE ON FUNCTION <name>(<full arg type list>) FROM authenticated;
GRANT  EXECUTE ON FUNCTION <name>(<full arg type list>) TO service_role;
```

Postgres defaults to PUBLIC; this bit the project in 0062.

### Backfill

```sql
-- Fulfillments that settled before this migration get the tier they would have earned under
-- the tier table as it exists RIGHT NOW. That is the only defensible choice — the tiers did
-- not exist at settle time, so there is nothing historical to honour.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT f.* FROM funding_fulfillments f
     WHERE NOT EXISTS (SELECT 1 FROM sponsor_recognition_awards a WHERE a.fulfillment_id = f.id)
       AND f.status <> 'cancelled'
  LOOP
    PERFORM trg_backfill_recognition_award(r.id);   -- thin wrapper reusing the trigger body
  END LOOP;
END $$;
```

Factor the trigger body into `create_recognition_award_for_fulfillment(p_fulfillment_id uuid)`
and have both the trigger and the backfill call it, so the two can never drift. Idempotent via
`ON CONFLICT (fulfillment_id) DO NOTHING`. Pre-launch there is no production data, but the
backfill must be present and correct — and it is what makes this migration safe to apply after
prompt 01 has already been running.

## Server actions

New file `app/actions/recognition.ts`, canonical 5-step shape
(`.claude/rules/conventions.md`). Every action catches guard throws and returns
`{ error: e.message }`. Map RPC error codes through a local `mapRecognitionError()` built in
the style of `mapDecisionError` (`app/actions/sponsor-decision.ts:25-38`).

```ts
markBenefitDelivered(input: {
  deliveryId: string
  status: 'promised' | 'in_progress' | 'delivered'
  note?: string
}): Promise<{ success?: true; error?: string }>
```
- Guard: `requireVerifiedCoach()` — surface `e.code === 'NEEDS_VERIFICATION'` so the UI can
  show the verification CTA.
- Pre-check with `adminClient`: the delivery's award `team_id` must belong to a team the
  caller owns, else `'Benefit not found.'` (never leak that it exists). The RPC re-checks;
  this is the friendly path.
- Audit `'mark_benefit_delivered'` with `{ delivery_id, benefit_type, status }`.
- On `delivered`, notify **every** profile with `role='sponsor'` and
  `sponsor_id = award.sponsor_id` (the same fan-out prompt 01 uses for
  `confirmPaymentReceived`), `type: 'general'`.
- `revalidatePath('/dashboard')`, `revalidatePath('/sponsor/recognition')`.

```ts
uploadBenefitProof(deliveryId: string, formData: FormData):
  Promise<{ success?: true; url?: string; error?: string }>
```
- Guard: `requireVerifiedCoach()` (gives `user`, `clerkUserId`).
- **Ownership is proven BEFORE anything is written** — the exact bug `uploadTeamLogo` fixed
  (`app/actions/team.ts:199-211`): a zero-row UPDATE is not an error, so a caller-supplied id
  once wrote a file to storage and still returned success.
- `formData.get('noMinorsConfirmed') === 'true'` is **required**; without it return
  `'You must confirm the photo contains no students before uploading.'` and upload nothing.
- `validateUploadedFile(file, { allowedMimes: IMAGE_MIMES, maxBytes: 5 * 1024 * 1024, label: 'Proof photo' })`.
  Both the stored `contentType` and the path extension come from the **verified** mime, never
  from `file.name` — copy `app/actions/team.ts:218-229`.
- Path: `` `${clerkUserId}/recognition/${deliveryId}-${Date.now()}.${ext}` `` in `pitch-media`.
  The Clerk id **must** be the first segment or the storage policy at `0051:321-329` rejects
  the insert. `upsert: false` — `pitch-media` has no UPDATE policy (§Current state, fact 2),
  so an upsert of an existing key fails; the timestamp suffix makes every attempt a fresh key.
- Then call `record_benefit_delivery` with the new URL and
  `p_no_minors_confirmed = true`, leaving `p_status` at the row's current value unless the
  caller also asked to mark it delivered.
- Audit `'upload_benefit_proof'` with `{ delivery_id, benefit_type }` — **not the URL**.

```ts
waiveBenefit(input: { deliveryId: string; note?: string }): Promise<{ success?: true; error?: string }>
```
- Guard: `requireSponsor()`. Pre-check the award's `sponsor_id` equals `sponsorId`.
- `p_status = 'waived'`. Audit `'waive_benefit'`. Notify the coach.

```ts
adminSetBenefitStatus(input: {
  deliveryId: string
  status: 'promised' | 'in_progress' | 'delivered' | 'waived' | 'not_applicable'
  reason: string        // required, min 10 chars — an admin override must be explained
}): Promise<{ success?: true; error?: string }>

adminVoidBenefitProof(input: { deliveryId: string; reason: string }):
  Promise<{ success?: true; error?: string }>

adminUpsertRecognitionTier(input: {
  tierId?: string
  name: string
  rank: number
  minAmountCents: number
  maxAmountCents?: number | null
  benefits: RecognitionBenefitType[]
  description?: string
}): Promise<{ success?: true; error?: string }>

adminArchiveRecognitionTier(input: { tierId: string }): Promise<{ success?: true; error?: string }>
```
- All `requireAdmin()`. All audit. `adminVoidBenefitProof` notifies **both** counterparties
  that a proof was removed and why — the coach needs to re-upload and the sponsor should not
  keep seeing a benefit as evidenced.
- `revalidatePath('/recognition')` (admin), `revalidatePath('/sponsor/recognition')`,
  `revalidatePath('/dashboard')`.

```ts
syncRecognitionForFulfillment(fulfillmentId: string): Promise<{ success?: true; error?: string }>
```
- Internal, `requireAdmin()`-guarded, used by the admin reconciliation screen to (re)notify a
  coach about an award the trigger created. Reads the award, and if
  `audit_log` has no `recognition_award_notified` row for it, sends the coach a
  `type: 'general'` notification listing the benefits owed and writes that audit row. This is
  where the "you now owe recognition" message comes from — **not** the trigger.

`notifications.type` is a text column with a CHECK limited to
`submission_declined | submission_approved | submission_changes_requested | coach_verified | general`.
**Use `'general'`. Do not add a CHECK value** — that is a separate migration and is not worth
it for this slice. Same call prompt 01 makes.

### `lib/schemas/limits.ts`

Add, alongside the existing keys (`lib/schemas/limits.ts:1-25`):

```ts
  recognitionTierName: 60,
  recognitionTierDescription: 500,
  recognitionDeliveryNote: 1000,
  recognitionVoidReason: 500,
```

Reference these constants in `lib/schemas/recognition.ts`; never hardcode the numbers. They
must match the SQL `CHECK (char_length(...) <= n)` values exactly.

### `lib/recognition.ts`

Mirror `lib/submission-status.ts` in spirit and comment density — that file exists because
three separate components had each re-derived the status groupings and drifted.

```ts
export const RECOGNITION_BENEFIT_TYPES = [
  'logo_on_robot', 'logo_on_team_shirt', 'logo_on_website',
  'social_media_mention', 'event_signage', 'mention_in_outreach_materials',
] as const
export type RecognitionBenefitType = (typeof RECOGNITION_BENEFIT_TYPES)[number]

export const RECOGNITION_DELIVERY_STATUSES = [
  'promised', 'in_progress', 'delivered', 'waived', 'not_applicable',
] as const
export type RecognitionDeliveryStatus = (typeof RECOGNITION_DELIVERY_STATUSES)[number]

/** Still owed. Drives both the coach's checklist badge and the sponsor's "outstanding" count. */
export const OPEN_DELIVERY_STATUSES = ['promised', 'in_progress'] as const
/** Settled one way or another — no further action expected from anyone. */
export const CLOSED_DELIVERY_STATUSES = ['delivered', 'waived', 'not_applicable'] as const

export function recognitionBenefitLabel(b: RecognitionBenefitType): string  // 'Logo on robot', …
export function recognitionBenefitHint(b: RecognitionBenefitType): string   // what proof looks like
export function deliveryStatusLabel(s: RecognitionDeliveryStatus): string
export function isOpenDelivery(s?: string | null): boolean

/**
 * Fetch the live ladder for the pitch preview. Takes the client as an ARGUMENT and
 * constructs nothing at module scope, so this file stays importable from lib/dispatch.ts
 * (which builds a Resend client at import time — the reason lib/dispatch-budget.ts was
 * split out) and from a Server Component alike.
 */
export async function fetchRecognitionLadder(client: SupabaseClient<Database>): Promise<TierLadderEntry[]>

export function formatTierRange(minCents: number, maxCents: number | null): string  // '$2,500 – $7,499'
```

**There is no `tierForAmount()` in TypeScript.** `formatTierRange` formats numbers it is
handed; it never compares an amount to a threshold. An invariant test asserts this (§Tests).

## UI

### Coach — delivery checklist (new dashboard tab)

The coach sidebar navigates purely by query tab (`components/coach/coach-sidebar.tsx:29-33`),
matched against `TABS` / `TAB_ALIASES` in `components/coach/dashboard-shell.tsx:38-53`. Follow
that idiom rather than inventing a `(coach)` route:

- `components/coach/coach-sidebar.tsx` — add
  `{ label: 'Recognition', href: '/dashboard?tab=recognition', icon: Award, tabs: ['recognition'], badge: false }`
  after `Pitches`.
- `components/coach/dashboard-shell.tsx` — add `{ id: 'recognition', label: 'Recognition' }` to
  `TABS`, a `recognitionAwards` prop, and `{tab === 'recognition' && <RecognitionTab … />}`
  alongside the existing tab renders.
- New `components/coach/recognition-tab.tsx`: one card per award (sponsor company name, tier
  name, amount, awarded date), and inside it one row per benefit with
  `recognitionBenefitLabel`, a status chip, a `recognitionBenefitHint` ("photo of the robot
  with the decal applied"), a status control, and a proof uploader.
- `app/(coach)/dashboard/page.tsx` — add the read to the existing `Promise.all` block
  (`:20-63`), scoped by RLS through the server client:
  `sponsor_recognition_awards` joined to `recognition_benefit_deliveries` and to the sponsor
  company name. **Note the trap already documented at `app/(coach)/dashboard/page.tsx:34-38`:
  a PostgREST embed of `sponsors` resolves against the base table, and `sponsors_select` is
  admin-only since 0063, so `sponsors:sponsor_id(company_name)` silently returns `null` for a
  coach.** Resolve company names from `v_sponsors_public` exactly as `:65-80` already does for
  submissions.

**Proof uploader states, all of them:** idle (with the no-minors checkbox unticked and the
file input disabled until it is ticked) · selected/preview · uploading · success (thumbnail +
"Replace") · rejected-by-validation (wrong type, >5 MB) · upload failed · **voided by admin**
(shows `admin_void_reason` and prompts a re-upload). Empty state when the team has no awards
yet: explain that recognition appears once a sponsorship settles, and link to
`/dashboard?tab=sponsors`.

### Sponsor — owed vs delivered

New `app/(sponsor)/sponsor/recognition/page.tsx`, entry in
`components/sponsor/sponsor-sidebar.tsx:27-30` after `Funding`.

- Header: total outstanding benefit count across all awards.
- One card per award: team name (`teams(team_name)` with the
  `?? 'Team no longer on the platform'` null-guard that
  `app/(sponsor)/sponsor/funding/page.tsx:94` already uses — `team_id` is genuinely nullable),
  tier name, amount, and the benefit list split into **Delivered** and **Outstanding**.
- Delivered rows show the proof thumbnail when one exists and the delivered date.
- Each outstanding row has a "Not needed" action calling `waiveBenefit`.
- Empty state: "Recognition appears here once you fund a team," linking to
  `/sponsor/submissions`.
- Loading is the route group's default (`app/(sponsor)/loading.tsx`); errors surface through
  `app/(sponsor)/error.tsx`.

### Admin — tier editor

New `app/(admin)/recognition/page.tsx`, entry in `components/admin/admin-sidebar.tsx:29-34`
after `Analytics` (`href: '/recognition'` — the admin group's routes are top-level, not
`/admin/*`).

- Ladder table: rank, name, range (`formatTierRange`), benefit chips, live/archived, edit,
  archive.
- Create/edit form posting to `adminUpsertRecognitionTier`. Surface `overlapping_tier` by
  naming the conflicting tier, and `multiple_open_tiers` plainly.
- A prominent, permanent note on the page: *"Editing a tier changes what future sponsorships
  earn. Recognition already promised to a sponsor is frozen and will not change."* That
  sentence is the user-visible contract for the snapshot design; do not omit it.
- A second panel listing deliveries with a proof photo, newest first, with the
  `adminVoidBenefitProof` action — the COPPA review queue.

### The ladder inside the pitch — read this section twice

This is the only part of the slice that touches the admin-gated outreach path.

**`emails/submission-email.tsx`**

- Add one optional prop to the interface at `:22-36`:
  `recognitionTiers?: { name: string; range: string; benefits: string[] }[]`.
- Render a new section between the budget block (which ends at `:158`) and the `<Hr>` at
  `:160`, titled **"What your sponsorship earns"**, listing each tier as name · range ·
  benefits. Reuse the existing `budgetTable` / `budgetRow` / `budgetCell` styles at `:206-208`
  — do not introduce a new visual language in the most important email the product sends.
- Immediately under it, one line of small print: *"Recognition levels are indicative and are
  confirmed when a sponsorship is finalised."* The binding record is the snapshot created at
  settle, not this email.
- When the prop is absent or empty the section renders **nothing**. A team pitching before an
  admin has configured tiers must not get a broken email.

**`lib/dispatch.ts`**

- Fetch the ladder inside `dispatchApprovedSubmission`, with the admin client it already
  builds at `:42`, and pass it into the `SubmissionEmail({...})` props at `:90-109`.
- Use `fetchRecognitionLadder` from `lib/recognition.ts` (which constructs no client at module
  scope — that is why it takes the client as an argument).
- A ladder fetch failure must **not** fail the dispatch. Catch it, log it, send the email
  without the section. Losing the pitch because a config read hiccuped is a far worse outcome
  than an email missing one block.
- **Do not touch anything else in this function.** Not the idempotency key at `:119-121`
  (changing its inputs breaks the redispatch semantics documented at `:115-118`), not the
  `replyTo` resolution at `:82-83`, not the `resend_message_id` write at `:124-129`.

**`app/sponsor-view/[token]/page.tsx`**

- Add a read-only "What your sponsorship earns" card after the Budget Breakdown card
  (`:239-259`), styled like the surrounding `bg-card rounded-xl border p-8 shadow-sm` cards.
- Data comes from the same `fetchRecognitionLadder`, using the admin client the page already
  creates at `:23`.
- Render it whether or not the decision panel is live — an expired or already-decided link
  should still explain what was on offer.

**The three things this must not do, stated explicitly because the Core Mandate is at stake:**

1. **No new send site.** `dispatchApprovedSubmission` (`lib/dispatch.ts:36`) stays the only
   code path that emails a pitch to a sponsor. Do not add a `sendRecognitionEmail`, do not
   call `resend.emails.send` from an action, do not add a sender to `lib/notify.ts` that
   targets `sponsors.contact_email` with pitch content.
2. **No new way to reach the pitch.** `/sponsor-view/[token]` is reachable only with a token
   whose sha256 matches a `submission_access_tokens` row (`:25-33`), and those rows are minted
   exclusively by `approve_submission_atomic` at admin approval. Adding a card to that page
   adds no reachability. Do not add a `?tier=` param, a preview route, or an unauthenticated
   recognition page. **No `middleware.ts` change is required or permitted by this slice** —
   `/sponsor-view(.*)` is already public at `middleware.ts:12`.
3. **No writes from the token page.** The new card is render-only. The token page's single
   mutation remains the decision panel at `:308-314`.

### Dev previews

`_CONTEXT` §9: all three preview modes are forced off in production and must still render.
Extend `lib/dev-coach-preview.ts` (one award, three benefits, one with proof, one voided),
`lib/dev-preview.ts` (one award seen from the sponsor side, one outstanding + one delivered),
and `lib/dev-bypass.ts` (the four seeded tiers) so
`npm run dev:coach-preview` / `dev:sponsor-preview` / `dev:admin-preview` still work.

## Out of scope

- Anything that changes when or whether money moves. `funding_fulfillments`,
  `record_fulfillment_transition`, `transactions_ledger`, `sponsors.funding_used_cents`,
  `approve_submission_atomic`, `release_submission_reservation` — untouched. Recognition
  reads the money model; it never writes it.
- Rewriting either settle RPC. The trigger exists specifically so you do not have to.
- The CSR impact report and any snapshotting of delivered benefits for reporting — prompt 15.
  This slice stores the facts; 15 reports on them.
- Receipts and acknowledgment letters — prompt 04.
- Agreements and e-signature — prompts 05/06.
- Making `pitch-media` private, adding a DELETE or UPDATE policy to it, or signed URLs.
  `0066:175-179` deliberately left the media buckets public and flagged the signed-URL work as
  a follow-up; that is still true.
- Adding a `notifications.type` CHECK value.
- Automated image moderation / face detection. §COPPA says plainly what the control actually is.
- Per-team custom benefits, negotiated one-off perks, or benefits attached to anything other
  than a tier.

## Guardrails specific to this slice

1. **Never `auth.uid()`.** NULL under Clerk. Use `current_profile_id()`, `is_admin()`,
   `is_coach_verified()`, `is_trusted_server_context()`.
2. **Threshold math exists in exactly one function.** `recognition_tier_for_amount`. Not in a
   second SQL function, not in `lib/recognition.ts`, not in a component, not in a Zod
   `.refine()`. `grep -rn "min_amount_cents" app components lib` must return only labelling
   and formatting uses.
3. **The snapshot is authoritative.** Nothing in the app may resolve a promised benefit by
   following `sponsor_recognition_awards.tier_id` back to `recognition_tiers.benefits`. Read
   `benefits_snapshot` and the delivery rows.
4. **REVOKE EXECUTE … FROM PUBLIC, anon, authenticated; GRANT … TO service_role** on
   `recognition_tier_for_amount`, `recognition_tier_ladder`, `trg_create_recognition_award`,
   `create_recognition_award_for_fulfillment`, `record_benefit_delivery`, `void_benefit_proof`,
   `admin_upsert_recognition_tier`, `admin_archive_recognition_tier`. **Do NOT revoke on
   `can_read_recognition_award`** — it runs inside an RLS policy as the calling role and
   revoking makes every read 42501 (0062's comment; prompt 01 repeats it).
5. **The deliveries policy must go through `can_read_recognition_award()`.** An inline sublink
   risks 42P17 (0066).
6. **Storage path: the Clerk user id is the first segment, always.** `0051:321-329` compares
   `(auth.jwt() ->> 'sub')` to `(storage.foldername(name))[1]`. `requireVerifiedCoach()`
   returns `clerkUserId` — use it, never `user.id` (the profile uuid) and never a
   client-supplied string.
7. **`upsert: false` on every `pitch-media` upload.** The bucket has no UPDATE policy.
8. **No proof URL in `audit_log.metadata`, in a notification body, or in an email.** Log
   `has_proof: true`. The URL is public and permanent; the audit log is forever.
9. **COPPA is absolute.** No proof photo of a person's face, no student names in
   `coach_note`, no benefit type that implies photographing students. The affirmation
   checkbox, the DB-level `proof_requires_no_minors_affirmation` CHECK, the admin review
   panel and `void_benefit_proof` are the control set. Be honest in the UI copy about what is
   and is not allowed; do not claim automated detection.
10. **`$$`-quoted blocks ⇒ apply with `psql -f`,** never the Supabase CLI splitter
    (_CONTEXT §8.2). Run it twice to prove idempotency.
11. **Do not add a column to `submissions`.** `guard_submission_writable_columns()` fails
    closed against an allowlist (0064). The relationship reaches submissions through
    `funding_fulfillments.submission_id` already.
12. **Sponsors must never see another sponsor's award; coaches must never see another team's.**
    Prove it with tests, not by reading the policy.

## Files you will touch

**Create:**
- `supabase/migrations/0087_recognition_tiers.sql`
- `lib/recognition.ts`
- `lib/schemas/recognition.ts`
- `app/actions/recognition.ts`
- `components/coach/recognition-tab.tsx`
- `components/coach/benefit-proof-uploader.tsx`
- `app/(sponsor)/sponsor/recognition/page.tsx`
- `app/(admin)/recognition/page.tsx`
- `components/admin/recognition-tier-form.tsx`
- `lib/__tests__/recognition.test.ts`
- `tests/e2e/recognition-tiers.spec.ts`

**Modify:**
- `lib/schemas/limits.ts` (four new keys)
- `emails/submission-email.tsx` (one optional prop + one section)
- `lib/dispatch.ts` (fetch the ladder, pass the prop — nothing else)
- `app/sponsor-view/[token]/page.tsx` (one read-only card)
- `app/(coach)/dashboard/page.tsx` (one read added to the existing `Promise.all`)
- `components/coach/dashboard-shell.tsx` (`TABS` + one prop + one tab render)
- `components/coach/coach-sidebar.tsx` (one nav item)
- `components/sponsor/sponsor-sidebar.tsx` (one nav item)
- `components/admin/admin-sidebar.tsx` (one nav item)
- `lib/dev-coach-preview.ts`, `lib/dev-preview.ts`, `lib/dev-bypass.ts` (fixtures)
- `lib/supabase/types.ts` (regenerate or hand-add three tables + two enums; the repo keeps
  this file checked in — match whichever style is already there)

## Tests

**Unit — `lib/__tests__/recognition.test.ts` (Vitest):**
- `RECOGNITION_BENEFIT_TYPES` matches the SQL enum exactly, in order, with all six values.
- `OPEN_DELIVERY_STATUSES` ∪ `CLOSED_DELIVERY_STATUSES` = `RECOGNITION_DELIVERY_STATUSES`,
  and the two sets are disjoint.
- `recognitionBenefitLabel` and `recognitionBenefitHint` return a non-empty string for every
  member of `RECOGNITION_BENEFIT_TYPES` (a missing case must fail the build, not render a raw
  enum value — that is exactly the bug `lib/submission-status.ts` documents for
  `delivered`/`opened`).
- `formatTierRange(250000, 750000)` and `formatTierRange(750000, null)` render as expected.

**Unit — invariant assertions (extend `lib/__tests__/remediation-invariants.test.ts` or add a
sibling), in the file-reading regex style that file already uses:**
- **No threshold math in TypeScript.** Read `lib/recognition.ts`, `app/actions/recognition.ts`,
  `components/coach/recognition-tab.tsx` and assert none contains a comparison operator
  applied to `min_amount_cents` / `max_amount_cents` / `minAmountCents` / `maxAmountCents`.
- **No proof URL in audit or notification payloads.** Read `app/actions/recognition.ts` and
  assert `proof_url` / `proofUrl` never appears inside an `audit_log` insert object or a
  `createInAppNotification` call.
- **No new Resend call site.** Assert `app/actions/recognition.ts` imports neither `resend`
  nor `Resend`, and that `grep -c "resend.emails.send" lib/dispatch.ts` is still 1.

**E2E — `tests/e2e/recognition-tiers.spec.ts` (Playwright). The security and pinning
boundaries are mandatory, not optional:**
- Settling a sponsorship above the entry threshold creates exactly one
  `sponsor_recognition_awards` row and exactly one `recognition_benefit_deliveries` row per
  benefit in the tier — in the same transaction as the ledger row.
- Settling **below** the entry threshold creates **zero** award rows.
- **The pinning test, the headline of this slice:** award a Silver-tier sponsorship; then, as
  admin, change Silver's `min_amount_cents`, its `benefits` array, and its `name`; re-read the
  award. `tier_name_snapshot`, `benefits_snapshot` and the delivery rows are **byte-for-byte
  unchanged**, and no new delivery row appeared.
- Archiving a tier does not delete or alter any award pinned against it.
- **Sponsor B calls `waiveBenefit` on Sponsor A's delivery → error, row unchanged.**
- **Coach of Team X calls `markBenefitDelivered` on Team Y's delivery → error.**
- **A sponsor calling `markBenefitDelivered` and a coach calling `waiveBenefit` are both
  rejected** (`role_not_permitted`), even on rows they own.
- `uploadBenefitProof` without the no-minors affirmation uploads **nothing** — assert the
  storage object does not exist, not merely that the action returned an error.
- A proof upload whose path does not start with the caller's Clerk id is rejected by storage
  RLS (drive the storage client directly, not through the action).
- `adminVoidBenefitProof` clears `proof_url`, stamps the reason, and the coach's checklist
  renders the voided state.
- **RLS proof, direct against PostgREST, not through the app:**
  `GET /rest/v1/sponsor_recognition_awards?select=*` as sponsor B returns `[]` for A's rows;
  as anon returns `[]`. Same for `recognition_benefit_deliveries`. `PATCH` and `DELETE` on
  both tables as any authenticated role affect 0 rows.
  `GET /rest/v1/recognition_tiers?select=*` as anon returns the live tiers and **no archived
  tier** (this one is intentionally readable — assert the archived exclusion, not the denial).
- The pitch email rendered for a team, and the `/sponsor-view/[token]` page, both contain the
  tier names; with every tier archived, both render without the section and without error.

## Acceptance criteria

- [ ] A sponsorship settling at an amount inside a live tier produces exactly one
      `sponsor_recognition_awards` row and one `recognition_benefit_deliveries` row per
      benefit, created in the same transaction as the `funding_fulfillments` row.
- [ ] A sponsorship settling below the lowest tier produces no award row and no error.
- [ ] An admin editing a tier's thresholds, benefits or name through
      `/recognition` changes **nothing** about any existing award or delivery row —
      demonstrated by a before/after diff of the rows, not by reading the code.
- [ ] An admin can add a new tier and change a threshold with no code change and no deploy.
- [ ] `admin_upsert_recognition_tier` rejects an overlapping range and names the conflicting
      tier.
- [ ] A coach can mark a benefit in progress, then delivered, and attach a photo; the sponsor
      sees it move from Outstanding to Delivered.
- [ ] A coach cannot upload a proof without ticking the no-minors affirmation, and no storage
      object is created when they try.
- [ ] `SELECT count(*) FROM recognition_benefit_deliveries WHERE proof_url IS NOT NULL AND
      no_minors_confirmed_at IS NULL` returns 0, and the CHECK constraint makes it impossible
      to make it non-zero.
- [ ] An admin can void a proof; it disappears from both the sponsor and coach views and the
      reason is shown to the coach.
- [ ] A sponsor can waive a benefit; a sponsor cannot mark one delivered.
- [ ] Sponsor B reading `sponsor_recognition_awards` over the REST API sees none of Sponsor
      A's rows. Anon sees `[]` on both awards and deliveries.
- [ ] No authenticated role can UPDATE or DELETE any of the three new tables.
- [ ] The dispatched pitch email contains the tier ladder, and it is sent by
      `dispatchApprovedSubmission` and nothing else —
      `grep -rn "resend.emails.send" app lib` shows no new call site.
- [ ] `/sponsor-view/[token]` shows the ladder; `middleware.ts` is unchanged.
- [ ] With all tiers archived, dispatch still succeeds and the email renders without the
      recognition section.
- [ ] `grep -rn "min_amount_cents\|max_amount_cents" app components lib` shows no comparison
      operator — only display and formatting.
- [ ] `grep -rn "proof_url" app/actions/recognition.ts` shows it only in the RPC argument list
      and the storage-upload return — never inside an audit or notification payload.
- [ ] All three dev preview modes still render the new surfaces.
- [ ] The migration applies cleanly twice in a row with `psql -f`.
- [ ] `npm run typecheck && npm run lint && npm run build && npm run test` all pass.

## Rollback

```sql
BEGIN;

-- 1. Detach from the money spine first. funding_fulfillments itself is NOT modified by 0087
--    (the trigger is the only attachment), so prompt 01 needs no reverting.
DROP TRIGGER IF EXISTS create_recognition_award ON funding_fulfillments;

-- 2. Drop this migration's objects. Children before parents.
DROP TABLE IF EXISTS recognition_benefit_deliveries;
DROP TABLE IF EXISTS sponsor_recognition_awards;
DROP TABLE IF EXISTS recognition_tiers;

DROP FUNCTION IF EXISTS trg_create_recognition_award();
DROP FUNCTION IF EXISTS create_recognition_award_for_fulfillment(uuid);
DROP FUNCTION IF EXISTS record_benefit_delivery(uuid, uuid, recognition_delivery_status, text, boolean, text);
DROP FUNCTION IF EXISTS void_benefit_proof(uuid, uuid, text);
DROP FUNCTION IF EXISTS admin_upsert_recognition_tier(uuid, uuid, text, int, bigint, bigint, recognition_benefit_type[], text);
DROP FUNCTION IF EXISTS admin_archive_recognition_tier(uuid, uuid);
DROP FUNCTION IF EXISTS recognition_tier_ladder();
DROP FUNCTION IF EXISTS recognition_tier_for_amount(bigint);
DROP FUNCTION IF EXISTS can_read_recognition_award(uuid);

DROP TYPE IF EXISTS recognition_delivery_status;
DROP TYPE IF EXISTS recognition_benefit_type;

COMMIT;
```

Storage objects under `pitch-media/<clerk_id>/recognition/` are **not** removed by this
rollback — the bucket has no DELETE policy and the objects are harmless orphans in a public
media bucket. Note them for manual cleanup if the rollback is permanent.

Revert the code with `git revert` of this prompt's commit. Order matters in one direction
only: the DROP above must run **after** the deploy that removes `app/actions/recognition.ts`
and the `lib/dispatch.ts` ladder fetch, or a live dispatch will 500 on a missing function. The
ladder fetch is wrapped in a catch, so in practice it degrades rather than failing — but do
not rely on that; deploy the code revert first.

## Commit

```
feat(recognition): sponsor recognition tiers with pinned benefit fulfillment

Sponsors were asked to fund a budget with no stated return: neither the
pitch email nor the token viewer named a single deliverable. Adds an
admin-editable recognition_tiers ladder (thresholds in cents, editable
with no deploy), a sponsor_recognition_awards row pinned at settle time
by an AFTER INSERT trigger on funding_fulfillments, and one
recognition_benefit_deliveries row per promised benefit so editing a tier
can never rewrite a promise already made. Coaches get a delivery
checklist with optional photo proof (pitch-media, folder-partitioned by
Clerk id, gated behind a no-minors affirmation enforced by a CHECK);
sponsors get owed-vs-delivered; admins get the tier editor and a proof
review queue with a void action. The ladder is surfaced in the pitch
itself through dispatchApprovedSubmission and the existing token viewer
only — no new outreach path.
```
