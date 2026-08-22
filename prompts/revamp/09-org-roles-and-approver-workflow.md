# Prompt 09 — Org roles & the two-step approver workflow

> **Prerequisites:** `08-sponsor-organizations.md` must be applied and green. This slice
> assumes `sponsor_members`, `sponsors.clerk_org_id`, `current_sponsor_ids()`,
> `is_sponsor_org_member(uuid)` and the extended `requireSponsor()` all exist.
> **Reserved migration:** `0083_sponsor_roles_and_approvals.sql` — verify it is still free
> with `ls supabase/migrations | tail -3`
> **Scope:** large · ~20 files
> **Leaves the repo:** green and shippable on its own

## Why this exists

Prompt 08 got a second person into the sponsor account. It deliberately gave that person
**every capability the first one had** — 08's own "Out of scope" says a `member` "retains
every sponsor capability they have today, including funding decisions." So today, at a
company with four people in the org, a marketing intern can commit $25,000 of the
company's budget with two clicks and no second signature, and the only record that it
happened is an `audit_log` row nobody reads.

That is the question every corporate procurement team asks third: *who approved that.*
The answer has to be a named person who is not the person who proposed it, and the system
has to have refused to move the money until that person acted.

## Current state (verified)

### A sponsor's funding decision commits immediately, in one call

There are exactly two paths, and both settle synchronously.

**Portal path.** `sponsorUpdateSubmissionStatus`
(`app/actions/sponsor-decision.ts:40-117`) validates with a Zod schema (`:13-17`), calls
`requireSponsor()` (`:50`), and immediately invokes the settle RPC through the **admin
client** (`:60-66`):

```ts
const { data: rpcResult, error: rpcError } = await adminClient.rpc('sponsor_decide_submission_atomic', {
  p_submission_id: submissionId,
  p_sponsor_user_id: user.id,
  p_decision: status,
  p_feedback: normalizedFeedback,
  p_amount_cents: amountCents,      // hard-coded 0 at :58 — the portal only ever funds in full
})
```

On `ok`, it notifies the coach with `skipEmail: true` (`:84-93`) and fires
`sendHandshakeEmail` + `sendSubmissionDecisionEmail` (`:97-109`), then revalidates four
paths (`:111-114`). Note `amountCents = 0` at `:58`: the portal **cannot** partial-fund
today. The RPC's clamp (`0065:156-162`) turns 0 into a full settlement.

**Token path.** `recordSponsorDecision` (`app/actions/sponsor-decision.ts:119-188`) hashes
the plaintext token (`:128`), reads context through the admin client (`:130-134`), and
calls `record_sponsor_decision_atomic` (`:137-141`). It is reachable **unauthenticated** —
`/sponsor-view(.*)` is a public route (`middleware.ts:16`).

Both RPC error codes are mapped to user-safe strings in `mapDecisionError`
(`app/actions/sponsor-decision.ts:25-38`). Extend that map; do not build a second one.

### The two settle RPCs, and exactly why they must not be touched

**`sponsor_decide_submission_atomic`** — latest body `0065:69-203`.

- Actor resolution is context-aware (`0065:87-99`): when `auth.jwt() ->> 'sub'` is present
  it asserts `current_profile_id() = p_sponsor_user_id`; otherwise (the service-role admin
  client, which carries no Clerk JWT) it trusts `p_sponsor_user_id`.
- It then re-reads the profile and requires `role = 'sponsor' AND sponsor_id IS NOT NULL`
  (`:101-104`), and requires `v_submission.sponsor_id = v_profile.sponsor_id` (`:108-110`).
- Status gate: `dispatched | delivered | opened` only (`:111-113`).
- Double-settle guard: any existing `transactions_ledger` row with
  `actor_type = 'sponsor'` for that submission → `already_decided` (`:141-146`).
- **The P0-5 fix** (`:168-182`): it never re-debits `funding_used_cents`. The full amount
  was already reserved by `approve_submission_atomic`; a partial settlement releases the
  difference, a full settlement moves nothing.

**`record_sponsor_decision_atomic`** — latest body `0071:34-132`. The 0071 fix resolves the
token **without consuming it** (`:50-62`), validates the submission (`:64-73`), and only
then claims the token in a single conditional `UPDATE` (`:75-85`). Grants are strict
(`0071:136-139`): revoked from `PUBLIC`, `anon`, `authenticated`; granted to
`service_role`.

**A property you will rely on, verified line by line:** in `0065`, every branch that
returns `ok: false` returns **before any write**. `unauthorized` (`:95`, `:103`, `:109`),
`submission_not_found` (`:107`), `invalid_status` (`:112`, `:137`), `already_decided`
(`:145`) and `amount_required` (`:165`) all precede the first `UPDATE` at `:173`. A caller
may therefore invoke this function inside a larger transaction and, on `ok: false`, be
certain nothing was written. That is what makes the design below safe without savepoints.

### The reservation, and the 14-day clock a proposal must live inside

`approve_submission_atomic` (`0047:33-99`) is the RESERVE phase. It locks the sponsor row,
rejects `funding_used + ask > cap` (`0047:68-70`), sets `reserved_amount_cents`, flips the
submission to `dispatched`, and stamps `expires_at = now() + interval '14 days'`
(`0047:49`, `:77`). `release_submission_reservation` (`0047:105-152`) is guarded to
`dispatched | delivered | opened` (`:124-126`), and `expire_overdue_submissions`
(`0047:156-175`) is the nightly sweep the cron calls.

**So the sponsor's reservation has a hard 14-day life, and it is the reservation — not the
proposal — that holds the money.** Any approval window this slice invents lives strictly
inside it.

### What resolves permissions today

Nothing does. After 08:

- `requireSponsor()` (`lib/actions-utils.ts:114-126`, extended by 08) returns `sponsorId`,
  `sponsorIds`, and `membership: { id, role: 'member' | 'org_admin' } | null`. The `role`
  gates **member management only**.
- `sponsor_members.role` has `CHECK (role IN ('member','org_admin'))` — 08's data model.
- `submissions_update_sponsor` (`0051:245-263`, repointed by 08 to
  `= ANY(current_sponsor_ids())`) still lets **any** org member `UPDATE` a submission row
  directly over PostgREST, subject only to the column allowlist in
  `guard_submission_writable_columns` (`0064:81-187`).
- `sponsors` INSERT/UPDATE/DELETE policies are `is_admin()`-only —
  stated explicitly at `0051:198`. A sponsor cannot write their own company row; every
  org-settings write in this slice must go through the **admin client**.
- `ledger_select_sponsor` (`0069:21-32`, repointed by 08) grants ledger reads to the whole
  org.

### What is missing

No role beyond "can manage members." No proposal. No threshold. No second signature.
No way for an org to answer "who approved that" with a name.

## What you are building

1. **Four roles on `sponsor_members`** — `viewer | submitter | approver | org_admin`, a
   strict ladder, remapping 08's `member` → `submitter`.
2. **`sponsor_decision_proposals`** — a pending funding decision awaiting a second person.
3. **`sponsors.approval_required_above_cents`** — per-org threshold. `NULL` = approvals
   off, which is exactly today's behavior, so nothing changes for anyone until an
   `org_admin` turns it on.
4. **Two new SECURITY DEFINER RPCs that wrap, and never replace, the settle RPCs:**
   `create_sponsor_decision_proposal(...)` and `confirm_sponsor_decision_proposal(...)`.
5. **Permission helpers** — `sponsor_member_role_rank()`, `current_sponsor_member_role()`,
   `has_sponsor_permission()` — enforced in **both** RLS and the server actions.
6. **`requireSponsorRole(minRole)`** in `lib/actions-utils.ts`, plus `lib/sponsor-roles.ts`
   as the single TS mirror of the ladder.
7. **An approvals inbox** at `/sponsor/approvals`, plus role-aware decision UI.
8. **A decision on the tokenized path** — the emailed link proposes; it does not commit.

## The hard part — the proposal table sits IN FRONT of the RPCs

Read this section twice before writing a line of SQL.

**`sponsor_decide_submission_atomic` (0065) and `record_sponsor_decision_atomic` (0071)
must come out of this slice byte-for-byte identical.** Not "logically equivalent." Not
"refactored but the same." Identical, verified by hashing `pg_get_functiondef` before and
after (there is an acceptance criterion for exactly this).

The reason is not sentiment. Those two functions are where the Capacity Integrity mandate
is actually implemented, and the current bodies are the product of two P0 fixes:

- `0065` removed a **double debit** — 0053 had re-added
  `funding_used_cents = funding_used_cents + v_amount` on the settle side, on top of the
  reservation, so every portal acceptance charged the sponsor twice
  (`0065:1-36` documents the whole history).
- `0071` reordered the token claim so a stale link is not burned before its status is
  checked.

Any edit to those bodies re-opens both. So the approval gate goes **in front**:

