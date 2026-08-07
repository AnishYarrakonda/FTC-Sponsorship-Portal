-- 0064_submissions_policy_hardening.sql
-- =====================================================================================
-- P0-2: sponsors can read pitches the admin never approved (and ones they declined).
-- P0-3: a sponsor can rewrite any column of any submission addressed to them.
--
-- ── P0-2 ─────────────────────────────────────────────────────────────────────────────
-- `submissions_select_sponsor` (0051:211-221) has NO status predicate. The moment a
-- coach picks a sponsor and saves a DRAFT, that sponsor's account can read the full
-- pitch text through PostgREST, and app/(sponsor)/sponsor/submissions/page.tsx:21
-- surfaces it. It also leaks `admin_feedback` — the admin's private moderation notes —
-- on declined pitches. This breaks Admin-Gatekept Outreach, the platform's core promise.
--
-- The marker used here is `sent_at IS NOT NULL`. Swept to confirm it is exactly the
-- "cleared the admin gate" signal: the ONLY writers of sent_at anywhere are
-- approve_submission_atomic (0044:55, 0047:76, and 0062:174 now), all of which run
-- SECURITY DEFINER behind requireAdmin(). No app code writes it —
-- `grep -rn "sent_at" app lib components` returns only a comment and dev fixtures.
--
-- ── Why that alone does not work (report §16) ────────────────────────────────────────
-- The adversarial pass proved the sent_at gate is defeatable BY THE COACH:
-- `submissions_update_coach` (0051:235-244) has WITH CHECK (status IN ('draft','pending'))
-- and NO column guard, so a coach can PATCH sent_at on their own draft while status
-- stays 'draft' — self-serving the pitch to the sponsor with no admin involved.
-- So the coach's writable column set must be restricted too. That is part 2.
--
-- ── Why a trigger and not column-level GRANTs ────────────────────────────────────────
-- `REVOKE UPDATE (sent_at, ...) ON submissions FROM authenticated` would also strip the
-- privilege from admins and sponsors — coach, admin and sponsor are all the same
-- Postgres role (`authenticated`). RLS cannot express column restrictions at all. A
-- BEFORE UPDATE trigger is the only mechanism here that can be role-aware, and unlike a
-- policy it cannot be bypassed by any write path (PostgREST, psql, a future action).
--
-- The guard compares to_jsonb(NEW) - allowlist against to_jsonb(OLD) - allowlist, so it
-- FAILS CLOSED: a column added by a future migration is protected by default rather
-- than silently becoming coach-writable.
--
-- ── P0-3 ─────────────────────────────────────────────────────────────────────────────
-- `submissions_update_sponsor` (0051:246-264) is an unrestricted FOR UPDATE whose
-- WITH CHECK only re-asserts sponsor ownership and constrains no column, so a sponsor
-- can PATCH status='approved' and reserved_amount_cents=0 directly — no ledger row, no
-- capacity check, no audit entry, bypassing sponsor_decide_submission_atomic entirely.
-- Sponsors have no legitimate direct write: every real mutation goes through the RPC on
-- the service-role client (app/actions/sponsor-decision.ts:60,137). Dropped outright.
-- (The trigger in part 2 is a second, independent line of defence if it is ever
-- re-added.)
--
-- APPLY WITH:  psql "$DATABASE_URL" -f supabase/migrations/0064_submissions_policy_hardening.sql
-- (defines a $$-quoted function — must not go through the Supabase CLI splitter)
-- Idempotent: DROP ... IF EXISTS then CREATE throughout.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1. P0-2 — a sponsor may only read submissions that actually cleared the admin gate.
-- -------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "submissions_select_sponsor" ON submissions;
CREATE POLICY "submissions_select_sponsor" ON submissions FOR SELECT
  USING (
    deleted_at IS NULL
    AND sent_at IS NOT NULL          -- stamped only by approve_submission_atomic
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = current_profile_id()
        AND profiles.role = 'sponsor'
        AND profiles.sponsor_id = submissions.sponsor_id
    )
  );

-- -------------------------------------------------------------------------------------
-- 2. P0-2 (second half) — restrict the coach's writable column set.
--
--    Allowlist = exactly the columns the two coach write paths actually set:
--      app/actions/submission.ts:97-106   (saveSubmission payload)
--      app/actions/submission.ts:202-210  (autoSaveSubmissionDraft payload)
--    plus updated_at, which the pre-existing set_updated_at_submissions trigger
--    (0008:43) stamps on every UPDATE.
--
--    Notably NOT writable by a coach: sent_at, expires_at, reviewed_by, reviewed_at,
--    reserved_amount_cents, admin_feedback, deleted_at — i.e. every field that decides
--    whether a sponsor can see the pitch, how much money it reserves, and who approved it.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_submission_writable_columns()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_allowed text[] := ARRAY[
    'team_id',
    'sponsor_id',
    'custom_pitch_alignment',
    'specific_needs_statement',
    'local_connection_notes',
    'status',
    'submitted_at',
    'requested_amount_cents',
    'updated_at'
  ];
  v_generated text[];
