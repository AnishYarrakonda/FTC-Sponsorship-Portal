# Prompt 01 — Funding fulfillment state machine

> **Prerequisites:** None
> **Reserved migration:** `0076_funding_fulfillments.sql` — verify it is still free with `ls supabase/migrations | tail -3`
> **Scope:** large · ~12 files
> **Leaves the repo:** green and shippable on its own

## Why this exists

A sponsor's finance team asks: "We approved $8,500 for Team 31579 in April. Did the check
clear? Who confirmed receipt? Show me everything still outstanding." The platform cannot
answer any of it. `transactions_ledger` records that a sponsor *agreed* to fund — nothing
more — and the money handoff after that is an unmonitored email thread
(`emails/handshake-email.tsx` tells both sides to "reply to this email"). Worse,
`app/(sponsor)/sponsor/funding/page.tsx:68` labels those commitment rows **"Confirmed
disbursements"** and `:100` stamps each one **"Confirmed"**, which is false. This slice
builds the state machine that makes the answer real, and stops the page lying in the
meantime.

## Current state (verified)

**What exists**

- `supabase/migrations/0017_transactions_ledger.sql` creates `transactions_ledger`
  (`id`, `sponsor_id`, `team_id`, `submission_id`, `amount_cents` CHECK > 0,
  `decision_type` IN (`full`,`partial`), `actor_type` IN (`sponsor`,`admin`), `created_at`).
  It is **append-only** — only SELECT policies exist, so UPDATE/DELETE are denied for
  every non-service role. Its header calls it "ground truth" for *acceptance*, not payment.
- `supabase/migrations/0061_ledger_survives_account_deletion.sql:13-22` dropped NOT NULL on
  `team_id` and `submission_id` and re-pointed both FKs to `ON DELETE SET NULL`.
  `sponsor_id` remains NOT NULL / `ON DELETE RESTRICT`.
- `supabase/migrations/0069_ledger_sponsor_and_coach_read.sql` adds `ledger_select_sponsor`
  (own `sponsor_id` via `current_profile_id()`) and `ledger_select_coach` (own team). Its
  trailing note warns that these sublinks are only safe because 0066 keeps every `teams`
  policy sublink-free.
- **Two settle paths, both writing exactly one ledger row:**
  - `sponsor_decide_submission_atomic` (portal) — current definition is
    `supabase/migrations/0065_fix_sponsor_decide_double_debit.sql:69-203`. Ledger INSERT at
    `:192-193`, audit INSERT at `:195-199`. Called from
    `app/actions/sponsor-decision.ts:60-66` via the admin client.
  - `record_sponsor_decision_atomic` (emailed token link) — current definition is
    `supabase/migrations/0071_token_decision_check_status_first.sql:34-132`. Ledger INSERT
    at `:122-123`, audit INSERT at `:125-128`. Called from
    `app/actions/sponsor-decision.ts:137-141`.
- `app/(sponsor)/sponsor/funding/page.tsx` reads `transactions_ledger` with the RLS-respecting
  server client and renders the two mislabels named above.
- Actor-hardening precedent to copy: `0065:92-99` resolves the actor context-aware
  (Clerk `sub` present → assert `current_profile_id()`; otherwise trust `p_*_id`).
  **That `ELSE` branch is the pre-0072 shape and must NOT be copied verbatim** — see
  Guardrails.

**What is missing**

There is no fulfillment table, no payment status, no `payment_method`, no
`payment_reference`, no expectation date, no aging data, no transition audit trail, and no
action anywhere in `app/actions/*` that a sponsor or coach can call to say money moved.
`grep -rn "fulfil" app lib supabase` returns nothing.

## What you are building

1. Migration `0076_funding_fulfillments.sql`:
   - two enums (`fulfillment_status`, `fulfillment_payment_method`),
   - table `funding_fulfillments` (one row per settled ledger commitment),
   - table `funding_fulfillment_events` (append-only transition trail),
   - helper `can_read_fulfillment(uuid)`,
   - RPC `record_fulfillment_transition(...)`,
   - the settle-path hook in **both** RPCs,
   - a backfill for existing ledger rows,
   - RLS + per-role policies + REVOKE/GRANT on every SECURITY DEFINER function.
2. `lib/schemas/fulfillment.ts` + two new keys in `lib/schemas/limits.ts`.
3. `app/actions/fulfillment.ts` with three server actions
   (`markPaymentSent`, `confirmPaymentReceived`, `adminOverrideFulfillmentStatus`).
