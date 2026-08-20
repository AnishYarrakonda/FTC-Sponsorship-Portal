-- 0085_submission_qa_thread.sql
-- =====================================================================================
-- Admin-moderated sponsor <-> coach Q&A thread on a live pitch.
--
-- WHY THIS EXISTS
-- A pitch is one-shot today: approve_submission_atomic dispatches it, the sponsor gets a
-- 14-day link, and the only inputs the system accepts back are fund-in-full, fund-partially
-- or decline. A sponsor with one question ("is the 501(c)(3) the district or a booster
-- club?") has nowhere to ask it, so they decline — the cheap, safe, reversible-looking
-- option, which costs the coach the reservation and the slot.
--
-- ASYMMETRIC MODERATION (the shape of everything below)
--   sponsor -> coach   inserts at status='released'. The sponsor already holds an
--                      admin-approved pitch and is the party initiating contact, so their
--                      question is neither new outreach nor a student-PII risk.
--   coach   -> sponsor inserts at status='pending' and is invisible to the sponsor until
--                      an admin releases it. This is new material travelling toward a
--                      sponsor — exactly what Core Mandate 2 gates — and the coach is the
--                      only party who HAS student information to leak (COPPA).
--
-- The coach direction being human-read before it ships is the actual COPPA control. There
-- is deliberately no PII classifier: a heuristic would be noisy, would be trusted more than
-- it deserves, and would let the admin review decay into rubber-stamping whatever the
-- machine passed.
--
-- APPLY WITH:  psql "$DATABASE_URL" -f supabase/migrations/0085_submission_qa_thread.sql
-- (defines $$-quoted functions — must not go through the Supabase CLI statement splitter)
-- Idempotent: IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS throughout.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1. Table
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS submission_messages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- DEFERRABLE INITIALLY DEFERRED is load-bearing, not decoration. See the note under
  -- "Cascade ordering" below before changing it.
  submission_id     uuid NOT NULL REFERENCES submissions(id) ON DELETE CASCADE
                      DEFERRABLE INITIALLY DEFERRED,

  -- Attribution: exactly one of these is set at INSERT (see guard_submission_message_insert).
  -- A token-path sponsor has no profiles row at all, which is why author_profile_id cannot
  -- be NOT NULL. Both MAY become NULL later via ON DELETE SET NULL; author_role and
  -- author_label keep the row legible, which is why they are NOT NULL and why the
  -- exactly-one rule is a trigger rather than a table CHECK — a CHECK is re-evaluated when
  -- a referential action nulls the column, so deleting a Clerk account would fail the
  -- constraint and abort the cascade. Account deletion runs NO app code; that is the exact
  -- class of breakage 0067_release_reservation_on_submission_delete.sql exists to handle.
  author_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  author_token_id   uuid REFERENCES submission_access_tokens(id) ON DELETE SET NULL,
  author_role       user_role NOT NULL,
  author_label      text NOT NULL,

  body              text NOT NULL,

  status            text NOT NULL DEFAULT 'pending',

  -- Reviewer stamp. DECISION: these are reused for BOTH release and reject rather than
  -- adding a second reviewed_by/reviewed_at pair. A rejected row stays unambiguous because
  -- rejected_reason is CHECK-required exactly when status='rejected'.
  released_by       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  released_at       timestamptz,
  rejected_reason   text,

  -- The coach's report on a sponsor message. The sponsor->coach direction is the one that
  -- is NOT pre-moderated, and the realistic failure there is a sponsor *asking* for student
  -- details. Reporting flags the row and alerts admins; it deliberately does not change
  -- status, because the message already landed and hiding it retroactively would be theatre.
  flagged_at        timestamptz,
  flagged_by        uuid REFERENCES profiles(id) ON DELETE SET NULL,

  created_at        timestamptz NOT NULL DEFAULT now(),

  -- text + CHECK rather than a new enum, matching the notifications.type idiom
  -- (0023_admin_fixes.sql:30-40) — the house pattern for a small, mutable value set.
  CONSTRAINT submission_messages_status_check
    CHECK (status IN ('pending', 'released', 'rejected')),
  -- Reuses the existing user_role enum, narrowed. Do not create a new type.
  CONSTRAINT submission_messages_author_role_check
    CHECK (author_role IN ('coach', 'sponsor')),
  CONSTRAINT submission_messages_rejected_needs_reason
    CHECK (status <> 'rejected' OR nullif(btrim(rejected_reason), '') IS NOT NULL)
);