```
                          ┌─ approvals off, or amount <= threshold ─┐
  submitter presses       │                                          ▼
  "Approve" ──────────────┤                          sponsor_decide_submission_atomic
                          │                                     (0065, UNCHANGED)
                          └─ approval required ─┐
                                                ▼
                              create_sponsor_decision_proposal        (new, 0083)
                                                │   writes ONE row. Moves no money.
                                                │   Does not touch submissions.
                                                ▼
                                       proposal: status='pending'
                                                │
                          approver presses "Confirm"
                                                ▼
                            confirm_sponsor_decision_proposal         (new, 0083)
                                                │
                                                ├─ SELECT sponsor_decide_submission_atomic(...)
                                                │       INTO v_result;      ← the SAME RPC
                                                │
                                                └─ on ok: mark proposal 'confirmed'
```

Consequences of this shape, stated so nobody is tempted to "simplify" it:

- **Capacity integrity is inherited, not re-implemented.** The reservation was taken at
  admin approval (`0047:68-86`). A proposal reserves nothing, debits nothing, and writes
  nothing to `sponsors` or `transactions_ledger`. The only function that ever writes the
  ledger is still `0065`.
- **The 0065 double-settle guard still fires.** If the token path settles while a portal
  proposal is pending, the confirm call returns `already_decided` (`0065:141-146`) and the
  proposal is closed as `expired`. No second ledger row is possible.
- **The confirming approver is the actor of record.** Pass the **approver's**
  `profiles.id` as `p_sponsor_user_id`, not the proposer's. The `audit_log` row 0065 writes
  (`:195-199`) then names the person who actually committed the money. The proposer is
  recorded separately on the proposal row.
- **The failure ordering is safe because of the property proved above.** Call the inner RPC
  first; on `ok: false` nothing was written, so return the mapped error and leave the
  proposal `pending`. Only on `ok: true` update the proposal to `confirmed`. No savepoint,
  no exception block, no rollback logic.

**Do not add a `pending_approval` value to the `submission_status` enum.** The submission
stays in `dispatched | delivered | opened` for the whole proposal window. A new enum value
would silently break: `AWAITING_SPONSOR_STATUSES` (`lib/submission-status.ts:21`) and every
consumer of it, the cron's status filter (`0047:166`), the release guard (`0047:124`), both
RPCs' status gates (`0065:111`, `0071:70`), the sidebar badge query
(`app/(sponsor)/layout.tsx:55-60`), the review-shell console gate
(`components/sponsor/review-shell.tsx:313`), and the token page's panel gate
(`app/sponsor-view/[token]/page.tsx:300-314`). The proposal's own `status` column carries
the state. Nothing else changes.

## Data model

### 1. Widen the role ladder

08 shipped `CHECK (role IN ('member','org_admin'))`. Widen it, and remap in the right
order — drop the old constraint first, or the `UPDATE` fails against it.

```sql
-- ── Role ladder: viewer < submitter < approver < org_admin ───────────────────
ALTER TABLE sponsor_members DROP CONSTRAINT IF EXISTS sponsor_members_role_check;

UPDATE sponsor_members SET role = 'submitter' WHERE role = 'member';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sponsor_members_role_check') THEN
    ALTER TABLE sponsor_members ADD CONSTRAINT sponsor_members_role_check
      CHECK (role IN ('viewer', 'submitter', 'approver', 'org_admin'));
  END IF;
END $$;

ALTER TABLE sponsor_members ALTER COLUMN role SET DEFAULT 'viewer';
```

Confirm the constraint's real name first with
`\d sponsor_members` or
`SELECT conname FROM pg_constraint WHERE conrelid = 'sponsor_members'::regclass;` —
0082 may have let Postgres auto-name it. If the name differs, use the real one and say so
in your report.

**The default flips to `viewer`.** 08 defaulted to `member` (now `submitter`); least
privilege is the correct default for anything created by a webhook you do not control.
The invite action always sets the role explicitly, so this only affects rows created by
`organizationMembership.created`.

### 2. The per-org threshold

```sql
ALTER TABLE sponsors
  ADD COLUMN IF NOT EXISTS approval_required_above_cents bigint;

ALTER TABLE sponsors DROP CONSTRAINT IF EXISTS sponsors_approval_threshold_nonneg;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sponsors_approval_threshold_nonneg') THEN
    ALTER TABLE sponsors ADD CONSTRAINT sponsors_approval_threshold_nonneg
      CHECK (approval_required_above_cents IS NULL OR approval_required_above_cents >= 0);
  END IF;
END $$;

COMMENT ON COLUMN sponsors.approval_required_above_cents IS
  'NULL = two-step approval disabled (the pre-0083 behavior: a funding decision commits '
  'immediately). When set to N, a commitment of N cents or less auto-approves and anything '
  'STRICTLY ABOVE N requires a second person with role >= approver to confirm. 0 means '
  'every funding decision needs a second signature.';
```

`NULL` is load-bearing. Every sponsor that exists when `0083` lands keeps today's behavior
until an `org_admin` opts in. Do not default it to `0`.

**The boundary is `>`, not `>=`.** "Approval required above $X" means $X itself
auto-approves. Write the test for `amount == threshold`.

### 3. `sponsor_decision_proposals`

```sql
CREATE TABLE IF NOT EXISTS sponsor_decision_proposals (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id        uuid NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  sponsor_id           uuid NOT NULL REFERENCES sponsors(id)    ON DELETE CASCADE,

  -- Only money-committing decisions are gated. A decline releases capacity rather than
  -- consuming it, so it never becomes a proposal (see "Which decisions are gated").
  decision             text   NOT NULL DEFAULT 'approved' CHECK (decision = 'approved'),
  amount_cents         bigint NOT NULL CHECK (amount_cents > 0),
  feedback             text,

  status               text NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','confirmed','rejected','withdrawn','expired')),
  -- 'portal'  = an authenticated submitter pressed Approve
  -- 'token'   = the emailed /sponsor-view/[token] link, where no person is authenticated
  origin               text NOT NULL DEFAULT 'portal' CHECK (origin IN ('portal','token')),

  -- SET NULL, deliberately, NOT RESTRICT. Deleting a Clerk account cascades straight into
  -- profiles with no application code in the loop (see 0067 / trg_release_reservation_on_delete
  -- and the user.deleted arm of app/api/webhooks/clerk/route.ts:34-69). A RESTRICT here would
  -- make that DELETE fail, the webhook 500 forever, and the account never delete.
  proposed_by          uuid REFERENCES profiles(id) ON DELETE SET NULL,
  proposed_at          timestamptz NOT NULL DEFAULT now(),

  decided_by           uuid REFERENCES profiles(id) ON DELETE SET NULL,
  decided_at           timestamptz,
  decision_note        text,
  closed_reason        text,            -- 'already_decided' | 'invalid_status' | 'window_elapsed' | ...
  settled_amount_cents bigint,          -- copied from the RPC's ok payload on confirm

  -- Never later than submissions.expires_at. Stamped by create_sponsor_decision_proposal.
  expires_at           timestamptz NOT NULL,

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- At most ONE pending proposal per submission. Same partial-unique idiom as
-- idx_single_active_submission_per_sponsor (0073:92-97).
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_pending_proposal_per_submission
  ON sponsor_decision_proposals (submission_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_proposals_sponsor_status
  ON sponsor_decision_proposals (sponsor_id, status);
CREATE INDEX IF NOT EXISTS idx_proposals_submission
  ON sponsor_decision_proposals (submission_id);
CREATE INDEX IF NOT EXISTS idx_proposals_pending_expiry
  ON sponsor_decision_proposals (expires_at)
  WHERE status = 'pending';

ALTER TABLE sponsor_decision_proposals ENABLE ROW LEVEL SECURITY;
```

Reuse the existing `set_updated_at_*` trigger idiom (first defined in `0008`, reused by
0082) — `CREATE OR REPLACE` a `set_updated_at_sponsor_decision_proposals` trigger rather
than inventing a new mechanism.

The 23505 from `idx_one_pending_proposal_per_submission` must be mapped to a specific
message in the actions, the way `app/actions/submission.ts:143-152` and `:263-264` map the
active-submission index. `mapDbError`'s generic 23505 string
(`lib/errors.ts:33-34`, "This already exists — please refresh and try again.") is wrong
here; say **"A funding request for this pitch is already awaiting approval."**

### RLS policies on `sponsor_decision_proposals`

- `proposals_select_admin` — `FOR SELECT USING (is_admin())`.
- `proposals_select_org` — `FOR SELECT USING (sponsor_id = ANY(current_sponsor_ids()))`.
  Every member, including a `viewer`, sees the org's pending queue. Visibility is the
  point of the control; the gate is on *acting*, not on *seeing*.
- **No INSERT / UPDATE / DELETE policies.** RLS denies by default, so the table is
  service-role-write-only — exactly like `sponsor_members` (0082), `audit_log` and
  `transactions_ledger`. Every write goes through the two RPCs or the admin client. An
  UPDATE policy here is a one-line path to a submitter confirming their own proposal.

### Permission helpers