BEGIN
  -- ── STORED GENERATED COLUMNS MUST BE EXCLUDED ────────────────────────────────────
  -- `submissions.is_locked` (0019_spec_parity.sql:33-37) is
  --   GENERATED ALWAYS AS (status NOT IN ('draft','declined','changes_requested')) STORED
  -- and Postgres computes stored generated columns AFTER before-row triggers. plpgsql
  -- explicitly NULLs them in NEW for BEFORE triggers (pl_exec.c: "stored generated
  -- columns are not computed yet, so make them null in the NEW row"), while OLD carries
  -- the stored value. Verified by execution on PostgreSQL 15.18 and 17.10:
  --   to_jsonb(NEW)->'is_locked' = null   vs   to_jsonb(OLD)->'is_locked' = false
  -- so the two sides can NEVER match and this guard would have raised 42501 on EVERY
  -- coach UPDATE — even a no-op that changes nothing but the pitch text. That is
  -- saveSubmission, autoSaveSubmissionDraft and draft->pending, all reported to the coach
  -- by lib/errors.ts as "You do not have permission to do that."
  --
  -- Derived from the catalog rather than hardcoding 'is_locked', so a generated column
  -- added by a future migration cannot silently reintroduce the same outage. Excluding
  -- them is safe: a generated column is a pure function of its base columns, so any real
  -- change necessarily shows up in `status`, which IS compared; and Postgres rejects a
  -- direct write to one regardless of what this trigger allows.
  SELECT COALESCE(array_agg(attname), ARRAY[]::text[])
    INTO v_generated
    FROM pg_attribute
   WHERE attrelid = TG_RELID
     AND attgenerated <> ''
     AND NOT attisdropped;

  v_allowed := v_allowed || v_generated;

  -- Trusted server context: the service-role client and every SECURITY DEFINER RPC
  -- carry no Clerk 'sub'. Same escape hatch prevent_role_elevation() uses (0051:70-72).
  IF (auth.jwt() ->> 'sub') IS NULL THEN
    RETURN NEW;
  END IF;

  -- Admins moderate through the RPCs, but submissions_update_admin exists; allow it.
  IF is_admin() THEN
    RETURN NEW;
  END IF;

  -- ── INSERT ──────────────────────────────────────────────────────────────────────
  -- Restricting UPDATE alone does not close the hole. `submissions_insert`
  -- (0051:223-233) checks only team ownership + is_coach_verified() — no status
  -- predicate, no column guard — so a verified coach could POST straight to PostgREST:
  --   {"team_id":"<own>","sponsor_id":"<target>","status":"dispatched",
  --    "sent_at":"...","reserved_amount_cents":<arbitrary>}
  -- and the row would immediately satisfy submissions_select_sponsor above
  -- (deleted_at IS NULL AND sent_at IS NOT NULL AND <sponsor owns it>), self-serving a
  -- pitch to a sponsor with no admin involved. That is the exact bypass this migration
  -- exists to close, arriving through the other verb.
  --
  -- Worse, it chains: a self-inserted 'dispatched' row with a large
  -- reserved_amount_cents, then an account deletion, makes 0067's release trigger
  -- subtract that amount from the sponsor's funding_used_cents — zeroing a real
  -- sponsor's committed capacity.
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('draft', 'pending')
       OR NEW.sent_at IS NOT NULL
       OR NEW.expires_at IS NOT NULL
       OR NEW.reviewed_by IS NOT NULL
       OR NEW.reviewed_at IS NOT NULL
       OR NEW.admin_feedback IS NOT NULL
       OR NEW.deleted_at IS NOT NULL
       OR NEW.resend_message_id IS NOT NULL
       OR COALESCE(NEW.reserved_amount_cents, 0) <> 0
    THEN
      RAISE EXCEPTION
        'submissions: a new submission must start as an un-dispatched draft'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- ── UPDATE ──────────────────────────────────────────────────────────────────────
  -- Every column outside the allowlist must be byte-identical to the stored row.
  IF (to_jsonb(NEW) - v_allowed) IS DISTINCT FROM (to_jsonb(OLD) - v_allowed) THEN
    RAISE EXCEPTION
      'submissions: column not writable by this role (allowed: %)', array_to_string(v_allowed, ', ')
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION guard_submission_writable_columns() IS
  'P0-2/P0-3 column guard. RLS is row-level only and coach/admin/sponsor share the '
  '`authenticated` role, so neither a policy nor a column GRANT can express this. '
  'Fails closed: new columns are protected until explicitly added to the allowlist.';

DROP TRIGGER IF EXISTS guard_submission_writable_columns ON submissions;
CREATE TRIGGER guard_submission_writable_columns
  BEFORE INSERT OR UPDATE ON submissions
  FOR EACH ROW EXECUTE FUNCTION guard_submission_writable_columns();

-- -------------------------------------------------------------------------------------
-- 3. Second line of defence for the INSERT hole, at the policy layer.
--    saveSubmission inserts with status 'draft' or 'pending' (app/actions/submission.ts:98,
--    :103) and autoSave with 'draft' (:249), so this constrains nothing legitimate.
-- -------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "submissions_insert" ON submissions;
CREATE POLICY "submissions_insert" ON submissions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM teams t
      WHERE t.id = team_id
        AND t.owner_id = current_profile_id()
        AND t.deleted_at IS NULL
    )
    AND is_coach_verified()
    AND status IN ('draft', 'pending')
    AND sent_at IS NULL
  );

