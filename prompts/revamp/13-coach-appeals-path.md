# Prompt 13 — Coach appeals path

> **Prerequisites:** `11` (needs `profiles.admin_level`, `is_super_admin()`, `requireSuperAdmin()`)
> **Reserved migration:** `0086_coach_appeals.sql` — verify it is still free with `ls supabase/migrations | tail -3`
> **Scope:** large · ~20 files
> **Leaves the repo:** green and shippable on its own

## Why this exists

Every adverse decision on this platform is final and silent.

- A pitch declined by an admin runs through `admin_terminal_decision_atomic`
  (`supabase/migrations/0044_approve_submission_consolidate.sql:81-114`), which sets
  `status='declined'` and writes `admin_feedback`. `submissions_update_coach`
  (`supabase/migrations/0064_submissions_policy_hardening.sql:219-229`) lets the coach edit a
  `declined` row, but nothing tells them that, nothing routes it back into review, and no
  human ever revisits the decision.
- A coach denied at credential verification runs through `denyCoach`
  (`app/actions/admin.ts:185-267`). It stamps `denial_reason` / `denied_at`
  (`0055_coach_denial_and_throttle.sql:15-16`), and
  `app/(auth)/awaiting-verification/page.tsx:40-80` renders that reason in a red card whose
  only advice is "re-upload" or "reply to the denial email."

There is no appeal. `grep -rn "appeal" app lib components supabase` returns nothing. The
reply-to-the-email path is a human mailbox with no state, no SLA, and no record.

For a platform whose gatekeeping decides whether a volunteer robotics coach gets funded, "we
said no, email us" is not a process. This slice makes it one.

---

## Current state (verified)

### What the two adverse decisions actually write

| Decision | Writer | Columns set | Who decided is recorded in |
|---|---|---|---|
| Pitch declined at moderation | `admin_terminal_decision_atomic` (`0044:99-104`), called by `declineSubmission` (`app/actions/moderation.ts:241`) | `status='declined'`, `admin_feedback`, `reviewed_by`, `reviewed_at` | `submissions.reviewed_by` |
| Pitch sent back for edits | same RPC, `p_new_status='changes_requested'`, called by `requestEdit` (`app/actions/moderation.ts:302`) | same | `submissions.reviewed_by` |
| Coach credentials denied | `denyCoach` (`app/actions/admin.ts:221-235`) | `coach_verified=false`, `coach_credentials_url=null`, `coach_credentials_purged_at`, `pending_team_data=null`, `denial_reason`, `denied_at` | `audit_log` row, `action='deny_coach'`, `entity_id=<coach profile id>` (`app/actions/admin.ts:239-245`) |

Two things to internalise from that table:

1. `admin_terminal_decision_atomic` **touches no money.** It writes four columns on
   `submissions` and one `audit_log` row. It never reads `sponsors`, never calls
   `release_submission_reservation`, never writes `funding_used_cents`. This matters in
   §"What `overturned` does".
2. **`denyCoach` destroys evidence.** It deletes the photo ID from storage
   (`app/actions/admin.ts:207-216`) and nulls `pending_team_data` (`:231`). An overturned
   credential denial therefore cannot simply flip `coach_verified` back — there is no
   document left to have verified. This is the single most important fact in this prompt.

### The three appealable subjects

- **`submission`** — a `declined` pitch. Whose decline, though? A sponsor decline lands in
  the *same* `status='declined'` (`0071:89-91` → `release_submission_reservation`). The
  distinguishing marker is `sent_at`: it is stamped only by `approve_submission_atomic`
  (`0044:55`), which is why `submissions_select_sponsor` uses it as the admin-gate signal
  (`0064:55-66`). So **admin-stage decline ⇔ `status='declined' AND sent_at IS NULL`**.
- **`coach_verification`** — `coach_verified=false AND denied_at IS NOT NULL`, the exact
  predicate `app/(auth)/awaiting-verification/page.tsx:40` already computes as `isDenied`.
- **`team_verification`** — belongs to prompt `07`, which creates
  `team_verification_records` and `overrideTeamVerification` under migration `0081`.
  **Prompt 07 is not a prerequisite here.** See the decision below.

### What prompt 11 gives you

`profiles.admin_level` (`reviewer | super_admin`), `is_super_admin()` in SQL, and
`requireSuperAdmin()` in `lib/actions-utils.ts` directly under `requireAdmin()`
(`lib/actions-utils.ts:106-112`). Prompt 11's split puts moderation and coach verification at
**reviewer** and money/governance at **super admin**. Honour that boundary; do not redraw it.

Prompt 11 also adds a deferred constraint trigger guaranteeing **at least one** super admin
survives any transaction. That floor is exactly one, which is why the different-reviewer rule
below is soft.

### Rate limiting

`check_throttle(text, int, interval)` — `0055:33-57`, `SECURITY DEFINER`, `EXECUTE` granted
to `service_role` only (`:61-64`), TypeScript wrapper at `app/actions/sponsor.ts:18-43`
(fails open, Sentry-reported). Available if you want it; this slice does **not** use it —
see the per-decision limit decision.

### Notifications

`createInAppNotification` (`lib/notify.ts:255-320`) inserts into `notifications` **and**
emails, unless `skipEmail`. `type` is constrained by
`notifications_type_check` (`supabase/migrations/0023_admin_fixes.sql:30-40`) to five values;
there is no appeal type and this slice does not add one — see "Out of scope".

---

## What you are building

1. An `appeals` table with RLS and read-only per-role policies, plus a transition-guard
   trigger.