```sql
-- Pure lookup. IMMUTABLE so it can appear in index/policy expressions freely.
CREATE OR REPLACE FUNCTION sponsor_member_role_rank(p_role text)
RETURNS int
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_role
           WHEN 'viewer'    THEN 1
           WHEN 'submitter' THEN 2
           WHEN 'approver'  THEN 3
           WHEN 'org_admin' THEN 4
           ELSE 0
         END;
$$;

-- The caller's role inside one org.
--
-- The COALESCE fallback is not cosmetic. 08 deliberately did NOT backfill sponsor_members
-- for existing sponsors: current_sponsor_ids() unions profiles.sponsor_id so the legacy
-- one-person shape keeps working with no membership row at all. Without the fallback,
-- every sponsor that exists on the day 0083 lands would have rank 0 and instantly lose the
-- ability to fund anything. The legacy pointer holder IS the account owner, so they get
-- org_admin.
CREATE OR REPLACE FUNCTION current_sponsor_member_role(p_sponsor_id uuid)
RETURNS text
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT m.role
       FROM sponsor_members m
      WHERE m.profile_id = current_profile_id()
        AND m.sponsor_id = p_sponsor_id),
    (SELECT 'org_admin'
       FROM profiles p
      WHERE p.id = current_profile_id()
        AND p.role = 'sponsor'
        AND p.sponsor_id = p_sponsor_id)
  );
$$;

CREATE OR REPLACE FUNCTION has_sponsor_permission(p_sponsor_id uuid, p_min_role text)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT is_sponsor_org_member(p_sponsor_id)
     AND sponsor_member_role_rank(current_sponsor_member_role(p_sponsor_id))
       >= sponsor_member_role_rank(p_min_role);
$$;
```

`is_sponsor_org_member()` (from 08) already carries the `profiles.role = 'sponsor'` gate
through `current_sponsor_ids()`, so a coach or admin holding a stray membership row still
gets `false`. Do not re-implement that check; call the function.

**Grants — the two-rule split.** 08's grants note applies verbatim and it contradicts the
naive reading of `_CONTEXT.md` §8.4:

- These three are **policy helpers**, evaluated inside RLS quals **as the querying role**.
  Revoking them from `authenticated` makes every sponsor read fail `42501` — the exact
  hazard `0062` warns about and the reason `sponsor_can_view_team` is granted to
  `authenticated` (`0066:118`).
- The two **RPCs** below are invoked over PostgREST and get the strict treatment.

```sql
REVOKE ALL ON FUNCTION sponsor_member_role_rank(text)             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION current_sponsor_member_role(uuid)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION has_sponsor_permission(uuid, text)         FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION sponsor_member_role_rank(text)          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION current_sponsor_member_role(uuid)       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION has_sponsor_permission(uuid, text)      TO authenticated, service_role;
```

### Tighten `submissions_update_sponsor`

08 left it as `= ANY(current_sponsor_ids())`, which lets a `viewer` PATCH a submission row
over PostgREST within the `guard_submission_writable_columns` allowlist (`0064:81-187`).
Nothing in the app uses that path — the decision goes through the RPC — but it is a
capability a viewer must not have. `DROP`/`CREATE`:

```sql
DROP POLICY IF EXISTS "submissions_update_sponsor" ON submissions;
CREATE POLICY "submissions_update_sponsor" ON submissions FOR UPDATE
  USING      (deleted_at IS NULL AND has_sponsor_permission(submissions.sponsor_id, 'submitter'))
  WITH CHECK (has_sponsor_permission(submissions.sponsor_id, 'submitter'));
```

Leave `submissions_select_sponsor` alone — its `sent_at IS NOT NULL` admin-gate marker
(`0064:55-66`) is a Core Mandate guard, and read access is correct for a viewer.
Leave `ledger_select_sponsor` (`0069:21-32`) alone: a viewer reading their own company's
settled commitments is the point of read-only access, and re-gating it would break the
funding page for the exact person it exists for.

### 4. `create_sponsor_decision_proposal`

```sql
create_sponsor_decision_proposal(
  p_submission_id uuid,
  p_proposed_by   uuid,       -- NULL for origin='token' (no authenticated person)
  p_amount_cents  bigint,     -- 0 means "the full reserved amount"
  p_origin        text DEFAULT 'portal',
  p_feedback      text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
```

Body, in order:

1. **Actor resolution — the three-branch form, closed against anon.** `0065:92-99` uses a
   bare `ELSE` that trusts the caller; `0072` proved that branch also admits the anon key.
   Do not copy 0065's shape into new code:
   ```plpgsql
   IF (auth.jwt() ->> 'sub') IS NOT NULL THEN
     v_actor := current_profile_id();
     IF v_actor IS NULL OR v_actor IS DISTINCT FROM p_proposed_by THEN
       RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
     END IF;
   ELSIF is_trusted_server_context() THEN
     v_actor := p_proposed_by;          -- may be NULL for the token origin
   ELSE
     RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
   END IF;
   ```
2. `p_origin` must be `'portal'` or `'token'`; `'portal'` requires a non-NULL
   `p_proposed_by` → else `unauthorized`.
3. `SELECT * INTO v_sub FROM submissions WHERE id = p_submission_id FOR UPDATE;`
   not found → `submission_not_found`.
4. Status gate, identical to the settle RPCs: `NOT IN ('dispatched','delivered','opened')`
   → `invalid_status` with `current_status` in the payload. This mirrors 0071's
   validate-before-you-burn ordering and is why the token is not consumed when a proposal
   is created.
5. For `'portal'`, require the proposer to hold rank ≥ `submitter` in
   `v_sub.sponsor_id`. Resolve it from `sponsor_members` joined to `p_proposed_by`
   **directly**, not via `current_sponsor_member_role()` — the caller here is the
   service role, so `current_profile_id()` is NULL. Apply the same legacy fallback
   (`profiles.sponsor_id = v_sub.sponsor_id` ⇒ `org_admin`). Failing → `forbidden`.
6. Amount: `v_reserved := COALESCE(v_sub.reserved_amount_cents, v_sub.requested_amount_cents, 0);`
   `v_amount := CASE WHEN p_amount_cents > 0 AND p_amount_cents < v_reserved
                     THEN p_amount_cents ELSE v_reserved END;`
   `IF v_amount <= 0 THEN RETURN ... 'amount_required'; END IF;`
   The clamp mirrors `0065:156-162` so the approver sees the number that will actually
   settle.
7. **The window.** `v_expires := LEAST(COALESCE(v_sub.expires_at, now() + interval '7 days'),
   now() + interval '7 days');`
   `IF v_expires <= now() THEN RETURN ... 'reservation_expiring'; END IF;`
   A proposal can never outlive the reservation, and never runs longer than 7 days even
   when the reservation has 13 left — an approval sitting unanswered for two weeks is a
   dead approval.
8. Re-check for a live proposal explicitly (`SELECT 1 ... WHERE submission_id = ... AND
   status = 'pending'`) → `proposal_pending`, so the common case returns a clean code
   rather than a 23505 the action has to interpret. Keep the unique index anyway; it is
   the guard against the concurrent case.
9. `INSERT` the row. **No writes to `sponsors`, `submissions`, or `transactions_ledger`.**
10. `INSERT INTO audit_log`: `action = 'propose_sponsor_funding'`,
    `entity_type = 'sponsor_decision_proposals'`, `entity_id = <new id>`,
    `metadata = { submission_id, sponsor_id, amount_cents, origin }`.
11. `RETURN jsonb_build_object('ok', true, 'proposal_id', v_id, 'amount_cents', v_amount,
    'expires_at', v_expires);`

### 5. `confirm_sponsor_decision_proposal`

```sql
confirm_sponsor_decision_proposal(
  p_proposal_id uuid,
  p_approver_id uuid,
  p_note        text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
```

Body, in order:

1. Same three-branch actor resolution against `p_approver_id`. `p_approver_id` may not be
   NULL here — a confirmation is always a named person.
2. `SELECT * INTO v_p FROM sponsor_decision_proposals WHERE id = p_proposal_id FOR UPDATE;`
   not found → `proposal_not_found`. `v_p.status <> 'pending'` → `proposal_not_pending`
   (include `current_status`).
3. `v_p.expires_at <= now()` → mark the row `expired` with
   `closed_reason = 'window_elapsed'` and return `ok:false, error:'proposal_expired'`.
4. Approver must hold rank ≥ `approver` in `v_p.sponsor_id`, resolved the same
   service-role-safe way as step 5 above (with the legacy `org_admin` fallback) →
   `forbidden`.
5. **Self-approval is refused:** `IF v_p.proposed_by IS NOT NULL AND
   v_p.proposed_by = p_approver_id THEN RETURN ... 'self_approval'; END IF;`
   The second signature has to be a second person, or the control is decoration.
   (`origin='token'` proposals have `proposed_by IS NULL`, so any approver may confirm
   them. That is intended: nobody is authenticated on the token path, so there is no
   "same person" to exclude.)