-- -------------------------------------------------------------------------------------
-- 1b. Cascade ordering — why submission_id is DEFERRABLE INITIALLY DEFERRED
--
-- Deleting a coach's Clerk account fires TWO referential actions against this table at
-- once, and they fight:
--
--   profiles -> submission_messages.author_profile_id        ON DELETE SET NULL
--   profiles -> teams -> submissions -> submission_messages  ON DELETE CASCADE
--
-- Postgres applies the SET NULL as an UPDATE, and that UPDATE re-checks every FK on the
-- row it touches — including submission_id, whose parent submission the cascade has
-- already removed. The delete then aborts with:
--
--   ERROR: insert or update on table "submission_messages" violates foreign key
--          constraint "submission_messages_submission_id_fkey"
--
-- Account deletion runs NO app code (it arrives via the Clerk user.deleted webhook), so an
-- error here does not degrade gracefully — it fails the whole deletion. Deferring the
-- constraint moves the re-check to COMMIT, by which point the row has been cascade-deleted
-- and there is nothing left to validate. Verified against a live cascade: the account
-- deletes, the submission goes, and the thread goes with it.
--
-- This is the same hazard class 0067_release_reservation_on_submission_delete.sql exists to
-- handle, and the reason the exactly-one-attribution rule below is a TRIGGER and not a
-- table CHECK (a CHECK would be re-evaluated by that same SET NULL update and fail closed).
-- -------------------------------------------------------------------------------------
DO $cascade$
BEGIN
  -- Repairs a database where an earlier revision of this file created the constraint as
  -- NOT DEFERRABLE. No-op once it is already correct, so replay stays idempotent.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'submission_messages_submission_id_fkey'
       AND conrelid = 'submission_messages'::regclass
       AND NOT condeferrable
  ) THEN
    ALTER TABLE submission_messages DROP CONSTRAINT submission_messages_submission_id_fkey;
    ALTER TABLE submission_messages ADD CONSTRAINT submission_messages_submission_id_fkey
      FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END
$cascade$;

COMMENT ON TABLE submission_messages IS
  'Admin-moderated Q&A between one sponsor contact and one adult coach, scoped to a single '
  'live submission. Sponsor messages post released; coach messages wait for admin release. '
  'Plain text only — no attachments, no HTML, no upload path (COPPA).';

CREATE INDEX IF NOT EXISTS idx_submission_messages_submission
  ON submission_messages (submission_id, created_at);