4. `lib/fulfillment-status.ts` — the canonical TS mirror of the transition table, imported
   by the actions and (in prompt 03) by the UI. Do not re-declare status arrays elsewhere.
5. The honest-copy fix on `app/(sponsor)/sponsor/funding/page.tsx` (label only — prompt 03
   replaces the page).
6. Tests.

## Data model

### Enums

```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fulfillment_status') THEN
    CREATE TYPE fulfillment_status AS ENUM (
      'pledged', 'agreement_signed', 'payment_sent', 'payment_received',
      'receipted', 'cancelled'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fulfillment_payment_method') THEN
    CREATE TYPE fulfillment_payment_method AS ENUM ('check', 'ach', 'wire', 'other');
  END IF;
END $$;
```

All values are declared at type creation so a from-scratch replay works (_CONTEXT §8.1).

### `funding_fulfillments`

```sql
CREATE TABLE IF NOT EXISTS funding_fulfillments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- One fulfillment per settled commitment. RESTRICT, not CASCADE: the ledger is
  -- append-only and never deleted, so this can only fail if someone tries to break that.
  transaction_id      uuid NOT NULL UNIQUE REFERENCES transactions_ledger(id) ON DELETE RESTRICT,
  -- Mirror the ledger's own nullability exactly (0061). sponsor_id NOT NULL/RESTRICT;
  -- team_id and submission_id nullable ON DELETE SET NULL so Clerk account deletion,
  -- which runs no app code, cannot be blocked by this table.
  sponsor_id          uuid NOT NULL REFERENCES sponsors(id)    ON DELETE RESTRICT,
  team_id             uuid          REFERENCES teams(id)       ON DELETE SET NULL,
  submission_id       uuid          REFERENCES submissions(id) ON DELETE SET NULL,
  amount_cents        bigint NOT NULL CHECK (amount_cents > 0),
  status              fulfillment_status NOT NULL DEFAULT 'pledged',
  payment_method      fulfillment_payment_method,
  -- SENSITIVE: check number / ACH trace / wire ref. Never log it, never put it in
  -- audit_log.metadata, event metadata, a notification body, or an email.
  payment_reference   text CHECK (payment_reference IS NULL OR char_length(payment_reference) <= 64),
  expected_by         date,
  notes               text CHECK (notes IS NULL OR char_length(notes) <= 1000),
  -- Per-transition timestamps. pledged_at is always set; the rest fill in as it moves.
  pledged_at          timestamptz NOT NULL DEFAULT now(),
  agreement_signed_at timestamptz,
  payment_sent_at     timestamptz,
  payment_received_at timestamptz,
  receipted_at        timestamptz,
  cancelled_at        timestamptz,
  cancelled_reason    text,
  -- Written ONLY by the nudge cron added in prompt 03. Present now so prompt 03 needs
  -- no migration of its own.
  last_nudged_at      timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fulfillments_sponsor    ON funding_fulfillments(sponsor_id);
CREATE INDEX IF NOT EXISTS idx_fulfillments_team       ON funding_fulfillments(team_id);
CREATE INDEX IF NOT EXISTS idx_fulfillments_submission ON funding_fulfillments(submission_id);
-- Aging report (prompt 03) reads exactly this predicate.
CREATE INDEX IF NOT EXISTS idx_fulfillments_open
  ON funding_fulfillments(status, pledged_at)
  WHERE status IN ('pledged', 'agreement_signed', 'payment_sent');
```

Attach the existing `updated_at` trigger if the project has one
(`grep -rn "set_updated_at\|handle_updated_at" supabase/migrations | head`); if there is no
shared helper, set `updated_at = now()` inside the RPC and do not invent a trigger.

### `funding_fulfillment_events`

**Decision: a dedicated events table, not `audit_log`.** Three reasons, all concrete:
`audit_log` has no sponsor or coach SELECT policy, so neither counterparty could ever see
the history of their own fulfillment — and prompt 03's tracker is a per-party timeline;
`audit_log.metadata` is untyped jsonb, so "everything sitting in `payment_sent` for 30+
days" becomes a jsonb dig instead of an index scan; and `audit_log.entity_id` is a bare
uuid with no from/to columns. The RPC still writes an `audit_log` row as well — that stays
the admin forensic record, per `.claude/rules/conventions.md`.

