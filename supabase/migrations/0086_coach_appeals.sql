-- 0086_coach_appeals.sql
-- =====================================================================================
-- A recorded path for a coach to contest an adverse decision.
--
-- WHY THIS EXISTS
-- Every adverse decision on this platform is currently final and silent. A pitch declined
-- at moderation (admin_terminal_decision_atomic, 0044:81-114) leaves the coach with an
-- editable row nothing tells them about. A coach denied at credential verification
-- (denyCoach, app/actions/admin.ts) gets a red card whose only advice is "re-upload" or
-- "reply to the denial email" — a human mailbox with no state, no SLA and no record.
-- For a platform whose gatekeeping decides whether a volunteer robotics coach gets funded,
-- "we said no, email us" is not a process.
--
-- ADMIN LEVEL REQUIRED (must stay in step with app/actions/appeals.ts)
--   read the queue .................................. requireAdmin()      (reviewer)
--   assignAppeal (open -> under_review) ............. requireAdmin()      (reviewer)
--   resolveAppeal, subject 'submission' ............. requireAdmin()      (reviewer)
--   resolveAppeal, subject 'coach_verification' ..... requireAdmin()      (reviewer)
--   SELF-REVIEW OVERRIDE ............................ requireSuperAdmin()
-- The last row is the only governance act here: it is a decision *about the process*, and
-- the one place the integrity of the appeal is at stake. 0084's reviewer/super-admin split
-- is honoured, not redrawn.
--
-- NO AUTO-EXPIRY, DELIBERATELY
-- Filing closes 30 days after the decision. But an appeal already `open` when that window
-- closes stays open until a human resolves it. There is no cron sweep and no auto-close:
-- an unresolved appeal is the PLATFORM's failure, not the coach's, and expiring it would
-- let the platform win by running out the clock. The admin queue surfaces age instead.
--
-- APPLY WITH:  psql "$DATABASE_URL" -f supabase/migrations/0086_coach_appeals.sql
-- (defines $$-quoted functions — must not go through the Supabase CLI statement splitter)
-- Idempotent: IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS throughout.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1. Table
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appeals (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  subject_type         text NOT NULL,
  -- Polymorphic on purpose: submissions.id, profiles.id, or (later)
  -- team_verification_records.id. No FK — a single column cannot reference three tables,
  -- and a per-type nullable FK triple would let a row point at two subjects at once.
  -- Integrity is held by createAppeal, which resolves and validates the subject before
  -- inserting, plus the trigger below which re-checks the window on the way in.
  subject_id           uuid NOT NULL,

  appellant_profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  statement            text NOT NULL,

  status               text NOT NULL DEFAULT 'open',

  -- Snapshot of the decision being appealed. decision_at is part of the uniqueness key,
  -- so it must never be recomputed after insert (the trigger enforces that).
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

  -- text + CHECK rather than enums, matching the notifications.type idiom (0023:30-40).
  -- 'team_verification' is declared from day one so a from-scratch replay works
  -- (_CONTEXT.md §8 rule 1), even though createAppeal refuses it until prompt 07 lands.
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
  -- with a substantive logged reason. See the header for why it is soft rather than a hard
  -- block — this platform can legitimately run with exactly one admin, and a hard block
  -- would make every appeal in that deployment permanently unresolvable, which is strictly
  -- worse for the coach than a self-review that is visibly labelled as one.
  CONSTRAINT appeals_self_review_needs_override CHECK (
    assigned_reviewer_id IS NULL
    OR original_decider_id IS NULL
    OR assigned_reviewer_id <> original_decider_id
    OR (override_reason IS NOT NULL AND length(btrim(override_reason)) >= 20)
  )
);

COMMENT ON TABLE appeals IS
  'Coach appeals against adverse platform decisions (declined pitch, denied credentials). '
  'One appeal per decision, enforced by uq_appeals_one_per_decision. Writes go exclusively '
  'through app/actions/appeals.ts on the admin client; there is no client write policy.';

-- ONE APPEAL PER DECISION, EVER — a constraint, not a rate limit.
--
-- check_throttle is the wrong tool here: it is a rate limiter for anonymous surfaces and it
-- FAILS OPEN by design (lib/throttle.ts). "Fails open" on an appeal limit means a Sentry
-- blip lets a coach file fifty appeals. A unique index cannot fail open.
--
-- decision_at is in the key deliberately, and it is what makes this per-DECISION rather than
-- per-SUBJECT: a coach denied at verification who re-uploads and is denied again gets a
-- fresh denied_at and therefore a fresh right of appeal. Without that column, one appeal on
-- a profile would silence every future denial of that profile.
--
-- Excluding 'withdrawn' lets a coach who filed in haste withdraw and re-file once, inside
-- the window. An appeal is not a conversation — a second substantive bite comes from
-- submitting a new pitch, not from re-arguing the old one.
CREATE UNIQUE INDEX IF NOT EXISTS uq_appeals_one_per_decision
  ON appeals (subject_type, subject_id, decision_at) WHERE status <> 'withdrawn';