2. A per-decision uniqueness constraint that makes spamming structurally impossible.
3. A **soft** different-reviewer rule: warn, then require a logged override reason.
4. A 30-day appeal window enforced in both the action and the database.
5. Five server actions: `createAppeal`, `assignAppeal`, `resolveAppeal`, `withdrawAppeal`,
   and `listAppealSubjects` (the coach-facing "what can I appeal" resolver).
6. Concrete, subject-specific `overturned` behaviour.
7. Coach UI at the two places the bad news already appears, and an admin queue.

### Decision: the different-reviewer rule is enforced softly

**Rule:** an appeal should be reviewed by an admin other than the one who made the original
decision. **Enforcement:** the assign action *warns* and refuses on the first attempt,
then accepts on a second call carrying an `overrideReason` of at least 20 characters, which
is written to `audit_log` and persisted on the appeal row.

Why not a hard block. This platform can legitimately run with one admin — prompt 11's floor
trigger guarantees *at least* one super admin, not two, and `scripts/seed-test-accounts.mjs`
provisions a single admin. A hard block would make every appeal in a single-admin deployment
permanently unresolvable: the appeal would sit `open` forever, which is a strictly worse
outcome for the coach than a self-review that is visibly labelled as one. A soft rule
produces the right behaviour in both worlds — with two admins the friction reliably routes
the appeal to the other one; with one admin it degrades to a self-review that is recorded,
attributed, and auditable.

The override is a **super admin** act, not a reviewer act (see "Admin level" below). That is
the second half of the softness: it is possible, but it is not casual.

### Decision: per-decision limit is a DB constraint, not `check_throttle`

**One appeal per decision, ever.**

```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_appeals_one_per_decision
  ON appeals (subject_type, subject_id, decision_at)
  WHERE status <> 'withdrawn';
```

`check_throttle` is the wrong tool: it is a *rate* limiter for anonymous surfaces, and it
fails open by design (`app/actions/sponsor.ts:35`). "Fails open" on an appeal limit means a
Sentry blip lets a coach file fifty appeals. A unique index cannot fail open.

`decision_at` is in the key deliberately, and it is what makes this *per decision* rather
than *per subject*: a coach denied at verification, who re-uploads and is denied again, gets
a fresh `denied_at` and therefore a fresh right of appeal. Without that column, one appeal on
a profile would silence every future denial of that profile.

`WHERE status <> 'withdrawn'` lets a coach who filed in haste withdraw and re-file once,
inside the window. An appeal is not a conversation — a second substantive bite comes from
submitting a new pitch, not from re-arguing the old one.

### Decision: `team_verification` is in the CHECK, rejected by the action

`_CONTEXT.md` §8 rule 1 says enum-ish values are pre-declared at type creation so a
from-scratch replay works. So the `subject_type` CHECK includes `'team_verification'` from
day one. But prompt `07` (`team_verification_records`, migration `0081`,
`overrideTeamVerification`) is **not** a prerequisite here, so:

- `createAppeal` returns `'Team verification appeals are not available yet.'` for that
  subject type.