```sql
CREATE TABLE IF NOT EXISTS funding_fulfillment_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fulfillment_id  uuid NOT NULL REFERENCES funding_fulfillments(id) ON DELETE CASCADE,
  from_status     fulfillment_status,          -- NULL on the creation row
  to_status       fulfillment_status NOT NULL,
  actor_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  actor_role      text NOT NULL CHECK (actor_role IN ('sponsor', 'coach', 'admin', 'system')),
  note            text CHECK (note IS NULL OR char_length(note) <= 1000),
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
  -- No updated_at: append-only.
);

CREATE INDEX IF NOT EXISTS idx_fulfillment_events_parent
  ON funding_fulfillment_events(fulfillment_id, created_at DESC);
```

### RLS policies

`ALTER TABLE … ENABLE ROW LEVEL SECURITY` on both tables.

**`funding_fulfillments`**

- `fulfillments_select_admin` · SELECT · `USING (is_admin())`
- `fulfillments_select_sponsor` · SELECT · `USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = current_profile_id() AND p.role = 'sponsor' AND p.sponsor_id IS NOT NULL AND p.sponsor_id = funding_fulfillments.sponsor_id))` — byte-for-byte the shape of `ledger_select_sponsor` in 0069.
- `fulfillments_select_coach` · SELECT · `USING (funding_fulfillments.team_id IS NOT NULL AND EXISTS (SELECT 1 FROM teams t WHERE t.id = funding_fulfillments.team_id AND t.owner_id = current_profile_id()))` — same shape as `ledger_select_coach`.
- **No INSERT / UPDATE / DELETE policies at all.** Every write is service-role, via the RPC
  or the settle hook. This is deliberate and mirrors `transactions_ledger` and `audit_log`.

**`funding_fulfillment_events`**

- `fulfillment_events_select` · SELECT · `USING (can_read_fulfillment(fulfillment_id))`
- No INSERT / UPDATE / DELETE policies.

### `can_read_fulfillment(uuid)`

A sublink from the events policy back into `funding_fulfillments` would make the planner
evaluate that table's own policies (which themselves sublink into `profiles` and `teams`).
The project has already been bitten by exactly this class of nesting — 0066 wraps the
sponsor predicate in `sponsor_can_view_team()` specifically to avoid 42P17. Follow that
precedent:

```sql
CREATE OR REPLACE FUNCTION can_read_fulfillment(p_fulfillment_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM funding_fulfillments f
     WHERE f.id = p_fulfillment_id
       AND (
         is_admin()
         OR EXISTS (SELECT 1 FROM profiles p
                     WHERE p.id = current_profile_id() AND p.role = 'sponsor'
                       AND p.sponsor_id IS NOT NULL AND p.sponsor_id = f.sponsor_id)
         OR (f.team_id IS NOT NULL AND EXISTS (
               SELECT 1 FROM teams t WHERE t.id = f.team_id AND t.owner_id = current_profile_id()))
       )
  );
$$;
```

**Do NOT revoke EXECUTE on this one.** Like `is_admin()` / `current_profile_id()` /
`sponsor_can_view_team()`, it is called from inside an RLS policy that evaluates as the
calling role; revoking from `authenticated` makes every read raise 42501. 0062's own
comment warns about this. Revoke/grant applies to `record_fulfillment_transition` below.

### Transition table (authoritative)

| From | To | Who may drive it |
|---|---|---|
| `pledged` | `agreement_signed` | admin, system (prompt 06 wires the real signer) |
| `pledged` | `payment_sent` | sponsor, admin |
| `pledged` | `cancelled` | sponsor, admin |
| `agreement_signed` | `payment_sent` | sponsor, admin |
| `agreement_signed` | `cancelled` | sponsor, admin |
| `payment_sent` | `payment_received` | coach, admin |
| `payment_sent` | `pledged` | admin only (correction) |
| `payment_sent` | `cancelled` | admin only |
| `payment_received` | `receipted` | admin, system |
| `payment_received` | `payment_sent` | admin only (correction) |
| `receipted` | — | terminal for everyone |
| `cancelled` | — | terminal for everyone |

Notes that must appear as SQL comments in the migration:

- A **sponsor can never mark `payment_received`** — self-dealing. A **coach can never mark
  `payment_sent`** and can never cancel.
- **`agreement_signed` is a real gate that prompt 06 will wire up.** For now the transition
  exists, nothing calls it, and nothing blocks on it: `pledged → payment_sent` stays legal.
  Prompt 06 flips that. Do not add the block now.