6. **Invoke the untouched RPC:**
   ```plpgsql
   SELECT sponsor_decide_submission_atomic(
            v_p.submission_id,
            p_approver_id,          -- the approver is the actor of record
            'approved',
            v_p.feedback,
            v_p.amount_cents
          ) INTO v_result;
   ```
7. `IF NOT COALESCE((v_result ->> 'ok')::boolean, false) THEN` — nothing was written (see
   the verified property above). Close the proposal so it stops cluttering the queue:
   ```plpgsql
   UPDATE sponsor_decision_proposals
      SET status = 'expired', closed_reason = v_result ->> 'error',
          decided_by = p_approver_id, decided_at = now()
    WHERE id = p_proposal_id;
   RETURN jsonb_build_object('ok', false, 'error', v_result ->> 'error');
   ```
   The two codes that land here in practice are `already_decided` (the token path settled
   first, `0065:141-146`) and `invalid_status` (the pitch bounced or expired underneath).
8. On success: `UPDATE sponsor_decision_proposals SET status='confirmed',
   decided_by=p_approver_id, decided_at=now(), decision_note=p_note,
   settled_amount_cents=(v_result->>'amount_cents')::bigint WHERE id = p_proposal_id;`
9. `INSERT INTO audit_log`: `action = 'confirm_sponsor_funding'`, entity the proposal,
   `metadata = { submission_id, sponsor_id, amount_cents, proposed_by, approver_id }`.
   0065 writes its own `sponsor_approve_submission` row (`:195-199`); both are wanted — one
   records the settlement, one records the authorization.
10. `RETURN jsonb_build_object('ok', true, 'amount_cents', (v_result->>'amount_cents')::bigint,
    'submission_id', v_p.submission_id);`

**Grants for both RPCs — the strict rule (`_CONTEXT.md` §8.4, and the pattern at
`0071:136-139`):**

```sql
REVOKE EXECUTE ON FUNCTION create_sponsor_decision_proposal(uuid, uuid, bigint, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION create_sponsor_decision_proposal(uuid, uuid, bigint, text, text)
  TO service_role;

REVOKE EXECUTE ON FUNCTION confirm_sponsor_decision_proposal(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION confirm_sponsor_decision_proposal(uuid, uuid, text)
  TO service_role;
```

This is what makes "a viewer cannot approve funding" true at the database layer even if
every line of TypeScript is bypassed: an `authenticated` PostgREST caller cannot execute
the function at all.

### 6. Close stale proposals when the pitch moves on

```sql
CREATE OR REPLACE FUNCTION expire_proposals_on_submission_exit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE sponsor_decision_proposals
     SET status = 'expired', closed_reason = 'submission_' || NEW.status,
         decided_at = now()
   WHERE submission_id = NEW.id AND status = 'pending';
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS trg_expire_proposals_on_submission_exit ON submissions;
CREATE TRIGGER trg_expire_proposals_on_submission_exit
  AFTER UPDATE OF status ON submissions
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status
        AND NEW.status IN ('declined','changes_requested','expired','bounced'))
  EXECUTE FUNCTION expire_proposals_on_submission_exit();
```

**The `WHEN` clause deliberately excludes `'approved'`.** The confirm path sets the
submission to `approved` from inside `sponsor_decide_submission_atomic` (`0065:184-190`),
in the same transaction, **before** step 8 marks the proposal `confirmed`. If the trigger
fired on `approved` it would flip our own row to `expired` mid-flight. The token-path race
is handled instead by 0065's `already_decided` guard and step 7 above — a code path that
is observable and testable, rather than an ordering coincidence.

This trigger is why the release paths (`release_submission_reservation`, `0047:105-152`,
called by the decline, bounce and nightly-expiry flows) need no changes at all.

### 7. Time-based expiry — extend the existing cron

Do **not** add a cron route. `vercel.json` schedules exactly one
(`/api/cron/expire-submissions`, `0 2 * * *`), and Hobby-tier cron slots are scarce.

```sql
CREATE OR REPLACE FUNCTION expire_stale_decision_proposals()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count int;
BEGIN
  WITH done AS (
    UPDATE sponsor_decision_proposals
       SET status = 'expired', closed_reason = 'window_elapsed', decided_at = now()
     WHERE status = 'pending' AND expires_at < now()
     RETURNING 1
  ) SELECT count(*) INTO v_count FROM done;
  RETURN jsonb_build_object('ok', true, 'expired', v_count);
END; $$;

REVOKE EXECUTE ON FUNCTION expire_stale_decision_proposals() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION expire_stale_decision_proposals() TO service_role;
```

In `app/api/cron/expire-submissions/route.ts`, mirror the existing idiom exactly: the
route already selects the rows **before** running `expire_overdue_submissions` because
afterwards they no longer match the filter and there is no way to find them again
(`route.ts:40-51`). Do the same for proposals — select the pending-and-overdue rows with
their `proposed_by`, run the RPC, then notify, using the same
`try/catch`-per-recipient shape as the coach loop at `route.ts:84-105`. Add
`proposals_expired` to the `audit_log` metadata at `route.ts:112-127` and to the JSON
response at `:130`.

### Types

`lib/supabase/types.ts` is **hand-maintained** (there is no codegen script in
`package.json`). Add `sponsors.approval_required_above_cents`, the full
`sponsor_decision_proposals` Row/Insert/Update/Relationships block, and the new `Functions`
entries, or `npm run typecheck` fails.

## Which decisions are gated, and which are not

| Decision | Gated by a proposal? | Minimum role |
|---|---|---|
| `approved` (commits money) | **Yes**, when `approval_required_above_cents IS NOT NULL AND amount > threshold` | propose: `submitter` · confirm: `approver` |
| `declined` | No — commits immediately | `submitter` |
| `changes_requested` | No — commits immediately | `submitter` |

A decline runs `release_submission_reservation` (`0065:118-134`), which **returns capacity
to the cap** rather than spending it. Forcing a second signature on "no thanks" would strand
pitches until the 14-day expiry does the same thing anyway, and it protects nothing. Both
non-money decisions still write `audit_log` (0065 does it at `:127-132`) and this slice
adds an in-app notification to the org's approvers and `org_admin`s so a unilateral decline
is visible after the fact.

## The full permission matrix

Enforced in **both** layers, always. UI-only gating is not enforcement — every row below
must be true when the button is removed from the DOM and the action is called directly, and
true again when the action is bypassed and PostgREST is called with a raw Clerk token.

| Capability | viewer | submitter | approver | org_admin | Server-action guard | Database enforcement |
|---|:--:|:--:|:--:|:--:|---|---|
| View the org's pitches | ✅ | ✅ | ✅ | ✅ | `requireSponsorRole('viewer')` | `submissions_select_sponsor` (unchanged, `sent_at IS NOT NULL` intact) |
| View the org's ledger / funding page | ✅ | ✅ | ✅ | ✅ | `requireSponsorRole('viewer')` | `ledger_select_sponsor` (unchanged) |
| View the approvals queue | ✅ | ✅ | ✅ | ✅ | `requireSponsorRole('viewer')` | `proposals_select_org` |
| Propose funding | ❌ | ✅ | ✅ | ✅ | `requireSponsorRole('submitter')` | `create_sponsor_decision_proposal` rank check (step 5) |
| Decline / request changes | ❌ | ✅ | ✅ | ✅ | `requireSponsorRole('submitter')` | `submissions_update_sponsor` + RPC actor check |
| **Approve / confirm funding** | ❌ | ❌ | ✅ | ✅ | `requireSponsorRole('approver')` | `confirm_sponsor_decision_proposal` rank check + `EXECUTE` revoked from `authenticated` |
| Reject a proposal | ❌ | ❌ | ✅ | ✅ | `requireSponsorRole('approver')` | admin-client-only write; no UPDATE policy on the table |
| Withdraw own proposal | ❌ | own only | own only | ✅ any | action re-checks `proposed_by = user.id` | admin-client-only write |
| Mark payment sent (prompt 01) | ❌ | ❌ | ✅ | ✅ | `requireSponsorRole('approver')` in `markPaymentSent` | `record_fulfillment_transition` actor/role check |
| Invite / remove / re-role members | ❌ | ❌ | ❌ | ✅ | `requireSponsorRole('org_admin')` | no write policy on `sponsor_members`; admin client only |
| Edit org settings (threshold) | ❌ | ❌ | ❌ | ✅ | `requireSponsorRole('org_admin')` | `sponsors` UPDATE policy is `is_admin()`-only (`0051:198`); admin client only |

The ladder is strict: `org_admin ⊇ approver ⊇ submitter ⊇ viewer`. An `org_admin` can
therefore approve funding alone — which is why self-approval is refused in the RPC and why
enabling the threshold requires at least two members of rank ≥ `approver`.