-- What the admin release queue and the sidebar badge count read.
CREATE INDEX IF NOT EXISTS idx_submission_messages_pending
  ON submission_messages (created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_submission_messages_flagged
  ON submission_messages (flagged_at) WHERE flagged_at IS NOT NULL;

-- -------------------------------------------------------------------------------------
-- 2. Predicate helpers
--
--    Anything reading submissions/teams from inside a policy goes through a SECURITY
--    DEFINER function or you get 42P17 policy recursion (0066). sponsor_can_view_team()
--    exists for exactly this reason; these follow that precedent.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION coach_owns_submission(p_submission_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM submissions s
      JOIN teams t ON t.id = s.team_id
     WHERE s.id = p_submission_id
       AND s.deleted_at IS NULL
       AND t.owner_id = current_profile_id()
  );
$$;

-- current_sponsor_ids() rather than a direct profiles.sponsor_id comparison. 0082 made that
-- function the single sponsor-resolution primitive and repointed every prior object at it
-- (sponsors_select_own, submissions_select_sponsor, ledger_select_sponsor,
-- sponsor_can_view_team). It UNIONs sponsor_members with profiles.sponsor_id, so it also
-- covers a legacy sponsor with no membership row.
--
-- Comparing profiles.sponsor_id here instead would not leak — it resolves to a strict
-- SUBSET — but it would silently break the multi-user org model 0082/0083 added: an org
-- teammate linked only through sponsor_members passes submissions_select_sponsor and sees
-- the proposal, then gets an EMPTY thread, including the question they just posted
-- themselves. Keep these two predicates resolving sponsors the same way.
CREATE OR REPLACE FUNCTION sponsor_owns_submission(p_submission_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM submissions s
     WHERE s.id = p_submission_id
       AND s.deleted_at IS NULL
       AND s.sent_at IS NOT NULL          -- cleared the admin gate; mirrors 0064:55-66
       AND s.sponsor_id = ANY (current_sponsor_ids())
  );
$$;

-- sent_at IS NOT NULL above is deliberate and must not be dropped: it is the same
-- admin-gate marker submissions_select_sponsor uses. Without it a sponsor could read a
-- thread on a draft, which is P0-2 all over again.
-- (current_sponsor_ids() already gates on role='sponsor', so the old inline role check
-- is redundant, not missing.)

-- !! GRANTS EXCEPTION — READ BEFORE ANY FUTURE LOCK-DOWN SWEEP !!
-- These two functions are called BY THE RLS POLICIES BELOW, which execute as the
-- `authenticated` role. Revoking EXECUTE from `authenticated` (the standard treatment for
-- a new SECURITY DEFINER function, _CONTEXT.md §8 rule 4) would break every thread read for
-- every coach and sponsor. They therefore KEEP `authenticated` EXECUTE, the same documented
-- exception is_super_admin() carries in 0084. Both are STABLE, take a single uuid, and leak
-- nothing beyond a boolean about a row the caller is asking about anyway.
--
-- `anon` KEEPS EXECUTE TOO, and that is deliberate — it was tried the other way first.
-- A policy helper is evaluated for EVERY role the policy applies to, anon included. Revoke
-- it from anon and an anonymous `SELECT * FROM submission_messages` stops returning zero
-- rows and starts raising:
--
--   ERROR: permission denied for function sponsor_owns_submission
--
-- i.e. RLS raises instead of filtering, and a public page reading this table with the anon
-- key would 500 rather than render empty. This is why every existing policy helper in the
-- schema — current_profile_id(), is_admin(), is_coach_verified(), sponsor_can_view_team() —
-- also keeps anon EXECUTE. Nothing leaks: current_profile_id() is NULL for anon, so both
-- functions return false for every input, which is exactly the empty result set we want.
--
-- Rule 4's REVOKE-from-everything treatment still applies in full to
-- guard_submission_message_insert() below, which is NOT a policy helper.
GRANT EXECUTE ON FUNCTION coach_owns_submission(uuid)   TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION sponsor_owns_submission(uuid) TO anon, authenticated, service_role;

-- -------------------------------------------------------------------------------------
-- 3. RLS — three SELECT policies, and deliberately NO write policy at all.
--
--    Every write goes through a server action on the admin client, the same shape
--    transactions_ledger uses (0069:14-15). Because the admin client bypasses RLS, each
--    action re-verifies ownership itself before it writes — that discipline is restated at
--    the top of app/actions/messages.ts.
--
--    Consequence worth stating: released_by / released_at / rejected_reason / flagged_* have
--    no client-writable path whatsoever.
-- -------------------------------------------------------------------------------------
ALTER TABLE submission_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sm_select_admin" ON submission_messages;
CREATE POLICY "sm_select_admin" ON submission_messages FOR SELECT
  USING (is_admin());

-- The coach sees every message they wrote (any status, so they can see "awaiting review"
-- and "rejected" and rewrite), plus counterparty messages only once RELEASED.
DROP POLICY IF EXISTS "sm_select_coach" ON submission_messages;
CREATE POLICY "sm_select_coach" ON submission_messages FOR SELECT
  USING (
    coach_owns_submission(submission_id)
    AND (author_role = 'coach' OR status = 'released')
  );

DROP POLICY IF EXISTS "sm_select_sponsor" ON submission_messages;
CREATE POLICY "sm_select_sponsor" ON submission_messages FOR SELECT
  USING (
    sponsor_owns_submission(submission_id)
    AND (author_role = 'sponsor' OR status = 'released')
  );

-- Mirroring the note at 0069:33-36: these policies sublink into submissions and profiles
-- ONLY through the two SECURITY DEFINER helpers above, so they are insulated from the
-- 42P17 hazard 0066 created rules about. Do not inline the helper bodies into the policies.

-- -------------------------------------------------------------------------------------
-- 4. Write guard
--
--    Rules 3 and 4 are the Admin-Gatekept-Outreach and expiry enforcement at the layer no
--    write path can skip — including the service-role admin client, which is what the
--    actions use. RETURN NEW unconditionally at the end: there is no trusted-context escape
--    hatch here, and that is intentional.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_submission_message_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_sub   submissions%ROWTYPE;
  v_count int;
BEGIN
  -- 1. Exactly one attribution source, and only a sponsor may be token-attributed.
  IF (NEW.author_profile_id IS NULL) = (NEW.author_token_id IS NULL) THEN
    RAISE EXCEPTION 'submission_messages: exactly one of author_profile_id / author_token_id is required'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.author_token_id IS NOT NULL AND NEW.author_role <> 'sponsor' THEN
    RAISE EXCEPTION 'submission_messages: token attribution is sponsor-only'
      USING ERRCODE = '23514';
  END IF;

  -- 1b. The attributed party must actually be a party to THIS thread.
  --
  -- Every writer is the service-role admin client, so this trigger is the only layer that
  -- cannot be skipped. Without these two checks the DB would happily accept a token minted
  -- for submission A alongside submission B's id — posting sponsor A's question into
  -- sponsor B's thread at status='released'. No current code path does that; the point is
  -- that a future one cannot.
  IF NEW.author_token_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM submission_access_tokens t
     WHERE t.id = NEW.author_token_id AND t.submission_id = NEW.submission_id
  ) THEN
    RAISE EXCEPTION 'submission_messages: that access token belongs to a different submission'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.author_role = 'coach' AND NEW.author_profile_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM submissions s
      JOIN teams tm ON tm.id = s.team_id
     WHERE s.id = NEW.submission_id AND tm.owner_id = NEW.author_profile_id
  ) THEN
    RAISE EXCEPTION 'submission_messages: only the owning coach may write on this thread'
      USING ERRCODE = '23514';
  END IF;

  -- 2. Asymmetric moderation is a DB rule, not just an app rule.
  IF NEW.author_role = 'coach' AND NEW.status <> 'pending' THEN
    RAISE EXCEPTION 'submission_messages: a coach message must enter review as pending'
      USING ERRCODE = '23514';
  END IF;

  -- 3. The pitch must be genuinely live. The status list duplicates
  --    AWAITING_SPONSOR_STATUSES (lib/submission-status.ts:21) because SQL cannot import
  --    it — the same duplication 0047/0065/0071 already accept (see 0071:70).
  SELECT * INTO v_sub FROM submissions WHERE id = NEW.submission_id;
  IF NOT FOUND OR v_sub.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'submission_messages: submission not found' USING ERRCODE = '23503';
  END IF;
  IF v_sub.status NOT IN ('dispatched', 'delivered', 'opened') THEN
    RAISE EXCEPTION 'submission_messages: this pitch is no longer open for questions'
      USING ERRCODE = '23514';
  END IF;
  IF v_sub.expires_at IS NOT NULL AND v_sub.expires_at <= now() THEN
    RAISE EXCEPTION 'submission_messages: the 14-day window for this pitch has closed'
      USING ERRCODE = '23514';
  END IF;

  -- 4. A coach can never open a thread. Without this, a coach could paste their whole pitch
  --    into a "reply" and the platform would carry it to a sponsor — dispatch, laundered.
  IF NEW.author_role = 'coach' AND NOT EXISTS (
    SELECT 1 FROM submission_messages m
     WHERE m.submission_id = NEW.submission_id AND m.author_role = 'sponsor'
  ) THEN
    RAISE EXCEPTION 'submission_messages: only the sponsor can open a thread'
      USING ERRCODE = '23514';
  END IF;

  -- 5. Hard per-thread cap. check_throttle limits rate; this limits total volume.
  SELECT count(*) INTO v_count FROM submission_messages WHERE submission_id = NEW.submission_id;
  IF v_count >= 50 THEN
    RAISE EXCEPTION 'submission_messages: this thread has reached its message limit'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_submission_message ON submission_messages;
CREATE TRIGGER trg_guard_submission_message
  BEFORE INSERT ON submission_messages
  FOR EACH ROW EXECUTE FUNCTION guard_submission_message_insert();

-- Standard treatment per _CONTEXT.md §8 rule 4. Postgres does NOT check EXECUTE on a
-- trigger function when the trigger fires, so this only removes direct PostgREST
-- callability — the trigger keeps working for every writer.
REVOKE EXECUTE ON FUNCTION guard_submission_message_insert() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION guard_submission_message_insert() FROM anon;
REVOKE EXECUTE ON FUNCTION guard_submission_message_insert() FROM authenticated;
GRANT  EXECUTE ON FUNCTION guard_submission_message_insert() TO service_role;

-- -------------------------------------------------------------------------------------
-- 5. submissions is UNTOUCHED
--
--    This slice adds no column to submissions, so guard_submission_writable_columns()
--    (0064:81-190) needs no allowlist change. Noted because _CONTEXT.md §8 rule 7 makes
--    that the first thing to check and it is easy to over-apply. If a future change wants a
--    submissions.last_message_at denormalisation: don't. Derive it from submission_messages.
-- -------------------------------------------------------------------------------------