CREATE INDEX IF NOT EXISTS idx_appeals_appellant ON appeals (appellant_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_appeals_open      ON appeals (created_at) WHERE status IN ('open', 'under_review');
CREATE INDEX IF NOT EXISTS idx_appeals_subject   ON appeals (subject_type, subject_id);

-- Reuse the existing updated_at trigger (0008:43) rather than writing it from the action.
DROP TRIGGER IF EXISTS set_updated_at_appeals ON appeals;
CREATE TRIGGER set_updated_at_appeals
  BEFORE UPDATE ON appeals
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- -------------------------------------------------------------------------------------
-- 2. Transition guard
--
--    Note the deliberate ordering: an appeal must pass through `under_review` before it can
--    be resolved. That is what makes the different-reviewer rule bite — resolution is
--    impossible without an assignment, and assignment is where the rule is checked.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_appeal_transitions()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'open' THEN
      RAISE EXCEPTION 'appeals: a new appeal must start as open' USING ERRCODE = '23514';
    END IF;
    -- 30-day window, enforced here so no write path can skip it — including the
    -- service-role admin client, which is what the actions use.
    IF NEW.created_at > NEW.decision_at + interval '30 days' THEN
      RAISE EXCEPTION 'appeals: the 30-day appeal window for this decision has closed'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.decision_at > now() THEN
      RAISE EXCEPTION 'appeals: decision_at cannot be in the future' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  -- Immutable identity: the subject and the decision it appeals never change. Without this
  -- a row could be re-pointed at a fresh decision_at and dodge the uniqueness index.
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

-- _CONTEXT.md §8 rule 4. Postgres does NOT check EXECUTE on a trigger function when the
-- trigger fires, so this only removes direct PostgREST callability — the trigger keeps
-- working for every writer. (Verified on this database; see the report.)
REVOKE EXECUTE ON FUNCTION guard_appeal_transitions() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION guard_appeal_transitions() FROM anon;
REVOKE EXECUTE ON FUNCTION guard_appeal_transitions() FROM authenticated;
GRANT  EXECUTE ON FUNCTION guard_appeal_transitions() TO service_role;

-- -------------------------------------------------------------------------------------
-- 3. RLS — two SELECT policies, and deliberately NO write policy.
--
--    No SECURITY DEFINER predicate helper is needed: these policies reference only
--    current_profile_id() and is_admin(), with no sublink into submissions or teams, so
--    there is no 42P17 exposure (contrast 0066, 0069:33-36). Do not add one.
--
--    NO SPONSOR POLICY. A sponsor reading an appeal gets zero rows, and that is correct:
--    an appeal is between a coach and the platform, and a sponsor-visible appeal would leak
--    the admin's private moderation reasoning.
--
--    Every write goes through a server action on the admin client — same shape as
--    transactions_ledger (0069:14-15). Because that client bypasses RLS, each action
--    re-verifies the actor itself; that is restated at the top of app/actions/appeals.ts.
-- -------------------------------------------------------------------------------------
ALTER TABLE appeals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "appeals_select_own" ON appeals;
CREATE POLICY "appeals_select_own" ON appeals FOR SELECT
  USING (appellant_profile_id = current_profile_id());

DROP POLICY IF EXISTS "appeals_select_admin" ON appeals;
CREATE POLICY "appeals_select_admin" ON appeals FOR SELECT
  USING (is_admin());

-- -------------------------------------------------------------------------------------
-- 4. submissions gains no column
--
--    _CONTEXT.md §8 rule 7 makes this the reflex check, so: this slice adds NOTHING to
--    submissions, and guard_submission_writable_columns() (0064:81-190) needs no allowlist
--    change. If a future change is tempted by submissions.appeal_id — don't. The link
--    already exists as appeals.subject_id, and the column would be coach-unwritable by
--    default and require an allowlist edit for zero benefit.
--
--    Related, REPORTED NOT FIXED (out of scope for this slice, per prompt 13): the early
--    return in guard_submission_writable_columns() at 0064:128-130 is the raw
--    `(auth.jwt() ->> 'sub') IS NULL` test that _CONTEXT.md §8 rule 6 forbids, because the
--    anon key also has no `sub` and the test fails open. 0084 replaced that pattern in
--    prevent_role_elevation() but not here. It should move to is_trusted_server_context().
-- -------------------------------------------------------------------------------------