**Prompt 01 interaction.** If `app/actions/fulfillment.ts` exists (prompt 01 has landed),
change `markPaymentSent`'s guard from `requireSponsor()` to
`requireSponsorRole('approver')`, and repoint `fulfillments_select_sponsor` from its
`profiles.sponsor_id` sublink to `funding_fulfillments.sponsor_id = ANY(current_sponsor_ids())`
inside a guarded block so `0083` still applies cleanly when 01 has not run:

```sql
DO $$ BEGIN
  IF to_regclass('public.funding_fulfillments') IS NOT NULL THEN
    EXECUTE $p$ DROP POLICY IF EXISTS "fulfillments_select_sponsor" ON funding_fulfillments $p$;
    EXECUTE $p$ CREATE POLICY "fulfillments_select_sponsor" ON funding_fulfillments FOR SELECT
                  USING (funding_fulfillments.sponsor_id = ANY(current_sponsor_ids())) $p$;
  END IF;
END $$;
```

If the table does not exist, say so in your report — prompt 01 must then pick up the
org-aware policy itself.

## Server actions

New file `app/actions/sponsor-approvals.ts`. New schema file
`lib/schemas/sponsor-approvals.ts` (lengths from `lib/schemas/limits.ts` — add
`proposalNote: 1000` there; never hardcode). New pure module `lib/sponsor-roles.ts`.
All actions follow the canonical 5-step shape (`_CONTEXT.md` §7); always `safeParse`.

### `lib/sponsor-roles.ts` — one source of truth for the ladder

Mirror `lib/submission-status.ts`: a small, dependency-free module that exists so the UI,
the guards and the tests cannot drift apart.

```ts
export const SPONSOR_ROLES = ['viewer', 'submitter', 'approver', 'org_admin'] as const
export type SponsorRole = (typeof SPONSOR_ROLES)[number]

export const SPONSOR_ROLE_RANK: Record<SponsorRole, number> =
  { viewer: 1, submitter: 2, approver: 3, org_admin: 4 }

/** Legacy shape: a sponsor linked only through profiles.sponsor_id, with no
 *  sponsor_members row (08 deliberately did not backfill). MUST agree with the
 *  COALESCE fallback in current_sponsor_member_role(). */
export const LEGACY_MEMBER_ROLE: SponsorRole = 'org_admin'

export function hasSponsorRole(actual: SponsorRole | null, min: SponsorRole): boolean
export function requiresApproval(
  amountCents: number,
  thresholdCents: number | null
): boolean     // thresholdCents === null → false;  amountCents > thresholdCents
export const SPONSOR_ROLE_LABELS: Record<SponsorRole, { label: string; hint: string }>
```

`requiresApproval` is the one place the `>` boundary is written. Every caller — the two
actions, the review shell, the settings card — imports it.

### `requireSponsorRole()` — `lib/actions-utils.ts`

```ts
export async function requireSponsorRole(minRole: SponsorRole): Promise<{
  supabase; user; clerkUserId
  sponsorId: string
  sponsorIds: string[]
  membership: { id: string; role: SponsorRole } | null
  memberRole: SponsorRole          // membership?.role ?? LEGACY_MEMBER_ROLE
  adminClient
}>
```

- Built on 08's `requireSponsor()`; do not duplicate its resolution logic.
- Widen 08's `membership.role` union from `'member' | 'org_admin'` to `SponsorRole`.
- `memberRole = membership?.role ?? LEGACY_MEMBER_ROLE` — and that fallback must equal the
  SQL one, or the two layers disagree and one of them is a hole. There is a test for it.
- Throws `new Error('Forbidden')` when the rank is short. Add a `code` so the UI can
  distinguish it from a plain 403: `e.code = 'INSUFFICIENT_ORG_ROLE'`, following the
  `NEEDS_VERIFICATION` precedent in `requireVerifiedCoach` (`lib/actions-utils.ts:128-137`).
- The three preview short-circuits at the top of `requireAuth()`
  (`lib/actions-utils.ts:55-57`) must keep working: give the sponsor fixture in
  `lib/dev-preview.ts` an `approver` membership so `npm run dev:sponsor-preview` renders
  both sides of the flow.

### The shared follow-up, extracted

`sponsorUpdateSubmissionStatus` currently owns the post-decision fan-out: the coach
notification (`app/actions/sponsor-decision.ts:84-93`), the handshake + decision emails
(`:97-109`), and four `revalidatePath` calls (`:111-114`). The confirm action needs the
identical fan-out. Duplicating it means the handshake email — the one that tells a coach
money is coming — drifts between the two paths.

Extract it to a new **`lib/decision-followup.ts`** (not `app/actions/`: every export in a
`'use server'` file must be an async server action, which is why `lib/dispatch-budget.ts`
exists as a separate module already):

```ts
export async function runDecisionFollowUp(
  submissionId: string,
  status: 'approved' | 'declined' | 'changes_requested',
  feedback: string | undefined,
  amountCents: number
): Promise<{ emailsOk: boolean }>
```

Move the code; do not rewrite it. Both `sponsorUpdateSubmissionStatus` and
`confirmFundingProposal` call it. Keep `DECISION_EMAIL_WARNING`
(`app/actions/sponsor-decision.ts:11`) as the single warning string.

### Actions

| Action | Guard | Schema | `audit_log` | Notification |
|---|---|---|---|---|
| `sponsorUpdateSubmissionStatus` (**modified**) | `requireSponsorRole('submitter')` | existing `sponsorUpdateSchema` | unchanged (0065 writes it) / `propose_sponsor_funding` on the proposal branch | unchanged on the direct branch; on the proposal branch: notify every approver |
| `confirmFundingProposal({ proposalId, note? })` | `requireSponsorRole('approver')` | `confirmProposalSchema` | `confirm_sponsor_funding` (the RPC writes it) | `runDecisionFollowUp` + in-app to the proposer |
| `rejectFundingProposal({ proposalId, note })` | `requireSponsorRole('approver')` | `rejectProposalSchema` (note required) | `reject_sponsor_funding` | in-app to the proposer |
| `withdrawFundingProposal({ proposalId })` | `requireSponsorRole('submitter')` + `proposed_by = user.id`, or `org_admin` | `withdrawProposalSchema` (uuid) | `withdraw_sponsor_funding` | in-app to the org's approvers |
| `updateOrgApprovalSettings({ approvalRequiredAboveCents })` | `requireSponsorRole('org_admin')` | `orgApprovalSettingsSchema` (`z.number().int().min(0).nullable()`) | `update_org_approval_settings`, metadata `{ from, to }` | in-app to every member |
| `listFundingProposals()` | `requireSponsorRole('viewer')` | none | none | none |

Rules every one of them must obey:

- **Re-derive the org server-side.** The `sponsorId` comes from the guard. A `proposalId`
  argument must be re-checked with `.eq('sponsor_id', sponsorId)` before any mutation, or
  one org's approver confirms another org's spend. This is the cross-org isolation test.
- **Never trust a client-supplied amount on the confirm path.** The amount is read from
  the stored proposal row inside the RPC. `confirmFundingProposal` takes no amount.
- Writes to `sponsor_decision_proposals` and `sponsors` go through the **admin client**
  (the table has no write policy; `sponsors` UPDATE is `is_admin()`-only, `0051:198`).
- Map the new RPC error codes in `mapDecisionError`
  (`app/actions/sponsor-decision.ts:25-38`) — add `proposal_pending`, `proposal_not_found`,
  `proposal_not_pending`, `proposal_expired`, `self_approval`, `forbidden`,
  `reservation_expiring`. Extend the existing map; do not create a second one.
- Map 23505 from `idx_one_pending_proposal_per_submission` to the specific message.

### `sponsorUpdateSubmissionStatus` — the branch, precisely

```
1. safeParse (unchanged)
2. requireSponsorRole('submitter')          ← was requireSponsor()
3. if status !== 'approved'  → existing RPC call, unchanged. Then notify the org's
                               approvers + org_admins that a unilateral non-money
                               decision was taken.
4. status === 'approved':
   a. read sponsors.approval_required_above_cents for the caller's sponsorId
      (admin client — the sponsor can SELECT their own row, but read it once alongside
      the submission to avoid a second round trip)
   b. read submissions.reserved_amount_cents / requested_amount_cents for the amount
   c. requiresApproval(amount, threshold) === false
        → existing RPC call, byte-for-byte the code that is there today
      requiresApproval(...) === true
        → adminClient.rpc('create_sponsor_decision_proposal', {...})
        → notify approvers
        → return { success: true, pendingApproval: true, proposalId, amountCents }
```

**Return-shape hazard.** `components/sponsor/review-shell.tsx:114` tests
`'success' in result && result.success` and then toasts
`Submission ${status} successfully.` and navigates away
(`review-shell.tsx:123-124`). If you add `pendingApproval` without touching that branch,
a submitter who merely *proposed* a $25,000 commitment is told it was approved. Fix the
component in the same change.

### Notifying the approvers

A new proposal must reach everyone who can act on it. Resolve recipients through the
**admin client** (a cross-row read that RLS would not permit from the caller's context —
`_CONTEXT.md` §8.9):