- `receipted` is issued by prompt 04's `issue_funding_receipt`, which PERFORMs this RPC.
  Until 04 lands, nothing reaches `receipted`.

### `record_fulfillment_transition`

```sql
record_fulfillment_transition(
  p_fulfillment_id    uuid,
  p_actor_profile_id  uuid,
  p_to_status         fulfillment_status,
  p_payment_method    fulfillment_payment_method DEFAULT NULL,
  p_payment_reference text  DEFAULT NULL,
  p_occurred_on       date  DEFAULT NULL,
  p_note              text  DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
```

Body requirements, in order:

1. **Actor resolution** — context-aware, but closed against anon:
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
   0065's equivalent block has a bare `ELSE` that trusts the caller; 0072 proved that
   branch also admits the anon key. Use the three-branch form above.
2. `SELECT * INTO v_f FROM funding_fulfillments WHERE id = p_fulfillment_id FOR UPDATE;`
   not found → `fulfillment_not_found`.
3. Derive `v_actor_role`: `is_admin()`-equivalent lookup on the resolved profile →
   `'admin'`; else sponsor whose `profiles.sponsor_id = v_f.sponsor_id` → `'sponsor'`;
   else owner of `v_f.team_id` → `'coach'`; else → `unauthorized`. When the caller is
   trusted-server AND `p_actor_profile_id IS NULL`, role is `'system'`.
4. `IF v_f.status = p_to_status THEN RETURN … 'already_in_status'` (idempotent no-op is a
   soft error, not a crash — prompt 03 treats it as success).
5. Validate `(v_f.status, p_to_status, v_actor_role)` against the table above →
   `illegal_transition` (include `from_status` and `to_status` in the JSON so the action
   can log it).
6. Reject terminal sources: from `receipted` → `receipt_issued`; from `cancelled` →
   `already_cancelled`.
7. For `p_to_status = 'payment_sent'`: `p_payment_method` is required →
   `payment_details_required`. `p_payment_reference` stays optional.
8. `v_occurred := COALESCE(p_occurred_on::timestamptz, now());`
   reject `p_occurred_on > current_date` → `future_date`.
9. UPDATE the row: set `status`, the matching `*_at` column from `v_occurred`,
   `payment_method`/`payment_reference` when supplied, `cancelled_reason` from `p_note` on
   a cancel, `updated_at = now()`.
10. INSERT the event row (`from_status`, `to_status`, `v_actor`, `v_actor_role`, `p_note`,
    `metadata = jsonb_build_object('payment_method', p_payment_method, 'occurred_on', p_occurred_on)`).
    **`payment_reference` must NOT go into `metadata`.**
11. INSERT into `audit_log`: `action = 'fulfillment_transition'`, `entity_type =
    'funding_fulfillments'`, `entity_id = p_fulfillment_id`, `metadata =
    {from, to, actor_role, amount_cents, sponsor_id}` — again **no `payment_reference`**.
12. `RETURN jsonb_build_object('ok', true, 'status', p_to_status, 'from_status', v_f.status);`

Then, mandatory:

```sql
REVOKE EXECUTE ON FUNCTION record_fulfillment_transition(uuid, uuid, fulfillment_status,
  fulfillment_payment_method, text, date, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION record_fulfillment_transition(...) FROM anon;
REVOKE EXECUTE ON FUNCTION record_fulfillment_transition(...) FROM authenticated;
GRANT  EXECUTE ON FUNCTION record_fulfillment_transition(...) TO service_role;
```

### Settle-path hook (both RPCs)

Fulfillment rows are created **inside the settle transaction**, never by application code —
otherwise a crash between the ledger write and the fulfillment write produces a commitment
nobody tracks.

Add, immediately after the existing `INSERT INTO transactions_ledger … ` in each function
and before its `INSERT INTO audit_log`:

```plpgsql
  INSERT INTO transactions_ledger (...)
  VALUES (...)
  RETURNING id INTO v_txn_id;                       -- add RETURNING to the existing INSERT

  INSERT INTO funding_fulfillments
    (transaction_id, sponsor_id, team_id, submission_id, amount_cents, status)
  VALUES (v_txn_id, <sponsor_id>, <team_id>, <submission_id>, v_amount, 'pledged')
  RETURNING id INTO v_fulfillment_id;

  INSERT INTO funding_fulfillment_events
    (fulfillment_id, from_status, to_status, actor_profile_id, actor_role, metadata)
  VALUES (v_fulfillment_id, NULL, 'pledged', <actor or NULL>, 'system',
          jsonb_build_object('source', 'portal_settle'));   -- 'token_settle' in the other
```