-- -------------------------------------------------------------------------------------
-- 4. `submissions_update_coach`'s WITH CHECK never re-asserted team ownership, and
--    `team_id` is coach-writable — so a coach could PATCH their own draft's team_id to
--    ANOTHER team's uuid. USING was evaluated against the OLD row, so the row escaped
--    their ownership entirely: a pitch planted under a victim team, consuming that team's
--    slot in the single-active-submission index and evading the 3-per-7-day counter,
--    which is keyed on team_id (app/actions/submission.ts:70).
-- -------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "submissions_update_coach" ON submissions;
CREATE POLICY "submissions_update_coach" ON submissions FOR UPDATE
  USING (
    deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM teams t WHERE t.id = team_id AND t.owner_id = current_profile_id())
    AND status IN ('draft', 'declined', 'changes_requested')
  )
  WITH CHECK (
    status IN ('draft', 'pending')
    AND EXISTS (SELECT 1 FROM teams t WHERE t.id = team_id AND t.owner_id = current_profile_id())
  );

-- -------------------------------------------------------------------------------------
-- 5. P0-3 — sponsors have no legitimate direct write to submissions.
-- -------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "submissions_update_sponsor" ON submissions;

-- =====================================================================================
-- VERIFICATION (run after applying)
--
-- 1. P0-2. As a coach, save a draft to sponsor X containing the literal 'ZZZ-SECRET'.
--    Sign in as sponsor X:
--      GET /rest/v1/submissions?select=*   -> must NOT contain ZZZ-SECRET
--      /sponsor/submissions                -> must not list it
--    Then have an admin approve it; the sponsor must now see it.
--
-- 2. The §16 bypass. As that coach, against their own draft:
--      PATCH /rest/v1/submissions?id=eq.<id>  {"sent_at":"2026-01-01T00:00:00Z"}
--      -> expect 42501 'column not writable by this role'   (before: 204, silently applied)
--
-- 3. P0-3. As sponsor X, against a dispatched submission addressed to them:
--      PATCH /rest/v1/submissions?id=eq.<id>  {"status":"approved","reserved_amount_cents":0}
--      -> expect 0 rows affected (no policy permits it) and, if one is ever re-added,
--         42501 from the trigger.
--
-- 4. Non-regression, the important one: a coach must still be able to edit and submit a
--    draft (status draft -> pending) and autosave must still work. Both only touch
--    allowlisted columns.
--
--    RUN THIS FIRST on a scratch DB — it is the check that catches a generated column
--    or any other implicitly-changing field being left out of the allowlist:
--      -- as a coach, against your own draft, changing nothing but the text:
--      PATCH /rest/v1/submissions?id=eq.<id>  {"custom_pitch_alignment":"probe"}
--      -- expect 204. A 42501 here means a column outside v_allowed changed by itself.
--      -- then the state transition:
--      PATCH /rest/v1/submissions?id=eq.<id>  {"status":"pending"}
--      -- expect 204 (this is the one is_locked would have broken).
--
-- 5. Admin approve/decline/request-changes must still work (they run as service_role).
--
--    SELECT policyname, cmd, qual, with_check FROM pg_policies
--     WHERE schemaname='public' AND tablename='submissions' ORDER BY policyname;
-- =====================================================================================