```
SELECT profile_id FROM sponsor_members
 WHERE sponsor_id = <org> AND role IN ('approver','org_admin')
   AND profile_id <> <proposer>
```

then one `createInAppNotification({ recipientId, type: 'general', title, body,
submissionId })` each. `skipEmail` stays **false**: this is a distinct event with no
richer dedicated template, so both channels must fire (`_CONTEXT.md` §6).

Degenerate cases, all of which must be handled rather than silently producing zero
recipients:

- **No approver other than the proposer** — the proposal would be unconfirmable. The
  `updateOrgApprovalSettings` guard below is supposed to prevent this, but a member
  removal can still create it. Notify the org's `org_admin`s regardless of the
  `<> proposer` filter, and write `audit_log` action `proposal_no_eligible_approver`.
- **No members at all** (the legacy `profiles.sponsor_id`-only shape) — the threshold
  cannot be enabled for such an org in the first place, because the settings guard counts
  members. Assert that and move on.
- A `createInAppNotification` failure must never abort the proposal — the senders never
  throw and return `{ success, error }` (`_CONTEXT.md` §6). Collect and surface as a
  `warning`, exactly as `sponsorUpdateSubmissionStatus` does at
  `app/actions/sponsor-decision.ts:97-116`.

### `updateOrgApprovalSettings` — refuse to build a trap

Enabling a threshold in an org that cannot satisfy it deadlocks every future funding
decision until the 14-day reservation expires. Before writing a non-NULL value:

```
count members with sponsor_member_role_rank(role) >= 3  →  must be >= 2
```

Otherwise return
`{ error: 'Add a second teammate with the Approver role before turning on approvals — otherwise nobody could confirm a request.' }`.

Symmetrically, extend 08's member-management rules in `app/actions/sponsor-members.ts`:

- The existing "never remove or demote the last `org_admin`" rule stays.
- **New:** when `approval_required_above_cents IS NOT NULL`, refuse any removal or
  demotion that would leave fewer than two members with rank ≥ `approver`. Message:
  `'Approvals are on for this organization — keep at least two Approvers, or turn approvals off first.'`
- Widen the invite/update role enum to the four values.

## UI

**New route `app/(sponsor)/sponsor/approvals/page.tsx`** + `loading.tsx` +
`components/sponsor/approvals-panel.tsx`:

- Pending proposals table: team, pitch, amount, proposed by, proposed at, **time left in
  the window** (from `expires_at` — surface it prominently; an approval that silently
  lapses is the failure mode this whole slice is judged on).
- Row actions **Confirm** / **Reject** rendered only when `memberRole` rank ≥ `approver`;
  the actions re-check regardless. Reject requires a note.
- **Withdraw** on the proposer's own rows.
- Recently closed proposals (`confirmed | rejected | withdrawn | expired`) below the fold
  with the `closed_reason`, so "why did this disappear" is answerable in the UI.
- **Empty** — "Nothing is waiting on you." plus, for an `org_admin` with approvals off, a
  one-line link to Settings explaining what turning them on would do.
- **Permission denied** — a `viewer` or `submitter` sees the queue **read-only** with a
  one-line explanation. Never a blank page, never a redirect.
- **Error** — the existing `app/(sponsor)/error.tsx` boundary covers the route; surface
  action errors as inline destructive text, not a toast that vanishes.

**`components/sponsor/review-shell.tsx`:**

- Fix the success branch at `:114-125` for `pendingApproval` — a distinct, non-green
  confirmation ("Sent to your approvers"), and do **not** navigate away instantly.
- The Decision Console (`:333-386`) becomes role-aware:
  - `viewer` — no buttons, one line: "Your role is view-only. Ask an Approver at
    {company} to act on this."
  - `submitter` with `requiresApproval(amount, threshold)` — the primary button reads
    **"Send for approval"**, and the confirm overlay (`:389-416`) names the amount and
    says who will be notified.
  - `approver` / `org_admin` below the threshold — unchanged copy.
- A pitch that already has a pending proposal shows the proposal's state instead of the
  console, with a link to `/sponsor/approvals`.
- The page (`app/(sponsor)/sponsor/submissions/[id]/page.tsx:11-19`) currently re-reads
  `role, sponsor_id` itself; extend it to pass `memberRole` and the threshold down.

**`components/sponsor/sponsor-sidebar.tsx`** — add
`{ label: 'Approvals', href: '/sponsor/approvals', icon: ShieldCheck, exact: false,
badge: 'approvals' }` to `NAV_ITEMS` (lines 26-31), and a matching key in the `badges`
record (line 47). Thread a `pendingApprovalCount` prop through the component's props
(lines 33-43).

**`app/(sponsor)/layout.tsx`** — compute the badge count next to the existing
awaiting-sponsor count query (lines 55-60), scoped `.eq('sponsor_id', profile.sponsor_id)
.eq('status','pending')`. Do not touch the awaiting-verification gate at lines 31-50; 08
already extended it.

**`/sponsor/settings`** (`app/(sponsor)/sponsor/settings/page.tsx`, currently 32 lines
rendering only `AccountSettings`) — add an **Approval policy** card, rendered only for
`org_admin`:
- a toggle (approvals on/off) plus a dollar amount input,
- live copy: "Commitments above $X need a second person to confirm. $X and below go
  through immediately.",
- the two-approver precondition surfaced *before* submit, not as an error afterwards.

**`app/sponsor-view/[token]/page.tsx` + `components/sponsor/sponsor-decision-panel.tsx`** —
see the next section.

**`lib/dev-preview.ts`** — extend the sponsor fixture (line 29) with
`approval_required_above_cents`, the profile fixture (line 49) and the 08 membership
fixture with `role: 'approver'`, and add a `sponsor_decision_proposals` array to
`FIXTURES` (line 322) so `createMockSupabaseClient()` (line 389) serves
`/sponsor/approvals`. `lib/dev-bypass.ts` needs the same for the admin view.

## The tokenized `/sponsor-view/[token]` path — the decision

**Recommendation, adopt it: when the sponsor has approvals enabled and the amount exceeds
the threshold, the emailed link creates a proposal instead of committing.**

**Why, in one line:** the token authenticates a *mailbox*, not a *person*, so it can never
establish that whoever clicked holds the `approver` role — and a control that the org's own
portal enforces must not be bypassable by forwarding an email.

Implementation in `recordSponsorDecision` (`app/actions/sponsor-decision.ts:119-188`):

- `decision === 'decline'` → **unchanged**. No money moves; the reservation is released.
- `decision === 'full' | 'partial'`:
  1. Resolve the submission and its sponsor from the token context (the existing query at
     `:130-134` already joins `submissions → sponsors`; extend the select to include
     `approval_required_above_cents`, `reserved_amount_cents`, `requested_amount_cents`,
     `status`).
  2. `requiresApproval(amount, threshold) === false` → the existing
     `record_sponsor_decision_atomic` call, unchanged.
  3. `true` → **do not call the settle RPC at all.** Call
     `create_sponsor_decision_proposal` with `p_origin = 'token'`,
     `p_proposed_by = NULL`. Return `{ ok: true, pendingApproval: true }`.
- **The token is not burned.** 0071's whole point is that a link survives a decision it
  could not complete (`0071:1-32`). A proposal is exactly that case. The unique pending
  index then makes a second click return `proposal_pending`, which maps to "A funding
  request for this pitch is already awaiting approval" rather than a duplicate row.
- The proposal can only be confirmed by a signed-in `approver` in the portal. That is the
  point: the email link moves the request one step, and a named human finishes it.

`components/sponsor/sponsor-decision-panel.tsx` — add a `'pending_approval'` value to the
`Step` union (line 16), widen the result state type (line 23) with `pendingApproval?:
boolean`, and render a distinct terminal card instead of the green
"Decision Recorded! 🎉" block (`:36-59`):

> **Sent for approval.** {Company} requires a second approver for commitments above
> ${threshold}. We've notified them; you'll get an email when it's confirmed. This link
> stays valid until then.

The page's gating comment at `app/sponsor-view/[token]/page.tsx:287-299` explains why the
panel renders only for `isAwaitingSponsor` submissions. That stays correct — a proposal
does not change the submission's status. Pass the threshold and amount into the panel from
the page (the amount is already computed at `:50-53`).

## Out of scope

- **Any edit to `sponsor_decide_submission_atomic` (0065), `record_sponsor_decision_atomic`
  (0071), `approve_submission_atomic` (0047/0062), or
  `release_submission_reservation` (0047).** This is the central constraint of the slice.
- Partial funding from the portal. `sponsorUpdateSubmissionStatus` hard-codes
  `amountCents = 0` (`app/actions/sponsor-decision.ts:58`) and that stays. Proposals carry
  the reserved amount. Adding a partial-amount input to the portal is a separate slice.