- `resolveAppeal` has no `team_verification` branch.
- Both carry a one-line `TODO` naming prompt `07` and the exact action to call
  (`overrideTeamVerification`, `requireAdmin()` per that prompt's action table).

Do **not** stub a fake resolution. A resolution that pretends to do something is worse than
one that says it cannot.

### Admin level required

| Act | Guard | Why |
|---|---|---|
| Read the appeals queue | `requireAdmin()` | reviewers work the queue |
| `assignAppeal` (`open` → `under_review`) | `requireAdmin()` | triage |
| `resolveAppeal` — `upheld` / `overturned`, subject `submission` | `requireAdmin()` | it lands on the same columns `declineSubmission` / `requestEdit` already write, which prompt 11 keeps at reviewer |
| `resolveAppeal` — `upheld` / `overturned`, subject `coach_verification` | `requireAdmin()` | `verifyCoach` / `denyCoach` are reviewer-level per prompt 11's table |
| **Self-review override** (assigning yourself to an appeal of your own decision) | **`requireSuperAdmin()`** | governance, not moderation: it is a decision *about the process*, and it is the one place where the integrity of the appeal is at stake |

State this table in the migration header too, so the SQL and the actions cannot drift.

---

## Data model — `supabase/migrations/0086_coach_appeals.sql`

Contains `$$`-quoted function bodies → **must** be applied with `psql -f`
(`_CONTEXT.md` §8 rule 2).

### Table

```sql
CREATE TABLE IF NOT EXISTS appeals (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  subject_type         text NOT NULL,
  -- Polymorphic on purpose: submissions.id, profiles.id, or (later)
  -- team_verification_records.id. No FK — a single column cannot reference three tables,
  -- and a per-type nullable FK triple would let a row point at two subjects at once.
  -- Integrity is held by createAppeal, which resolves and validates the subject before
  -- inserting, plus the trigger below which re-checks the window from the real subject row.
  subject_id           uuid NOT NULL,

  appellant_profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  statement            text NOT NULL,

  status               text NOT NULL DEFAULT 'open',

  -- Snapshot of the decision being appealed. decision_at is part of the uniqueness key,
  -- so it must never be recomputed after insert.
  decision_at          timestamptz NOT NULL,
  original_decider_id  uuid REFERENCES profiles(id) ON DELETE SET NULL,

  assigned_reviewer_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  assigned_at          timestamptz,
  override_reason      text,

  resolution_notes     text,
  resolved_by          uuid REFERENCES profiles(id) ON DELETE SET NULL,
  resolved_at          timestamptz,

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT appeals_subject_type_check
    CHECK (subject_type IN ('submission', 'coach_verification', 'team_verification')),
  CONSTRAINT appeals_status_check
    CHECK (status IN ('open', 'under_review', 'upheld', 'overturned', 'withdrawn')),

  -- Terminal states carry their paperwork.
  CONSTRAINT appeals_resolved_shape CHECK (
    (status IN ('open', 'under_review') AND resolved_at IS NULL AND resolved_by IS NULL)
    OR (status IN ('upheld', 'overturned')
        AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL
        AND nullif(btrim(resolution_notes), '') IS NOT NULL)
    OR (status = 'withdrawn' AND resolved_at IS NOT NULL)
  ),

  -- The soft different-reviewer rule, as a constraint: self-review is representable only
  -- with a substantive logged reason.
  CONSTRAINT appeals_self_review_needs_override CHECK (
    assigned_reviewer_id IS NULL
    OR original_decider_id IS NULL
    OR assigned_reviewer_id <> original_decider_id
    OR (override_reason IS NOT NULL AND length(btrim(override_reason)) >= 20)
  )
);
```

`subject_type` / `status` are `text + CHECK`, matching `notifications.type`
(`0023:30-40`) — the house idiom for a small value set. Do not create enums.

Indexes:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_appeals_one_per_decision
  ON appeals (subject_type, subject_id, decision_at) WHERE status <> 'withdrawn';

CREATE INDEX IF NOT EXISTS idx_appeals_appellant ON appeals (appellant_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_appeals_open      ON appeals (created_at) WHERE status IN ('open', 'under_review');
CREATE INDEX IF NOT EXISTS idx_appeals_subject   ON appeals (subject_type, subject_id);
```

Reuse the existing `updated_at` trigger pattern (see `set_updated_at_submissions`,
`0008:43`) rather than writing `updated_at` from the action.

### Transition guard

```sql
CREATE OR REPLACE FUNCTION guard_appeal_transitions()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'open' THEN
      RAISE EXCEPTION 'appeals: a new appeal must start as open' USING ERRCODE = '23514';
    END IF;
    -- 30-day window, enforced here so no write path can skip it.
    IF NEW.created_at > NEW.decision_at + interval '30 days' THEN
      RAISE EXCEPTION 'appeals: the 30-day appeal window for this decision has closed'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.decision_at > now() THEN
      RAISE EXCEPTION 'appeals: decision_at cannot be in the future' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  -- Immutable identity: the subject and the decision it appeals never change.
  IF NEW.subject_type IS DISTINCT FROM OLD.subject_type
     OR NEW.subject_id IS DISTINCT FROM OLD.subject_id
     OR NEW.decision_at IS DISTINCT FROM OLD.decision_at
     OR NEW.appellant_profile_id IS DISTINCT FROM OLD.appellant_profile_id THEN
    RAISE EXCEPTION 'appeals: subject, appellant and decision_at are immutable'
      USING ERRCODE = '23514';
  END IF;

  -- A resolved appeal is final. No un-resolving, no re-litigating in place.
  IF OLD.status IN ('upheld', 'overturned', 'withdrawn')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'appeals: % is terminal', OLD.status USING ERRCODE = '23514';
  END IF;

  -- Legal transitions.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
         (OLD.status = 'open'         AND NEW.status IN ('under_review', 'withdrawn'))
      OR (OLD.status = 'under_review' AND NEW.status IN ('upheld', 'overturned', 'withdrawn'))
    ) THEN
      RAISE EXCEPTION 'appeals: illegal transition % -> %', OLD.status, NEW.status
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_appeal_transitions ON appeals;
CREATE TRIGGER trg_guard_appeal_transitions
  BEFORE INSERT OR UPDATE ON appeals
  FOR EACH ROW EXECUTE FUNCTION guard_appeal_transitions();
```

Note the deliberate ordering: an appeal must pass through `under_review` before it can be
resolved. That is what makes the different-reviewer rule bite — resolution is impossible
without an assignment, and assignment is where the rule is checked.

Per `_CONTEXT.md` §8 rule 4:

```sql
REVOKE EXECUTE ON FUNCTION guard_appeal_transitions() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION guard_appeal_transitions() TO service_role;
```

Postgres does not check `EXECUTE` on a trigger function when the trigger fires, so this only
removes direct PostgREST callability. Verify that on your Postgres version and note the
result in your report.

### RLS

```sql
ALTER TABLE appeals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "appeals_select_own" ON appeals;
CREATE POLICY "appeals_select_own" ON appeals FOR SELECT
  USING (appellant_profile_id = current_profile_id());

DROP POLICY IF EXISTS "appeals_select_admin" ON appeals;
CREATE POLICY "appeals_select_admin" ON appeals FOR SELECT
  USING (is_admin());
```

**No sponsor policy** — a sponsor reading an appeal gets zero rows, and that is correct: an
appeal is between a coach and the platform, and a sponsor-visible appeal would leak the
admin's private moderation reasoning.

**No INSERT / UPDATE / DELETE policies.** Every write goes through a server action on the
admin client — same shape as `transactions_ledger` (`0069:14-15`) and `_CONTEXT.md` §8
rule 9. Because the admin client bypasses RLS, **each action re-verifies the actor itself**;
state that in a comment at the top of the action file, the way the RPCs do when called with
a `p_*_id` (`_CONTEXT.md` §1).

No `SECURITY DEFINER` predicate helper is needed here: the policies reference only
`current_profile_id()` and `is_admin()`, with no sublink into `submissions` or `teams`, so
there is no 42P17 exposure (contrast `0066`, `0069:33-36`).

### `submissions` gains no column

This slice adds **nothing** to `submissions`, so `guard_submission_writable_columns()`
(`0064:81-190`) needs no allowlist change. Mentioned because `_CONTEXT.md` §8 rule 7 makes
it the reflex check. If you are tempted by a `submissions.appeal_id` denormalisation: don't —
the link already exists as `appeals.subject_id`, and adding the column would make it
coach-unwritable by default and require an allowlist edit for zero benefit.

### Type regeneration

Hand-add or regenerate `lib/supabase/types.ts` with the `appeals` Row / Insert / Update /
Relationships block.

---

## What `overturned` actually does

This is the section to get right. Be concrete, per subject type.

### `subject_type = 'submission'` → the pitch returns to `changes_requested`

**Target status: `changes_requested`.** Verified against three things:

1. `COACH_EDITABLE_STATUSES = ['draft','declined','changes_requested']`
   (`lib/submission-status.ts:35`) — `changes_requested` is a member, so the coach can edit.
2. `submissions_update_coach` (`0064:219-229`): `USING` admits
   `status IN ('draft','declined','changes_requested')`, and `WITH CHECK` admits
   `status IN ('draft','pending')` — so from `changes_requested` the coach can edit **and**
   resubmit to `pending`. Both halves work.
3. `guard_submission_writable_columns()` (`0064:81-190`): the write is performed by the
   **admin client** (service role), which the guard early-returns for at `0064:128-130`. The
   allowlist at `:86-96` is therefore not in play, and it needs no change. (Noted for a
   future slice, not to fix here: that early return is the raw
   `(auth.jwt() ->> 'sub') IS NULL` test that `_CONTEXT.md` §8 rule 6 forbids. Prompt 11
   replaces it in `prevent_role_elevation()` but not in this function. Report it; do not fix
   it in this slice.)

**Why `changes_requested` and not `draft`.** Both are coach-editable and both satisfy the
policies, so the choice is about what the coach sees. `changes_requested` is the state the
whole product already treats as "needs your attention": `admin_feedback` is surfaced
alongside it on the dashboard (`app/(coach)/dashboard/page.tsx:40,56`), and
`autoSaveSubmissionDraft` carries an explicit comment
(`app/actions/submission.ts:202-206`) about a bug where demoting such a pitch to `draft`
"erased the coach's own needs-attention alert — the one signal telling them the admin had
asked for something." Overturning to `draft` would reproduce exactly that bug on purpose.
`is_locked` (GENERATED, `status NOT IN ('draft','declined','changes_requested')`) is `false`
either way.

Alongside the status flip, the resolution appends the appeal outcome to `admin_feedback`
(prefix it, e.g. `"Appeal upheld on <date>: <resolution_notes>"` — keep the original text)
and clears `reviewed_at`. Leave `reviewed_by` alone: it records who made the *original*
decision and `appeals.resolved_by` records who overturned it.

**Capacity does not move. At all.** Cross-checked against `_CONTEXT.md` §4:

- The **RESERVE** phase is `approve_submission_atomic` (`0047`, `0044:37-58`) and nothing
  else. It only accepts `status='pending'` and it is the only writer of `sent_at`,
  `reserved_amount_cents`, and `sponsors.funding_used_cents` on this path.
- An admin-stage decline goes through `admin_terminal_decision_atomic` (`0044:81-114`), which
  reads and writes `submissions` only. **A `pending`-stage decline never reserved anything**,
  so there is nothing to release and nothing to re-reserve.
- Consequently `reserved_amount_cents` is `0`/NULL on every appealable submission, and
  `detect_capacity_drift()` (prompt 11) must return **zero rows** before and after an
  overturn. That is an acceptance criterion.
- The overturn does **not** re-dispatch. The coach edits and resubmits, and the pitch goes
  back through the normal `pending` → admin approval → `approve_submission_atomic` path. This
  is what keeps Core Mandate 2 intact: an appeal restores the coach's ability to *ask*, never
  the platform's willingness to *send*.

**Only admin-stage declines are appealable.** Enforce `status='declined' AND sent_at IS NULL`
in `createAppeal`. A sponsor's decline lands in the same `status` but with `sent_at` stamped,
and overturning a sponsor's "no" would mean re-presenting a pitch to a company that already
declined it — not an admin's call, and a straight violation of the spirit of
admin-gatekept outreach. `changes_requested` is not appealable either: it is not a denial,
and the coach can already act on it.

### `subject_type = 'coach_verification'` → the denial is cleared, verification is not granted

`overturned` here sets `denial_reason = NULL` and `denied_at = NULL` and **leaves
`coach_verified` at `false`.**

That is not a cop-out; it is the only correct behaviour, and the reason is in the code:
`denyCoach` deletes the photo ID from the `coach-credentials` bucket
(`app/actions/admin.ts:207-216`), stamps `coach_credentials_purged_at`, nulls
`coach_credentials_url` (`:224-230`), and nulls `pending_team_data` (`:231`). Setting
`coach_verified = true` would mean asserting that an adult's identity was verified against a
document that no longer exists — a direct hit on the COPPA mandate's "verified adult coaches
only", and it would also strand `verifyCoach`'s team-provisioning step
(`app/actions/admin.ts:75-130`), which reads that now-null `pending_team_data`.

What the coach gets instead is their path back:
`app/(auth)/awaiting-verification/page.tsx:40` computes `isDenied` as
`!coach_verified && !!denied_at`. Clearing `denied_at` flips that page from the red "your
application was not approved" card straight back to the ordinary "upload your credentials"
state — **with zero UI work on that page.** Verify this in the browser rather than assuming
it; it is the cheapest, most convincing demo in this slice.

The notification must say this plainly: *"Your appeal was successful. Upload your photo ID
again and an admin will review it — your original document was deleted after the first
review."*

`prevent_role_elevation()` (`0051:66-81`, replaced by prompt 11) blocks `coach_verified`
changes by non-admins; the service-role client early-returns, so the write goes through.

### `subject_type = 'team_verification'` → not implemented

`resolveAppeal` has no branch. `createAppeal` refuses the subject type. See the decision
above.

### `upheld` does nothing to the subject

By definition. It writes `resolution_notes`, `resolved_by`, `resolved_at` on the appeal and
notifies the coach. No subject row is touched. Say so in a comment so nobody "helpfully"
adds a side effect later.

---

## The appeal window

**30 days from `decision_at`**, where `decision_at` is:

| Subject | Source |
|---|---|
| `submission` | `submissions.reviewed_at` (set by `0044:103`) |
| `coach_verification` | `profiles.denied_at` (set by `app/actions/admin.ts:233`) |

Enforced twice: in `createAppeal` (friendly message, exact closing date) and in
`guard_appeal_transitions()` on `INSERT` (hard, non-bypassable).

**On expiry:**

- Filing becomes impossible. `createAppeal` returns
  `'The 30-day window to appeal this decision closed on <date>.'` and the coach UI renders
  the deadline *before* it passes and the closed state after, rather than only failing on
  submit.
- **Appeals already open are unaffected.** An appeal filed on day 29 stays `open` until an
  admin resolves it. There is no auto-close and no cron sweep: an unresolved appeal is the
  platform's failure, not the coach's, and expiring it would let the platform win by
  running out the clock. State this explicitly in the prompt's own words in the migration
  header.
- Instead, the admin queue sorts `open` appeals oldest-first and renders an age indicator
  (amber past 7 days, red past 14). Visibility, not expiry.
- No new cron route. `vercel.json` is untouched.

---

## Server actions — `app/actions/appeals.ts` (new)

Canonical five-step shape (`_CONTEXT.md` §7). File-level comment: *writes go through the
admin client, which bypasses RLS, so every action re-verifies the actor and the subject
before it writes.*

Schemas in **`lib/schemas/appeal.ts`** (new). Add one constant to `lib/schemas/limits.ts`:
`appealStatement: 3000`. Reuse the existing `LIMITS.feedback` (`lib/schemas/limits.ts:13`,
`2000`) for `resolution_notes` and `override_reason` — do not add constants for those.

### `createAppeal(input)`

- Schema: `{ subjectType: z.enum(['submission','coach_verification','team_verification']),
  subjectId: z.string().uuid(), statement: <plain text, 50..LIMITS.appealStatement> }`.
  Use the same `plainTextField` helper as the pitch fields
  (`lib/schemas/submission.ts:6-34`; note it is **not exported today** — add `export`, a
  one-word change, exactly as prompt `12` also requires. If prompt 12 already landed, it is
  already exported).
- Guard: `requireAuth()`. Deliberately **not** `requireVerifiedCoach()` — a denied coach is
  by definition unverified, and gating the appeal on verification would make credential
  appeals impossible. Assert `user.role === 'coach'` explicitly instead.
- Reject `team_verification` with the "not available yet" message.
- Resolve and validate the subject with the admin client:
  - `submission`: the row exists, `deleted_at IS NULL`, the team's `owner_id = user.id`,
    `status = 'declined'`, `sent_at IS NULL`. `decision_at = reviewed_at`,
    `original_decider_id = reviewed_by`.
  - `coach_verification`: `subjectId === user.id`, `coach_verified = false`,
    `denied_at IS NOT NULL`. `decision_at = denied_at`. `original_decider_id` = the
    `actor_id` of the most recent `audit_log` row with `action='deny_coach'` and
    `entity_id = user.id` (`app/actions/admin.ts:239-245`); `null` if none is found, which
    the self-review CHECK tolerates.
- Window check with the exact closing date in the message.
- Insert. Map `23505` from `uq_appeals_one_per_decision` to
  `'You have already appealed this decision.'` — the same friendly-mapping pattern
  `saveSubmission` uses at `app/actions/submission.ts:151-153`.
- Audit: `action: 'create_appeal'`, `entity_type: 'appeals'`, metadata
  `{ subject_type, subject_id }`. **Not the statement text.**
- Notify **every admin**, mirroring the fan-out at `app/actions/submission.ts:170-183`:
  `type: 'general'`, `'New appeal awaiting review'`, body pointing at `/appeals`.

### `assignAppeal(input)` — where the different-reviewer rule lives

- Schema: `{ appealId: uuid, reviewerId: uuid, overrideReason: z.string().trim().min(20).max(LIMITS.feedback).optional() }`.
- Guard: `requireAdmin()` for the normal case.
- Read the appeal. If `reviewerId === original_decider_id`:
  - **No `overrideReason`** → return
    `{ requiresOverride: true, warning: 'This admin made the original decision. Assigning them requires a written reason, which will be recorded in the audit log.' }`
    and **write nothing**.
  - **With `overrideReason`** → re-guard with `requireSuperAdmin()`. A reviewer attempting
    the override gets `{ error: 'Forbidden' }`. On success, persist `override_reason` and
    write a **second** `audit_log` row, `action: 'appeal_self_review_override'`, metadata
    `{ appeal_id, reviewer_id, reason }`.
- Sets `assigned_reviewer_id`, `assigned_at = now()`, `status = 'under_review'`.
- Guarded update: `.eq('id', appealId).eq('status','open').select()`; zero rows →
  `'This appeal has already been picked up.'` (the optimistic pattern from
  `app/actions/notifications.ts:27-38`).
- Audit: `assign_appeal`.
- Notify the appellant: `'Your appeal is under review'`.

### `resolveAppeal(input)`

- Schema: `{ appealId: uuid, outcome: z.enum(['upheld','overturned']),
  resolutionNotes: <plain text, 20..LIMITS.feedback> }`.
- Guard: `requireAdmin()`.
- Guarded read+update on `status = 'under_review'`; zero rows → `'This appeal is not under
  review.'`
- **Order matters.** Apply the subject-side effect **first**, and only mark the appeal
  resolved if it succeeded. An appeal marked `overturned` whose submission never moved is the
  worst possible outcome — the coach is told they won and nothing changed. If the subject
  write fails, return the error and leave the appeal `under_review` so it can be retried.
- Subject effects per the section above.
- Audit: `resolve_appeal`, metadata `{ outcome, subject_type, subject_id }`, plus — for an
  overturned submission — a second row `action: 'appeal_overturn_submission'` with
  `{ from_status: 'declined', to_status: 'changes_requested' }`, so the status change is
  attributable in the same place every other submission transition is.
- Notify the appellant with the outcome and `resolution_notes`. For an overturned credential
  denial, use the re-upload wording from the section above.
- `revalidatePath('/appeals')`, `revalidatePath('/dashboard')`, and
  `revalidatePath('/awaiting-verification')` for the credential path.

### `withdrawAppeal(input)`

- Guard: `requireAuth()`; the caller must be `appellant_profile_id`.
- Only from `open` or `under_review`. Sets `status='withdrawn'`, `resolved_at=now()`.
- Audit: `withdraw_appeal`. Notify admins (`type: 'general'`) so a queue item does not just
  vanish from under a reviewer.
- Because the unique index excludes `withdrawn`, the coach may re-file once inside the window.

### `listAppealableSubjects()`

- Guard: `requireAuth()`, coach only.
- Returns the coach's declined-at-admin submissions and, if applicable, their credential
  denial — each with `decision_at`, the computed deadline, whether the window is still open,
  and whether an appeal already exists. This is what the UI renders; do not recompute
  eligibility in three components.

---

## UI

### Coach

- **`app/(auth)/awaiting-verification/page.tsx`** — inside the existing `isDenied` branch
  (`:41-80`), below the "What to do next" card, add an **Appeal this decision** entry point:
  the deadline date, and either the form or the current appeal's status. Do not restructure
  the page; add a section.
- **`app/(coach)/appeals/page.tsx`** (new) — the coach's appeals, newest first, each showing
  status, submitted date, and resolution notes when resolved.
- **`app/(coach)/appeals/[id]/page.tsx`** (new) — detail: the statement as filed, the current
  status, the resolution, and a `Withdraw` button while `open` / `under_review`.
- **`app/(coach)/appeals/loading.tsx`** (new) — skeleton matching the coach group's existing
  `loading.tsx`.
- **`components/coach/appeal-form.tsx`** (new, client) — used in both entry points. Shows the
  deadline, a character counter against `LIMITS.appealStatement`, and a plain statement of
  what an appeal is and is not.
- **`components/coach/dashboard-shell.tsx`** — declined pitches in the submissions list
  (built at `app/(coach)/dashboard/page.tsx:33-64`) get an **Appeal** action when eligible,
  and an "Appeal <status>" pill when one exists.
- States to design deliberately: **eligible** (form), **already filed** (status card, no
  second form), **window closed** ("The 30-day window closed on <date>." — shown, not
  discovered on submit), **withdrawn** (re-file allowed, say so), **resolved** (outcome +
  notes, and for an overturned pitch a direct link to edit and resubmit).

### Admin

- **`app/(admin)/appeals/page.tsx`** (new) — the queue. Open/under-review first, oldest
  first, with the age indicator. Server component through the RLS-respecting server client.
  Include a resolved-appeals tab or filter; an appeals log nobody can read afterwards is not
  a record.
- **`app/(admin)/appeals/loading.tsx`** (new) — match `app/(admin)/coaches/loading.tsx`.
- **`components/admin/appeal-review-panel.tsx`** (new, client) — per appeal: subject summary
  (pitch title + the original `admin_feedback`, or the credential `denial_reason`), who
  decided originally, the coach's statement, and Assign / Uphold / Overturn.
  - When the signed-in admin **is** `original_decider_id`, render an amber banner —
    *"You made this decision. Assign another admin, or record a written reason to review it
    yourself."* — and reveal the reason field only on request. Never a silently-disabled
    button.
  - When the signed-in admin is a **reviewer** (prompt 11) and an override is required,
    render "A super admin must approve a self-review" instead of a dead form.
- **`components/admin/admin-sidebar.tsx`** — one `NAV_ITEMS` entry (`:28-35`): `Appeals`,
  `/appeals`, icon `Gavel`. Prompt 11 claims `Scale` for `/admin/capacity`; do not reuse it.
- **`app/api/admin/queue/count/route.ts`** — include open appeals in the `count` sum so the
  sidebar badge reflects total work with no sidebar change.
  **Collision note:** prompt `12` also adds to this route. If both have landed, `count` is
  `pending submissions + pending messages + open appeals`, and the response object carries
  `{ submissions, messages, appeals }` alongside. Reconcile rather than overwrite.

### Dev preview fixtures

`_CONTEXT.md` §9 — all three preview modes are forced off in production but must still
render:

- `lib/dev-bypass.ts` (mock table map, `submissions:` at `:130`) — add an `appeals` fixture
  with at least one `open` row, or `/appeals` throws in `npm run dev:admin-preview`.
- `lib/dev-coach-preview.ts` (`submissions` at `:142`, exported at `:177`) — a coach appeal
  fixture.
- `lib/dev-preview.ts` — sponsors see no appeals; add an empty `appeals` entry only if the
  mock client needs the key to exist.

---

## Out of scope

- Extending `notifications_type_check` (`0023:30-40`). Every appeal notification is
  `type: 'general'`; adding a value ripples into the union at `lib/notify.ts:259` and the
  inbox UI for no user-visible gain.
- A dedicated appeal email template. `createInAppNotification` already mirrors every alert to
  email via `emails/notification-email.tsx` (`lib/notify.ts:288-316`). Build a template only
  if a later slice needs richer content.
- Appeals against a **sponsor's** decision. Not an admin's call — see the section above.
- Auto-expiring open appeals, and any new cron route. `vercel.json` is untouched.
- A third admin tier, or changing prompt 11's reviewer/super-admin split.
- Any change to `approve_submission_atomic`, `release_submission_reservation`,
  `sponsor_decide_submission_atomic`, `record_sponsor_decision_atomic`, or
  `admin_terminal_decision_atomic`. This slice moves no money and re-dispatches no pitch.
- Fixing the raw `(auth.jwt() ->> 'sub') IS NULL` test in
  `guard_submission_writable_columns()` (`0064:128-130`). **Report it**; do not fix it here.
- `team_verification` resolution. Prompt `07`.

## Guardrails specific to this slice

- **Never `auth.uid()`.** `current_profile_id()` / `is_admin()` / `is_super_admin()` only.
- No SECURITY DEFINER predicate helper is needed for these policies — do not add one, and do
  not sublink into `submissions` from an `appeals` policy (that is how 42P17 starts).
- `guard_appeal_transitions()` gets the full `REVOKE`/`GRANT` block.
- `decision_at` is part of the uniqueness key and is immutable. Never recompute it on update.
- Apply the subject effect **before** marking the appeal resolved.
- An overturned submission goes to `changes_requested`, never `draft`, never `pending`.
- Capacity must not move. Prove it with `detect_capacity_drift()` (prompt 11), not by
  reasoning.
- Only `status='declined' AND sent_at IS NULL` submissions are appealable.
- An overturned credential denial does **not** set `coach_verified = true`.
- The migration has `$$` blocks → **`psql -f`**, not the Supabase CLI.
- Import status groupings from `lib/submission-status.ts`; do not re-declare arrays.
- Do not add a column to `submissions`.

---

## Files you will touch

**Create:**
- `supabase/migrations/0086_coach_appeals.sql`
- `lib/schemas/appeal.ts`
- `app/actions/appeals.ts`
- `app/(coach)/appeals/page.tsx`
- `app/(coach)/appeals/loading.tsx`
- `app/(coach)/appeals/[id]/page.tsx`
- `app/(admin)/appeals/page.tsx`
- `app/(admin)/appeals/loading.tsx`
- `components/coach/appeal-form.tsx`
- `components/admin/appeal-review-panel.tsx`
- `lib/__tests__/appeals.test.ts`
- `tests/e2e/appeals.spec.ts`

**Modify:**
- `lib/schemas/limits.ts` (`appealStatement`)
- `lib/schemas/submission.ts` (`export` on `plainTextField`, if prompt 12 has not already)
- `lib/supabase/types.ts` (`appeals`)
- `app/(auth)/awaiting-verification/page.tsx` (appeal entry point in the `isDenied` branch)
- `components/coach/dashboard-shell.tsx` (Appeal action on declined pitches)
- `components/admin/admin-sidebar.tsx` (nav item)
- `app/api/admin/queue/count/route.ts` (include open appeals)
- `lib/dev-bypass.ts`, `lib/dev-coach-preview.ts` (fixtures)

---

## Tests

### Vitest — `lib/__tests__/appeals.test.ts` (MANDATORY)

Follow the mocking style in `lib/__tests__/sponsor-application.test.ts`.

- `createAppeal` rejects a submission that is not `declined`, and one with `sent_at` set
  (the sponsor-decline case) — zero inserts in both.
- `createAppeal` rejects a subject owned by another coach — zero inserts.
- `createAppeal` past the 30-day window returns the closed-window message with the correct
  date — zero inserts.
- `createAppeal` maps `23505` to `'You have already appealed this decision.'`
- `createAppeal` rejects `team_verification`.
- `assignAppeal` with `reviewerId === original_decider_id` and no reason returns
  `{ requiresOverride: true }` and performs **zero writes** (assert the update mock was never
  called). This is the named acceptance test for the soft rule.
- `assignAppeal` with a reason, called as a **reviewer**, returns `{ error: 'Forbidden' }`.
- `assignAppeal` with a reason, called as a **super admin**, succeeds and writes an
  `appeal_self_review_override` audit row.
- `resolveAppeal('overturned')` on a submission updates `status` to **`changes_requested`**
  (assert the literal) and notifies the appellant.
- `resolveAppeal('overturned')` whose subject update **fails** leaves the appeal
  `under_review` and returns an error (assert the appeal was not marked resolved).
- `resolveAppeal('overturned')` on `coach_verification` clears `denial_reason`/`denied_at`
  and does **not** set `coach_verified` (assert the payload has no `coach_verified` key).
- `resolveAppeal('upheld')` touches no subject row.
- No action writes the statement text into `audit_log`.

### Cross-tenant isolation (MANDATORY, named acceptance test)

Both at the action level and live against a scratch DB:

- **A coach cannot read another coach's appeal.** As coach B,
  `GET /rest/v1/appeals?id=eq.<A's appeal>` → `[]`, and `/appeals/<id>` → `notFound()`.
- A sponsor reading `/rest/v1/appeals?select=*` → `[]` (no sponsor policy exists).
- Anon → `[]`.
- `INSERT` / `UPDATE` / `DELETE` on `appeals` as coach, sponsor, or anon → 0 rows.
- `withdrawAppeal` called by a non-appellant → error, zero writes.

### SQL verification block (in the migration footer, run it)

- Two appeals on the same `(subject_type, subject_id, decision_at)` → the second raises
  `23505`. Withdraw the first, re-insert → succeeds.
- Same subject, a **later** `decision_at` → succeeds (per-decision, not per-subject).
- `INSERT` with `created_at > decision_at + 30 days` → raises.
- `UPDATE` `open` → `upheld` directly → raises (must pass through `under_review`).
- `UPDATE` a resolved appeal's status → raises.
- `UPDATE` `subject_id` or `decision_at` → raises.
- `assigned_reviewer_id = original_decider_id` with a 5-character `override_reason` → raises
  the CHECK; with a 30-character one → succeeds.

### Capacity non-regression (MANDATORY)

Prompt 11 shipped `detect_capacity_drift()`. On a scratch DB:

- Snapshot `sponsors.funding_used_cents`, decline a `pending` submission, overturn the
  appeal, snapshot again → **identical**.
- `detect_capacity_drift()` returns **zero rows** at every step.
- The overturned submission has `reserved_amount_cents` `0`/NULL and `sent_at IS NULL`
  throughout.

### Playwright — `tests/e2e/appeals.spec.ts`

- Denied coach on `/awaiting-verification` sees the appeal entry point, files an appeal, and
  the page switches to the status card.
- Admin sees it at `/appeals`, assigns another admin, overturns it.
- The coach's `/awaiting-verification` now renders the **ordinary upload-credentials** state
  rather than the red denial card. (This is the zero-UI-work claim — verify it, don't assume.)
- Declined pitch: coach appeals, admin overturns, and the pitch appears editable on the
  dashboard with a resubmit path.
- Filing a second appeal on the same decision is refused.

### RLS audit (MANDATORY, gate on it)

Run the **`rls-auditor`** agent against `appeals` (and re-check `profiles` and `submissions`,
which the resolution actions write). Zero `auth.uid()` references; confirm coach-B and
sponsor isolation. Paste its findings into your report.

---

## Acceptance criteria

- [ ] `psql -f supabase/migrations/0086_coach_appeals.sql` succeeds twice in a row.
- [ ] A denied coach can file an appeal from `/awaiting-verification` and see its status.
- [ ] A coach with a pitch declined at moderation can appeal it from the dashboard.
- [ ] A coach **cannot** appeal a sponsor-declined pitch (`sent_at` set) or a
      `changes_requested` pitch.
- [ ] A second appeal on the same decision is refused with
      `'You have already appealed this decision.'`
- [ ] Withdrawing an appeal permits exactly one re-file inside the window.
- [ ] Appealing a decision older than 30 days is refused with the exact closing date, and the
      coach UI shows the deadline **before** it passes.
- [ ] An appeal already `open` when the window closes stays `open`.
- [ ] **Different-reviewer rule:** assigning the original decider without a reason returns
      `requiresOverride` and writes nothing; with a ≥20-character reason it requires a super
      admin and writes an `appeal_self_review_override` audit row.
- [ ] `overturned` on a submission sets `status = 'changes_requested'`, the coach can edit and
      resubmit it, and `submissions_update_coach` accepts both the edit and the
      `changes_requested` → `pending` transition.
- [ ] **`sponsors.funding_used_cents` is byte-identical before and after an overturn, and
      `detect_capacity_drift()` returns zero rows.**
- [ ] `overturned` on `coach_verification` clears `denial_reason`/`denied_at`, leaves
      `coach_verified = false`, and flips `/awaiting-verification` back to the
      upload-credentials state — browser-verified.
- [ ] `upheld` changes no subject row.
- [ ] An appeal cannot go `open` → `upheld` without passing through `under_review`, and a
      resolved appeal cannot be re-opened.
- [ ] **Cross-tenant isolation:** coach B reading coach A's appeal gets `[]` from PostgREST
      and `notFound()` from the app; a sponsor gets `[]`.
- [ ] `appeals` has no INSERT/UPDATE/DELETE policy —
      `SELECT policyname, cmd FROM pg_policies WHERE tablename='appeals'` returns exactly two
      `SELECT` rows.
- [ ] `rls-auditor` passes with zero `auth.uid()` hits — findings pasted in the report.
- [ ] `npm run typecheck && npm run lint && npm run build && npm run test` all green.
- [ ] Browser-verified: coach credential appeal, coach pitch appeal, and admin resolution.

---

## Rollback

`vercel rollback` reverts code, not the database.

```sql
BEGIN;
DROP TRIGGER IF EXISTS trg_guard_appeal_transitions ON appeals;
DROP FUNCTION IF EXISTS guard_appeal_transitions();
DROP TABLE IF EXISTS appeals;   -- policies and indexes go with it
COMMIT;
```

Nothing else references `appeals`, so the drop is clean. Roll the code back first or
`/appeals` 42P01s on every request.

**Already-applied overturns are not rolled back**, and should not be: a submission returned
to `changes_requested` and a cleared `denial_reason` are legitimate states the rest of the
system handles natively. They simply lose their paper trail on the `appeals` table —
`audit_log` still holds `resolve_appeal` and `appeal_overturn_submission`.

---

## Commit

```
feat(appeals): give coaches a recorded path to contest an adverse decision

Adds the appeals table (submission | coach_verification | team_verification)
with RLS, a transition guard, a 30-day window enforced in the database, and a
partial unique index on (subject_type, subject_id, decision_at) that makes one
appeal per decision structurally enforceable rather than rate-limited.

The different-reviewer rule is soft by design: assigning the original decider
warns, then requires a written reason that only a super admin can supply and
that lands in audit_log. A hard block would make appeals unresolvable in a
single-admin deployment, which prompt 11's floor of exactly one super admin
makes a real configuration.

Overturning a declined pitch returns it to changes_requested — coach-editable
per submissions_update_coach, and the state whose needs-attention alert the
dashboard already renders. No capacity moves: a pending-stage decline never
reserved anything. Overturning a credential denial clears denial_reason and
denied_at but does not grant verification, because denyCoach destroyed the
photo ID; the coach is returned to the upload state instead.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```