- `sponsor_decide_submission_atomic` — reproduce the **entire** body from
  `0065:69-203` verbatim, changing only: `v_txn_id`/`v_fulfillment_id` declarations, the
  `RETURNING` on the ledger INSERT, and the two new INSERTs. Actor is `v_actor_id`,
  `actor_role` `'system'`.
- `record_sponsor_decision_atomic` — reproduce the **entire** body from
  `0071:34-132` verbatim with the same three changes. That path has no resolved actor
  (`0071:126` writes `actor_id = NULL` to `audit_log`), so pass `NULL` /
  `actor_role = 'system'`.
- Re-emit 0071's four REVOKE/GRANT lines for `record_sponsor_decision_atomic` and the
  equivalent for `sponsor_decide_submission_atomic` — a `CREATE OR REPLACE` keeps existing
  grants, but this file may be applied standalone.
- **Pre-apply check, in the migration header** (mirror `0065:38-49`): run
  `SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname='public' AND p.proname IN ('sponsor_decide_submission_atomic','record_sponsor_decision_atomic');`
  If either body differs from 0065/0071 by anything other than whitespace, **STOP and
  report the diff** — a hand-edit made in the Supabase SQL editor would be silently
  overwritten.

### Backfill

```sql
INSERT INTO funding_fulfillments
  (transaction_id, sponsor_id, team_id, submission_id, amount_cents, status, pledged_at, created_at)
SELECT tl.id, tl.sponsor_id, tl.team_id, tl.submission_id, tl.amount_cents, 'pledged',
       tl.created_at, tl.created_at
  FROM transactions_ledger tl
 WHERE NOT EXISTS (SELECT 1 FROM funding_fulfillments f WHERE f.transaction_id = tl.id);

INSERT INTO funding_fulfillment_events
  (fulfillment_id, from_status, to_status, actor_role, metadata, created_at)
SELECT f.id, NULL, 'pledged', 'system', jsonb_build_object('source', 'backfill'), f.pledged_at
  FROM funding_fulfillments f
 WHERE NOT EXISTS (SELECT 1 FROM funding_fulfillment_events e WHERE e.fulfillment_id = f.id);
```

Idempotent via `NOT EXISTS` plus the UNIQUE on `transaction_id`. Pre-launch the ledger is
expected to be empty; the backfill must still be present and correct.

## Server actions

New file `app/actions/fulfillment.ts`, canonical 5-step shape
(`.claude/rules/conventions.md`). All three catch guard throws and return `{ error: e.message }`.
Map RPC error codes through a local `mapFulfillmentError()` in the style of
`mapDecisionError` in `app/actions/sponsor-decision.ts:25-38`.

```ts
markPaymentSent(input: {
  fulfillmentId: string
  paymentMethod: 'check' | 'ach' | 'wire' | 'other'
  paymentReference?: string
  sentOn?: string          // ISO date, defaults to today
  note?: string
}): Promise<{ success?: true; error?: string }>
```
- Guard: `requireSponsor()` (gives `user`, `sponsorId`, `adminClient`).
- Schema: `markPaymentSentSchema` in `lib/schemas/fulfillment.ts`.
- Pre-check with `adminClient`: the fulfillment's `sponsor_id` must equal `sponsorId`, else
  return `'Fulfillment not found.'` (never leak that it exists). The RPC re-checks; this is
  the friendly path.
- Calls `record_fulfillment_transition` with `p_to_status = 'payment_sent'`.
- `audit_log` action string: written by the RPC as `fulfillment_transition`. The action
  additionally writes `'mark_payment_sent'` with `{ fulfillment_id, payment_method }` —
  **never the reference**.