- Multi-step / N-of-M approval chains. One proposer, one approver.
- Approval for declines and change requests (see the gating table).
- Per-team or per-category approval rules. One threshold per org.
- Delegation, out-of-office, or auto-escalation on an expiring proposal.
- SSO / SAML — prompt 10.
- Admin-side roles — prompt 11.
- Backfilling `sponsor_members` for legacy sponsors. The `org_admin` fallback in
  `current_sponsor_member_role()` covers them, exactly as 08's `current_sponsor_ids()`
  legacy branch does.

## Guardrails specific to this slice

- **The two settle RPCs come out byte-for-byte identical.** Capture
  `md5(pg_get_functiondef(p.oid))` for both before applying `0083` and compare afterwards.
  A difference is a hard fail, not a nit. This is the Capacity Integrity mandate.
- **A proposal moves no money.** It must not write `sponsors.funding_used_cents`,
  `submissions.reserved_amount_cents`, or `transactions_ledger`. Assert the 0065 invariant
  query (`0065:215-222`) is unchanged across a proposal's creation.
- **No new `submission_status` enum value.** See "The hard part" for the list of things it
  would break.
- **Never `auth.uid()`** — NULL under Clerk. Use `current_profile_id()` / `is_admin()` /
  `is_trusted_server_context()` / `current_sponsor_ids()` / `has_sponsor_permission()`.
- **The three-branch actor form, not 0065's bare `ELSE`.** `0072` documents why
  `(auth.jwt()->>'sub') IS NULL` admits the anon key. New functions use
  `is_trusted_server_context()`.
- **Grants: two different rules.** Policy helpers → granted to `authenticated`
  (`0066:118` precedent; revoking causes 42501 on every sponsor read). RPCs → revoked from
  `authenticated`, granted to `service_role` only (`0071:136-139` precedent). Getting these
  backwards produces either a total sponsor-portal outage or a viewer who can call the
  confirm RPC directly.
- **No INSERT/UPDATE/DELETE policy on `sponsor_decision_proposals`.** Ever. Same rule 08
  set for `sponsor_members`.
- **Cross-org isolation.** Every action taking a `proposalId` filters by the caller's
  `sponsorId` server-side before mutating.
- **42P17.** This slice adds no policy on `teams` and does not touch
  `sponsor_can_view_team()` (`0066:95-110`), `teams_select_sponsor` (`0066:120-122`) or
  `achievements_select` (`0066:134-146`). Run the cycle check at `0066:158-160` anyway
  after applying — the new `has_sponsor_permission()` appears in a `submissions` policy and
  the check costs nothing.
- **`guard_submission_writable_columns` (`0064:81-187`) fails closed** against an
  allowlist. This slice adds **no** column to `submissions`, so there is nothing to
  allowlist. If you find yourself adding one, stop — the design is wrong.
- **`profiles` FKs are `ON DELETE SET NULL`.** A `RESTRICT` would break Clerk account
  deletion, which runs no application code.
- **No new environment variable.** Nothing in this slice needs one. If that changes, it
  must be added to `lib/env.ts` **and** to the Vercel project, or production throws on the
  first request (`_CONTEXT.md` §10).
- **Migration `0083` contains `$$`-quoted blocks** (the `DO` blocks and five functions) —
  it **must** be applied with `psql -f`, not the Supabase CLI (`_CONTEXT.md` §8.2).

## Files you will touch

**Create:**
- `supabase/migrations/0083_sponsor_roles_and_approvals.sql`
- `lib/sponsor-roles.ts`
- `lib/decision-followup.ts`
- `lib/schemas/sponsor-approvals.ts`
- `app/actions/sponsor-approvals.ts`
- `app/(sponsor)/sponsor/approvals/page.tsx`
- `app/(sponsor)/sponsor/approvals/loading.tsx`
- `components/sponsor/approvals-panel.tsx`
- `components/sponsor/approval-policy-card.tsx`
- `lib/__tests__/sponsor-roles.test.ts`
- `tests/e2e/sponsor-approvals.spec.ts`

**Modify:**
- `lib/actions-utils.ts` (`requireSponsorRole`, widen 08's `membership.role`)
- `app/actions/sponsor-decision.ts` (branch + extract the follow-up + extend
  `mapDecisionError`)
- `app/actions/sponsor-members.ts` (four-value role enum, two-approver floor)
- `app/actions/fulfillment.ts` (`markPaymentSent` guard — **only if prompt 01 has landed**)
- `app/api/cron/expire-submissions/route.ts`
- `app/(sponsor)/layout.tsx`
- `app/(sponsor)/sponsor/submissions/[id]/page.tsx`
- `app/(sponsor)/sponsor/settings/page.tsx`
- `app/sponsor-view/[token]/page.tsx`
- `components/sponsor/review-shell.tsx`
- `components/sponsor/sponsor-decision-panel.tsx`
- `components/sponsor/sponsor-sidebar.tsx`
- `components/sponsor/members-panel.tsx` (from 08 — four roles with hints)
- `lib/schemas/limits.ts` (`proposalNote`)
- `lib/supabase/types.ts`
- `lib/dev-preview.ts`, `lib/dev-bypass.ts`
- `scripts/seed-test-accounts.mjs` (seed a viewer, a submitter and an approver in the test
  org, and a second org for the isolation tests)

## Tests

**Vitest — `lib/__tests__/sponsor-roles.test.ts`:**

- The rank ladder is strictly increasing and `hasSponsorRole` is correct at every pair.
- `requiresApproval` boundary: `(999, 1000) === false`, **`(1000, 1000) === false`**,
  `(1001, 1000) === true`, `(anything, null) === false`, `(1, 0) === true`.
- `LEGACY_MEMBER_ROLE === 'org_admin'` — with a comment pointing at the SQL `COALESCE` it
  must match.
- Schema tests for `lib/schemas/sponsor-approvals.ts`: uuid validation, required reject
  note, nullable threshold, `safeParse` usage in the actions (matching the style of
  `lib/__tests__/sponsor-application.test.ts`).

**Playwright — `tests/e2e/sponsor-approvals.spec.ts`:** an `org_admin` turns approvals on
at $1,000; a `submitter` presses Approve on a $2,500 pitch and sees "Sent for approval";
the row appears in `/sponsor/approvals`; an `approver` confirms and the pitch shows as
funded; a `viewer` sees no buttons anywhere.

**Security-boundary tests — MANDATORY, and they must run at the database layer, not only
through the actions.** Use the seeded orgs and issue raw PostgREST calls with each user's
Clerk token, the way `tests/global-setup.ts` establishes sessions.

1. **A viewer cannot approve funding.** Three assertions, all required:
   - `POST /rest/v1/rpc/confirm_sponsor_decision_proposal` as the **viewer's** token →
     denied (`EXECUTE` is revoked from `authenticated`). Also assert it as the
     **approver's** token → denied for the same reason; only `service_role` may call it.
   - `confirmFundingProposal` invoked as the viewer → `Forbidden`.
   - After both, `SELECT count(*) FROM transactions_ledger WHERE submission_id = <x>`
     is **unchanged**, and the proposal is still `pending`.
2. **A submitter cannot approve funding** — same three assertions, one rank up.
3. **Cross-org isolation.** As Org B's `approver`:
   - `confirmFundingProposal` with Org A's `proposalId` → error; A's proposal row is
     byte-identical afterwards and no ledger row exists.
   - `GET /rest/v1/sponsor_decision_proposals?sponsor_id=eq.<A>` → **0 rows**.
   - Re-run 08's group-1 reads (`sponsors`, `submissions`, `transactions_ledger`,
     `sponsor_members`) → still 0 rows. Confirms 0083 did not loosen anything.
4. **Self-approval is refused.** The org_admin proposes, then confirms their own
   proposal → `self_approval`, proposal still `pending`, no ledger row.
5. **A proposal never outlives its reservation.** Set a submission's `expires_at` to
   `now() + interval '2 days'`, create a proposal, assert
   `proposal.expires_at <= submission.expires_at` and `<= now() + 7 days`.
6. **Legacy sponsor still funds.** Delete the `sponsor_members` row for a sponsor while
   leaving `profiles.sponsor_id` set (08's legacy shape), then confirm a proposal as that
   user → succeeds. Proves the `org_admin` fallback in both layers.
7. **The settle RPCs are untouched.** Before and after applying `0083`:
   ```sql
   SELECT p.proname, md5(pg_get_functiondef(p.oid))
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('sponsor_decide_submission_atomic',
                        'record_sponsor_decision_atomic',
                        'approve_submission_atomic',
                        'release_submission_reservation');
   ```
   Identical hashes, all four. Paste both outputs.
8. **Capacity invariant after a confirm.** Run the 0065 verification query
   (`0065:215-222`) — `funding_used_cents` must equal
   `SUM(open reservations) + SUM(ledger)` for every sponsor.
9. **A proposal moves nothing.** Snapshot `sponsors.funding_used_cents`,
   `submissions.reserved_amount_cents` and `count(transactions_ledger)`; create a
   proposal; all three unchanged.
10. **The token path with approvals on.** Click Approve on `/sponsor-view/<token>` for an
    above-threshold pitch → a proposal exists with `origin='token'`,
    `submission_access_tokens.used_at IS **NULL**`, the submission still
    `dispatched|delivered|opened`, and no ledger row. Then confirm in the portal → the
    ledger row appears and `used_at` is still NULL (the token was never the settling
    path). Then re-click the link → `proposal_pending`, still one proposal.
11. **Token decline is unaffected** — declines through the link commit immediately with
    approvals on.
12. **`already_decided` closes the proposal.** Create a portal proposal, settle the same
    submission through the token path below-threshold (or directly via the RPC as
    service_role), then confirm → `already_decided`, proposal `expired` with
    `closed_reason='already_decided'`, and exactly **one** ledger row.
13. **The trigger fires on release.** Create a proposal, then
    `release_submission_reservation(<id>, 'bounced', 'test')` → the proposal is `expired`
    with `closed_reason='submission_bounced'`.
14. **The last-approver floor.** With approvals on and exactly two approvers, removing or
    demoting one → refused by the server action, and the `sponsor_members` row is unchanged
    in the database afterwards.
15. **`sponsor_decision_proposals` is not writable by a member.** `POST` / `PATCH` /
    `DELETE` on `/rest/v1/sponsor_decision_proposals` as an authenticated `org_admin` →
    denied. A coach and an anon-key caller each read **0 rows**.
16. **42P17 regression** — the cycle check at `0066:158-160`: `SET ROLE authenticated`
    with a sponsor's claims, then `SELECT` from `teams`, `submissions`,
    `team_achievements` and `transactions_ledger` in one session. Any `42P17` is a hard
    fail.

**`rls-auditor` agent pass is mandatory** before this slice can be called done. Run it over
`sponsor_decision_proposals`, `sponsor_members`, `submissions`, `sponsors` and
`transactions_ledger`, and paste its output. Zero `auth.uid()` findings.

## Acceptance criteria

- [ ] `psql -f supabase/migrations/0083_sponsor_roles_and_approvals.sql` succeeds, and
      succeeds again on a second run.
- [ ] `npm run typecheck && npm run lint && npm run build && npm run test` pass; real
      output pasted.
- [ ] **`md5(pg_get_functiondef(...))` for `sponsor_decide_submission_atomic`,
      `record_sponsor_decision_atomic`, `approve_submission_atomic` and
      `release_submission_reservation` is identical before and after `0083`.** Both
      outputs pasted.
- [ ] **`rls-auditor` pass completed with its output pasted, and no findings.**
- [ ] **A `viewer` cannot approve funding** — blocked at the action layer *and* at the
      database layer (RPC `EXECUTE` denied to `authenticated`), with no ledger row written.
      Verified against the real database.
- [ ] **Cross-org isolation** — Org B's approver cannot see, confirm, reject or withdraw
      any of Org A's proposals; all reads return 0 rows and A's row is unchanged.
- [ ] With `approval_required_above_cents IS NULL` (every existing sponsor), a funding
      decision commits in one step exactly as it does today. No behavior change without
      opt-in.
- [ ] With the threshold at $1,000: a $1,000 commitment settles immediately, a $1,000.01
      commitment creates a proposal. Both verified by reading `transactions_ledger` and
      `sponsor_decision_proposals`.
- [ ] A submitter proposing sees "Sent to your approvers", **not** a success toast saying
      the submission was approved.
- [ ] Every `approver` and `org_admin` in the org receives both an in-app notification and
      an email when a proposal is created; the proposer does not.
- [ ] Confirming writes exactly **one** `transactions_ledger` row, names the **approver**
      in the 0065 `audit_log` entry, and fires the handshake + decision emails once.
- [ ] `sponsors.funding_used_cents` is unchanged by the creation of a proposal, and the
      0065 invariant query holds for every sponsor after a confirm.
- [ ] A proposal's `expires_at` is never later than its submission's `expires_at`, and
      never more than 7 days out.
- [ ] The nightly cron expires stale proposals, notifies the proposer, and records
      `proposals_expired` in its `audit_log` metadata.
- [ ] A pitch that bounces or expires closes its pending proposal automatically
      (`closed_reason = 'submission_bounced' / 'submission_expired'`).
- [ ] Self-approval is refused by the RPC, not only the UI.
- [ ] With approvals on, `/sponsor-view/<token>` Approve creates a proposal, leaves
      `used_at` NULL, and shows the "Sent for approval" panel. Decline still commits.
- [ ] A **legacy** sponsor (no `sponsor_members` row, `profiles.sponsor_id` set) can still
      propose and confirm — proving the `org_admin` fallback agrees between
      `current_sponsor_member_role()` and `LEGACY_MEMBER_ROLE`.
- [ ] Enabling approvals in an org with fewer than two Approvers is refused with the
      explanatory message; removing the second Approver while approvals are on is also
      refused.
- [ ] Cycle check (`0066:158-160`) passes — no `42P17`.
- [ ] `npm run dev:sponsor-preview` renders `/sponsor/approvals` and the role-aware
      decision console against fixtures.
- [ ] Browser-verified end to end with three real seeded users (viewer, submitter,
      approver) — not asserted from reading the handlers.

## Rollback

`vercel rollback` reverts the deployment but not the database. Revert `0083` in this order,
or reads break between statements:

```sql
-- 1. Restore the 08 policy first (it must not reference a function you are about to drop).
DROP POLICY IF EXISTS "submissions_update_sponsor" ON submissions;
CREATE POLICY "submissions_update_sponsor" ON submissions FOR UPDATE
  USING      (deleted_at IS NULL AND submissions.sponsor_id = ANY(current_sponsor_ids()))
  WITH CHECK (submissions.sponsor_id = ANY(current_sponsor_ids()));

-- 1b. If prompt 01 had landed and 0083 repointed it, restore fulfillments_select_sponsor
--     to its 0076 text (the profiles.sponsor_id sublink) before dropping anything.

-- 2. Triggers and functions.
DROP TRIGGER  IF EXISTS trg_expire_proposals_on_submission_exit ON submissions;
DROP FUNCTION IF EXISTS expire_proposals_on_submission_exit();
DROP FUNCTION IF EXISTS expire_stale_decision_proposals();
DROP FUNCTION IF EXISTS confirm_sponsor_decision_proposal(uuid, uuid, text);
DROP FUNCTION IF EXISTS create_sponsor_decision_proposal(uuid, uuid, bigint, text, text);
DROP FUNCTION IF EXISTS has_sponsor_permission(uuid, text);
DROP FUNCTION IF EXISTS current_sponsor_member_role(uuid);
DROP FUNCTION IF EXISTS sponsor_member_role_rank(text);

-- 3. The proposal table (its policies, indexes and updated_at trigger go with it).
DROP TABLE IF EXISTS sponsor_decision_proposals;

-- 4. The threshold. Dropping the column is what actually disables the workflow, so do it
--    even if you keep the roles.
ALTER TABLE sponsors DROP CONSTRAINT IF EXISTS sponsors_approval_threshold_nonneg;
ALTER TABLE sponsors DROP COLUMN IF EXISTS approval_required_above_cents;

-- 5. Narrow the role ladder back to 0082's two values.
--    !! DATA SAFETY: this collapses viewer/submitter/approver into 'member', which under
--    0082 has FULL sponsor capability including funding decisions. A viewer you added
--    under 0083 becomes a full member on rollback. Audit sponsor_members and demote or
--    remove anyone who should not have that, BEFORE running this.
ALTER TABLE sponsor_members DROP CONSTRAINT IF EXISTS sponsor_members_role_check;
UPDATE sponsor_members SET role = 'member' WHERE role <> 'org_admin';
ALTER TABLE sponsor_members ADD CONSTRAINT sponsor_members_role_check
  CHECK (role IN ('member', 'org_admin'));
ALTER TABLE sponsor_members ALTER COLUMN role SET DEFAULT 'member';
```

Any `pending` proposal at rollback time is destroyed with the table. The money was never
committed for those, and the underlying reservation is untouched, so the correct recovery
is: tell the affected sponsors, and let them decide again through the (now one-step)
portal before the 14-day reservation lapses. There is no partial state to repair, because
a proposal never wrote to `sponsors` or `transactions_ledger`.

## Commit

```
feat(sponsors): org roles and a two-step funding approver workflow

Widens sponsor_members.role to viewer/submitter/approver/org_admin and adds
sponsor_decision_proposals plus a per-org approval_required_above_cents
threshold, so a commitment above the threshold needs a second named person to
confirm.

The proposal table sits IN FRONT of the settle path: create/confirm are new
SECURITY DEFINER RPCs, and confirmation invokes sponsor_decide_submission_atomic
unchanged. Both settle RPCs (0065, 0071) are byte-for-byte identical, so the
double-debit fix and capacity integrity are preserved exactly. A proposal moves
no money.

The tokenized /sponsor-view link now proposes rather than commits when approvals
are on — a mailbox cannot hold the approver role — and the single-use token is
left unburned.
```