- Notifies the **coach** (`teams.owner_id` for the fulfillment's `team_id`) via
  `createInAppNotification({ type: 'general', title: '<Sponsor> marked your sponsorship payment as sent', body: '…' })`.
  Body may name the method ("by check") but **must not contain `payment_reference`**.
- `revalidatePath('/sponsor/funding')`, `revalidatePath('/dashboard')`.

```ts
confirmPaymentReceived(input: {
  fulfillmentId: string
  receivedOn?: string
  note?: string
}): Promise<{ success?: true; error?: string }>
```
- Guard: `requireVerifiedCoach()` — surface `e.code === 'NEEDS_VERIFICATION'` in the return
  so the UI can show the verification CTA.
- Pre-check: the fulfillment's `team_id` must belong to a team the caller owns.
- `p_to_status = 'payment_received'`.
- Audit `'confirm_payment_received'`.
- Notifies **every** profile with `role='sponsor'` and `sponsor_id = fulfillment.sponsor_id`
  (same fan-out as `app/actions/moderation.ts:113-131`), `type: 'general'`.
- `revalidatePath('/dashboard')`, `revalidatePath('/sponsor/funding')`.
- Leave a `// prompt 04 hooks receipt issuance in here` marker at the end. Do not stub a
  call to a function that does not exist.

```ts
adminOverrideFulfillmentStatus(input: {
  fulfillmentId: string
  toStatus: 'pledged' | 'agreement_signed' | 'payment_sent' | 'payment_received' | 'cancelled'
  reason: string           // required, min 10 chars — an override must be explained
  paymentMethod?: 'check' | 'ach' | 'wire' | 'other'
  occurredOn?: string
}): Promise<{ success?: true; error?: string }>
```
- Guard: `requireAdmin()`.
- Audit `'admin_override_fulfillment'` with `{ fulfillment_id, to_status, reason }`.
- Notifies **both** counterparties, `type: 'general'`, stating that an administrator
  changed the status and why.

`notifications.type` is a text column with a CHECK limited to
`submission_declined | submission_approved | submission_changes_requested | coach_verified | general`.
**Use `'general'`. Do not add an enum value** — that is a separate migration and is not
worth it for this slice.

### `lib/schemas/limits.ts`

Add, alongside the existing keys:

```ts
  paymentReference: 64,
  fulfillmentNote: 1000,
```

Reference these constants in `lib/schemas/fulfillment.ts`; never hardcode the numbers.

### `lib/fulfillment-status.ts`

Mirror `lib/submission-status.ts` in spirit and comment density:

```ts
export const FULFILLMENT_STATUSES = ['pledged','agreement_signed','payment_sent','payment_received','receipted','cancelled'] as const
export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number]

/** Money committed but not yet in the team's account. Drives the aging report. */
export const OPEN_FULFILLMENT_STATUSES = ['pledged','agreement_signed','payment_sent'] as const
export const TERMINAL_FULFILLMENT_STATUSES = ['receipted','cancelled'] as const

/** The authoritative transition table. Mirrors record_fulfillment_transition in 0076. */
export const LEGAL_TRANSITIONS: Record<FulfillmentStatus, readonly FulfillmentStatus[]>
export function canTransition(from: FulfillmentStatus, to: FulfillmentStatus, role: 'sponsor'|'coach'|'admin'|'system'): boolean
export function isOpenFulfillment(s?: string | null): boolean
export function fulfillmentStatusLabel(s: FulfillmentStatus): string   // 'Pledged', 'Payment sent', …
```

The TS copy is for UX (disabling buttons, labels). The RPC remains the enforcement point.

## UI

**No new pages in this slice.** The only UI change is the honest-copy fix on
`app/(sponsor)/sponsor/funding/page.tsx`:

- `:68` `"Confirmed disbursements"` → `"Commitments — payment tracked separately"`.
- `:76` card description `"Funding disbursements to teams."` → `"Sponsorships you have committed to. Payment status is tracked per commitment."`
- `:100` the per-row `"Confirmed"` chip → render the joined `funding_fulfillments.status`
  through `fulfillmentStatusLabel()`; when no fulfillment row is joined (a legacy ledger
  row the backfill missed) render `"Pledged"`.
- `:55` `"Total Approved"` and `:59` `"Across all teams, all time"` are accurate — leave
  them alone.
- Change the query to `.select('*, teams(team_name), funding_fulfillments(id, status)')`.
  Keep the existing `(t.teams as any)?.team_name ?? 'Team no longer on the platform'`
  null-guard at `:94` — 0061 makes `team_id` genuinely nullable.

States on that page: the existing `EmptyState` at `:104-116` stays; update its description
to say payments are tracked per commitment. Loading is the route's default; there is no new
error surface. Prompt 03 replaces this page entirely — keep the diff to copy plus the one
joined column.

## Out of scope

- Any new page or dialog. Prompt 03 owns the sponsor tracker, coach view, and admin
  reconciliation dashboard.
- W-9 / payout profile / EIN — prompt 02.
- Receipts and the `payment_received → receipted` caller — prompt 04.
- Agreements, e-signature, and making `agreement_signed` a blocking gate — prompts 05/06.
- Nudge emails and the new cron route — prompt 03.
- Touching `transactions_ledger` DDL, `sponsors.funding_used_cents`, capacity checks,
  `approve_submission_atomic`, or `release_submission_reservation`. The two-phase funding
  model is finished and correct (_CONTEXT §4) — this table sits *beside* it.
- Adding a `notifications.type` enum/CHECK value.

## Guardrails specific to this slice

1. **Never `auth.uid()`.** It is NULL under Clerk. Use `current_profile_id()`, `is_admin()`,
   `is_trusted_server_context()`.
2. **Do not copy 0065's bare `ELSE` actor branch.** Use the three-branch form in §Data model
   — 0072 documented that `(auth.jwt()->>'sub') IS NULL` is also true for the anon key.
3. **REVOKE EXECUTE … FROM PUBLIC, anon, authenticated; GRANT … TO service_role** on
   `record_fulfillment_transition`. Postgres defaults to PUBLIC; this bit the project in 0062.
   **Do not** revoke on `can_read_fulfillment` — it runs inside an RLS policy as the calling
   role and revoking makes every read 42501.
4. **`$$`-quoted blocks ⇒ apply with `psql -f`,** never the Supabase CLI splitter
   (_CONTEXT §8.2). Run it twice to prove idempotency.
5. **Reproduce both settle-RPC bodies verbatim.** A `CREATE OR REPLACE` replaces the whole
   body. Omitting one line of 0065's partial-release logic silently reintroduces the P0-5
   double-debit or leaves a partial's remainder reserved forever.
6. **`payment_reference` never leaves the row.** Not in `audit_log.metadata`, not in event
   `metadata`, not in a notification body, not in an email, not in a `console.log`.
7. **Do not add a fulfillment column to `submissions`.** `guard_submission_writable_columns()`
   fails closed against an allowlist (0064) and you would have to widen it. The relationship
   already exists via `submission_id` on this table.
8. **The events policy must go through `can_read_fulfillment()`.** An inline sublink risks
   42P17 (0066).
9. `transactions_ledger` stays append-only and untouched. It is the immutable commitment
   record; this is the mutable fulfillment record. Do not merge them.
10. Sponsors must never see another sponsor's fulfillment; coaches must never see another
    team's. Prove it with tests, not by reading the policy.

## Files you will touch

**Create:**
- `supabase/migrations/0076_funding_fulfillments.sql`
- `lib/fulfillment-status.ts`
- `lib/schemas/fulfillment.ts`
- `app/actions/fulfillment.ts`
- `lib/__tests__/fulfillment-status.test.ts`
- `tests/e2e/fulfillment-transitions.spec.ts`

**Modify:**
- `lib/schemas/limits.ts` (two new keys)
- `app/(sponsor)/sponsor/funding/page.tsx` (labels + one joined column)
- `lib/supabase/types.ts` (regenerate or hand-add the two tables + two enums; the repo
  keeps this file checked in — match whichever style is already there)

## Tests

**Unit — `lib/__tests__/fulfillment-status.test.ts` (Vitest):**
- `LEGAL_TRANSITIONS` matches the table in this prompt exactly, including that
  `receipted` and `cancelled` have no outgoing transitions.
- `canTransition('payment_sent','payment_received','sponsor')` is **false**;
  `…,'coach')` is true; `…,'admin')` is true.
- `canTransition('pledged','payment_sent','coach')` is **false**.
- `canTransition('pledged','payment_received', role)` is false for every role — no skipping.
- `isOpenFulfillment` covers all six statuses.

**Unit — extend `lib/__tests__/remediation-invariants.test.ts` (or add a sibling):**
- Static assertion that the string `payment_reference` does not appear inside any
  `audit_log` insert or `createInAppNotification` call in `app/actions/fulfillment.ts`
  (read the file, regex it — the same style the repo already uses for invariant tests).

**E2E — `tests/e2e/fulfillment-transitions.spec.ts` (Playwright). Security boundaries are
mandatory:**
- Sponsor A marks payment sent on their own fulfillment → succeeds; status becomes
  `payment_sent`; one event row appended.
- **Sponsor B calls `markPaymentSent` on Sponsor A's fulfillment → error, row unchanged,
  no event row.**
- **Coach of Team X calls `confirmPaymentReceived` on Team Y's fulfillment → error.**
- **A coach calling `markPaymentSent` and a sponsor calling `confirmPaymentReceived` are
  both rejected** (`illegal_transition` / `unauthorized`), even on rows they own.
- **RLS proof, direct against PostgREST, not through the app:**
  `GET /rest/v1/funding_fulfillments?select=*` as sponsor B returns `[]` for A's rows;
  as anon returns `[]`; `PATCH` and `DELETE` as any authenticated role affect 0 rows.
- Double-transition to the same status returns `already_in_status` and appends no second
  event row.
- Admin override from `payment_sent` back to `pledged` succeeds and writes an
  `admin_override_fulfillment` audit row with the reason.

## Acceptance criteria

- [ ] A sponsor accepting a pitch in the portal produces exactly one `transactions_ledger`
      row **and** exactly one `funding_fulfillments` row with `status='pledged'`, in the
      same transaction.
- [ ] The same is true for an acceptance made through the emailed `/sponsor-view/[token]` link.
- [ ] `sponsors.funding_used_cents` is unchanged by this migration for every existing
      sponsor — the invariant in `_CONTEXT` §4 still holds after applying and replaying.
- [ ] Running the backfill against a DB with N ledger rows produces N fulfillment rows;
      running it a second time produces 0 additional rows.
- [ ] A sponsor pressing "mark payment sent" (invoked directly against the action in a test)
      moves the row to `payment_sent`, records the method, appends one event, and the coach
      receives an in-app notification **and** an email that does not contain the reference.
- [ ] A coach confirming receipt moves the row to `payment_received` and notifies every
      sponsor-role profile linked to that sponsor.
- [ ] A sponsor attempting to confirm receipt on their own fulfillment is refused.
- [ ] A coach attempting to mark payment sent is refused.
- [ ] Sponsor B reading `funding_fulfillments` over the REST API sees none of Sponsor A's rows.
- [ ] Anon reading `funding_fulfillments` or `funding_fulfillment_events` gets `[]`.
- [ ] No authenticated role can UPDATE or DELETE either table.
- [ ] `/sponsor/funding` no longer contains the strings "Confirmed disbursements" or a
      hardcoded "Confirmed" chip; each row shows its real fulfillment status.
- [ ] `grep -rn "payment_reference" app/actions/fulfillment.ts` shows it only in the RPC
      argument list — never inside an audit or notification payload.
- [ ] The migration applies cleanly twice in a row with `psql -f`.
- [ ] `npm run typecheck && npm run lint && npm run build && npm run test` all pass.

## Rollback

```sql
BEGIN;

-- 1. Restore the two settle RPCs to their pre-0076 bodies.
--    Re-apply, in this order, with psql -f:
--      supabase/migrations/0065_fix_sponsor_decide_double_debit.sql
--      supabase/migrations/0071_token_decision_check_status_first.sql
--    (Both are CREATE OR REPLACE and restore the exact prior definitions.)

-- 2. Drop this migration's objects. Children before parents.
DROP TABLE IF EXISTS funding_fulfillment_events;
DROP TABLE IF EXISTS funding_fulfillments;

DROP FUNCTION IF EXISTS record_fulfillment_transition(uuid, uuid, fulfillment_status,
  fulfillment_payment_method, text, date, text);
DROP FUNCTION IF EXISTS can_read_fulfillment(uuid);

DROP TYPE IF EXISTS fulfillment_payment_method;
DROP TYPE IF EXISTS fulfillment_status;

COMMIT;
```

`transactions_ledger`, `sponsors`, and `submissions` are not modified by 0076, so nothing
about the capacity model needs reverting. Revert the code with `git revert` of this
prompt's commit; the two settle-RPC re-applies above must run **before** the deploy that
removes `app/actions/fulfillment.ts`, or an in-flight settle will fail on a missing table.

## Commit

```
feat(funding): track fulfillment state from pledge to payment received

transactions_ledger records a commitment, not a payment, and the sponsor
funding page called those rows "Confirmed disbursements". Adds a
funding_fulfillments state machine (pledged -> agreement_signed ->
payment_sent -> payment_received -> receipted, plus cancelled) with an
append-only event trail, a transition RPC that enforces who may drive
each step, RLS scoping each party to their own rows, auto-creation from
both settle paths, and a backfill. Corrects the mislabelled funding page.
```
