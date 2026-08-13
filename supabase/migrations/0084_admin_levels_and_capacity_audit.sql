-- 0084_admin_levels_and_capacity_audit.sql
-- =====================================================================================
-- Two independent things, both about trust in the admin seat.
--
-- ── (a) Admin privilege split ────────────────────────────────────────────────────────
--
-- `profiles.role = 'admin'` is currently a single, total privilege: the same account that
-- clears the moderation queue can rewrite sponsors.funding_cap_cents, approve sponsor
-- companies into existence, and export every sponsor contact email. There is no way to
-- hand the review queue to a volunteer without also handing them the money dial.
--
-- This adds `profiles.admin_level` (reviewer | super_admin), `is_super_admin()`, and a
-- DEFERRED constraint trigger guaranteeing at least one super admin survives any
-- transaction. Funding caps, sponsor applications and admin provisioning become
-- super-admin-only at BOTH layers (RLS + the requireSuperAdmin() guard in app code);
-- the moderation queue and coach verification stay open to reviewers.
--
-- `is_admin()` is deliberately UNCHANGED — a reviewer is still an admin.
--
-- ── (b) Capacity-invariant verification ──────────────────────────────────────────────
--
-- The invariant stated in 0047's header and re-stated in 0065's verification block:
--
--   sponsors.funding_used_cents
--     = SUM(submissions.reserved_amount_cents WHERE status IN ('dispatched','delivered','opened'))
--     + SUM(transactions_ledger.amount_cents)
--
-- Nothing in the repo asserts it. `sponsors` has CHECK (funding_used_cents <=
-- funding_cap_cents), which catches only the overflow direction — never under-counting
-- and never a stranded reservation. `detect_capacity_drift()` below is the detector.
--
-- **The reserve/release/settle RPCs are NOT modified by this migration.**
-- `approve_submission_atomic`, `release_submission_reservation`,
-- `expire_overdue_submissions`, `sponsor_decide_submission_atomic` and
-- `release_reservation_before_submission_delete` are untouched. A "fix" to those written
-- from a hunch is how 0053 created the double-debit that 0065 had to undo.
--
-- The ONE money change here is closing a known, documented gap: the token decision path
-- (`record_sponsor_decision_atomic`, 0071) has no `already_decided` ledger guard, so the
-- only thing preventing a double settle across the portal and token paths is the
-- single-use token. It now matches the portal path (0065:141-146).
--
-- APPLY WITH:  psql "$DATABASE_URL" -f supabase/migrations/0084_admin_levels_and_capacity_audit.sql
-- (contains $$-quoted function bodies — the Supabase CLI splitter mishandles those)
-- Idempotent: enum guarded, column IF NOT EXISTS, CREATE OR REPLACE, DROP+CREATE policies.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1. Enum + column
-- -------------------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE admin_level AS ENUM ('reviewer', 'super_admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS admin_level admin_level;

COMMENT ON COLUMN profiles.admin_level IS
  'NULL for non-admins. reviewer = moderation queue + coach verification only. '
  'super_admin = additionally funding caps, sponsor applications, admin provisioning, exports.';

-- Only admins carry a level. Non-admins must be NULL.
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_admin_level_requires_admin;
ALTER TABLE profiles ADD CONSTRAINT profiles_admin_level_requires_admin
  CHECK (admin_level IS NULL OR role = 'admin') NOT VALID;
ALTER TABLE profiles VALIDATE CONSTRAINT profiles_admin_level_requires_admin;

CREATE INDEX IF NOT EXISTS idx_profiles_admin_level
  ON profiles (admin_level) WHERE admin_level IS NOT NULL;

-- -------------------------------------------------------------------------------------
-- 2. Backfill, THEN the floor trigger.
--
-- Order is load-bearing. Every pre-existing admin becomes super_admin — anything else
-- silently strips the funding dial from the only accounts that have it. And the backfill
-- must land BEFORE trg_assert_super_admin_floor exists, or a from-scratch replay (where
-- every admin's admin_level is still NULL) trips the floor on its own backfill.
--
-- The DROP is what makes a re-run safe: on the second apply the UPDATE matches zero rows
-- anyway, but dropping first means we never depend on that.
-- -------------------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_assert_super_admin_floor ON profiles;

UPDATE profiles SET admin_level = 'super_admin'
 WHERE role = 'admin' AND admin_level IS NULL;

-- -------------------------------------------------------------------------------------
-- 3. Helper: is_super_admin()
--
-- Mirrors is_admin() exactly — same language, same volatility, same search_path.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
     WHERE clerk_user_id = (auth.jwt() ->> 'sub')
       AND role = 'admin'
       AND admin_level = 'super_admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

COMMENT ON FUNCTION is_super_admin() IS
  'TRUE when the calling Clerk identity is an admin with admin_level = ''super_admin''. '
  'DELIBERATELY keeps EXECUTE for `authenticated`: it is called from inside RLS policies '
  'that evaluate as the calling role, exactly like is_admin(). Revoking it — as the '
  'blanket SECURITY DEFINER lock-down in _CONTEXT.md §8 rule 4 would otherwise require — '
  'makes every sponsors/sponsor_applications write policy raise 42501. See the same '
  'warning in 0062 and 0072.';

GRANT EXECUTE ON FUNCTION is_super_admin() TO authenticated, anon, service_role;

-- -------------------------------------------------------------------------------------
-- 4. The lockout floor — at least one super admin, enforced by the database.
--
-- CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED is deliberate: it fires at COMMIT,
-- so a transaction that promotes B and demotes A in either order still succeeds, while a
-- transaction that ENDS with zero super admins always fails and rolls back. A plain AFTER
-- trigger would reject the legitimate hand-off.
--
-- AFTER UPDATE OR DELETE only — an INSERT can never reduce the count.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION assert_super_admin_floor()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE role = 'admin' AND admin_level = 'super_admin'
  ) THEN
    -- 23514 (check_violation) is mapped to a human message in app/actions/admin.ts.
    RAISE EXCEPTION 'refusing to leave the platform with zero super admins'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION assert_super_admin_floor() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION assert_super_admin_floor() FROM anon;
REVOKE EXECUTE ON FUNCTION assert_super_admin_floor() FROM authenticated;
GRANT  EXECUTE ON FUNCTION assert_super_admin_floor() TO service_role;

CREATE CONSTRAINT TRIGGER trg_assert_super_admin_floor
  AFTER UPDATE OR DELETE ON profiles
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_super_admin_floor();

-- -------------------------------------------------------------------------------------
-- 5. prevent_role_elevation() — replaced, not extended.
--
-- Two changes, both worth stating plainly:
--
--  1. The raw `(auth.jwt() ->> 'sub') IS NULL` early-return (0051:70-72) becomes
--     is_trusted_server_context(). The old test ALSO passes for the anon key, which is
--     itself a JWT with no `sub` — the fail-open documented in 0072. (0072's rewrite loop
--     already converted the live body; this restates it explicitly so a from-scratch
--     replay and a live database end at the same definition either way.)
--
--  2. `role` and `admin_level` now require a SUPER admin. `coach_verified` still only
--     requires is_admin(), so reviewers keep working the coach queue.
--
--     Nothing legitimate regresses from (1): anon has no policy permitting a profiles
--     UPDATE, so the branch was unreachable in the first place.
--
-- HONEST LIMITATION — do not present this trigger as the primary control. Every server
-- action writes through the service-role admin client, which carries no Clerk `sub`, so
-- is_trusted_server_context() is TRUE and this trigger early-returns for all of them.
-- It is defence-in-depth against a direct PostgREST call. The REAL gate for server
-- actions is requireSuperAdmin() in lib/actions-utils.ts.
--
-- IS DISTINCT FROM replaces `<>`: the original raised nothing when a nullable column
-- moved to or from NULL.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION prevent_role_elevation()
RETURNS TRIGGER AS $$
BEGIN
  -- 0072 rule: is_trusted_server_context(), never a raw `sub IS NULL` test.
  IF is_trusted_server_context() THEN RETURN NEW; END IF;

  IF NEW.role IS DISTINCT FROM OLD.role AND NOT is_super_admin() THEN
    RAISE EXCEPTION 'role change requires a super admin';
  END IF;
  IF NEW.admin_level IS DISTINCT FROM OLD.admin_level AND NOT is_super_admin() THEN
    RAISE EXCEPTION 'admin_level change requires a super admin';
  END IF;
  IF NEW.coach_verified IS DISTINCT FROM OLD.coach_verified AND NOT is_admin() THEN
    RAISE EXCEPTION 'coach_verified modification not permitted';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- -------------------------------------------------------------------------------------
-- 6. RLS: the writes that move money or mint sponsor companies become super-admin-only.
--
-- Policy names verified against 0001_init.sql:440-460 (sponsors) and :552-570
-- (sponsor_applications); 0051:198 confirms the sponsors write policies were never
-- rewritten by the Clerk migration because they only ever called is_admin().
--
-- The admin SELECT on sponsor_applications stays at is_admin() so a reviewer can still
-- see the pipeline. profiles_update_admin also stays at is_admin() — narrowing it would
-- stop reviewers writing coach_verified, and `role`/`admin_level` are a COLUMN rule,
-- which is prevent_role_elevation()'s job, not RLS's (RLS is row-level only; same
-- reasoning as 0064_submissions_policy_hardening.sql:182-185).
--
-- Left unchanged on purpose (reviewers need them): sponsors_select, sponsors_select_own,
-- sponsors_select_coach, profiles_select, submissions_*, teams_*, team_achievements_*,
-- notifications_*, audit_log read, transactions_ledger read (0069).
-- -------------------------------------------------------------------------------------

-- Creating a sponsor company sets a funding cap.
DROP POLICY IF EXISTS "sponsors_insert" ON sponsors;
CREATE POLICY "sponsors_insert" ON sponsors FOR INSERT
  WITH CHECK (is_super_admin());

-- THE funding-cap write.
DROP POLICY IF EXISTS "sponsors_update" ON sponsors;
CREATE POLICY "sponsors_update" ON sponsors FOR UPDATE
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "sponsors_delete" ON sponsors;
CREATE POLICY "sponsors_delete" ON sponsors FOR DELETE
  USING (is_super_admin());

-- Approving an application creates a capped sponsor company; rejecting closes it.
DROP POLICY IF EXISTS "sponsor_apps_update_admin" ON sponsor_applications;
CREATE POLICY "sponsor_apps_update_admin" ON sponsor_applications FOR UPDATE
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "sponsor_apps_delete_admin" ON sponsor_applications;
CREATE POLICY "sponsor_apps_delete_admin" ON sponsor_applications FOR DELETE
  USING (is_super_admin());

-- -------------------------------------------------------------------------------------
-- 7. Token-path `already_decided` parity.
--
-- Body is 0071's, byte-identical, with ONE addition: the same ledger guard 0065 uses at
-- lines 141-146, placed after the status check and BEFORE the token claim — so a sponsor
-- who opens an already-settled pitch keeps a live link, which is the whole point of 0071.
--
-- `already_decided` is already mapped to a user-facing string in
-- app/actions/sponsor-decision.ts, so no client change is needed.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION record_sponsor_decision_atomic(
  p_token_hash text,
  p_decision text,                          -- 'full' | 'partial' | 'decline'
  p_partial_amount_cents bigint DEFAULT 0
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_token_id      uuid;
  v_submission_id uuid;
  v_submission    submissions%ROWTYPE;
  v_reserved      bigint;
  v_amount        bigint;
  v_decision_type text;
BEGIN
  -- 1. RESOLVE the token without consuming it.
  SELECT id, submission_id INTO v_token_id, v_submission_id
    FROM submission_access_tokens
   WHERE token_hash = p_token_hash
     AND used_at IS NULL
     AND revoked_at IS NULL
     AND expires_at > now();

  IF v_token_id IS NULL THEN
    PERFORM 1 FROM submission_access_tokens WHERE token_hash = p_token_hash;
    IF FOUND THEN RETURN json_build_object('ok', false, 'error', 'token_used'); END IF;
    RETURN json_build_object('ok', false, 'error', 'invalid_token');
  END IF;

  -- 2. VALIDATE the submission BEFORE burning anything. This is the whole fix: a sponsor
  --    who arrives at a pitch that has already moved on now keeps a usable link.
  SELECT * INTO v_submission FROM submissions WHERE id = v_submission_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'submission_not_found');
  END IF;
  IF v_submission.status NOT IN ('dispatched', 'delivered', 'opened') THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_status',
                             'current_status', v_submission.status);
  END IF;

  -- 2b. (0084) Defence in depth against double-settle across the token + portal paths,
  --     matching sponsor_decide_submission_atomic (0065:141-146). Before the claim, so
  --     the link survives — the token was NOT the wrong guard, it was the only guard.
  IF EXISTS (
    SELECT 1 FROM transactions_ledger tl
     WHERE tl.submission_id = v_submission_id AND tl.actor_type = 'sponsor'
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'already_decided');
  END IF;

  -- 3. CLAIM the token. Still a single conditional UPDATE, so of two concurrent callers
  --    exactly one matches a row; the loser sees zero rows and stops here.
  UPDATE submission_access_tokens
     SET used_at = now()
   WHERE id = v_token_id
     AND used_at IS NULL
     AND revoked_at IS NULL;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'token_used');
  END IF;

  v_reserved := COALESCE(v_submission.reserved_amount_cents, 0);

  IF p_decision = 'decline' THEN
    PERFORM release_submission_reservation(v_submission_id, 'declined', 'sponsor_decline');
    RETURN json_build_object('ok', true);
  END IF;

  -- SETTLE. Funds are already reserved, so we never debit again; clamp partial to the
  -- reserved amount (a sponsor cannot fund more than the reserved ask).
  IF p_decision = 'partial' AND p_partial_amount_cents > 0 AND p_partial_amount_cents < v_reserved THEN
    v_amount := p_partial_amount_cents;
    v_decision_type := 'partial';
  ELSE
    v_amount := v_reserved;
    v_decision_type := 'full';
  END IF;

  IF v_amount <= 0 THEN
    RETURN json_build_object('ok', false, 'error', 'amount_required');
  END IF;

  -- Release the unfunded difference on a partial settlement.
  IF v_amount < v_reserved THEN
    UPDATE sponsors
       SET funding_used_cents = GREATEST(funding_used_cents - (v_reserved - v_amount), 0),
           status = CASE WHEN status = 'inactive'
                          AND (funding_used_cents - (v_reserved - v_amount)) < funding_cap_cents
                         THEN 'active'::sponsor_status ELSE status END
     WHERE id = v_submission.sponsor_id;
  END IF;

  UPDATE submissions
     SET status = 'approved', reviewed_at = now(), reserved_amount_cents = v_amount
   WHERE id = v_submission_id;

  INSERT INTO transactions_ledger (sponsor_id, team_id, submission_id, amount_cents, decision_type, actor_type)
  VALUES (v_submission.sponsor_id, v_submission.team_id, v_submission_id, v_amount, v_decision_type, 'sponsor');

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata)
  VALUES (NULL, 'sponsor_accept', 'submissions', v_submission_id,
          jsonb_build_object('sponsor_id', v_submission.sponsor_id, 'amount_cents', v_amount,
                             'decision_type', v_decision_type));

  RETURN json_build_object('ok', true, 'amount_cents', v_amount);
END;
$$;

-- Re-apply 0071:136-139 verbatim — CREATE OR REPLACE preserves grants, but this file may
-- be applied on its own against a database that never saw 0071.
REVOKE EXECUTE ON FUNCTION record_sponsor_decision_atomic(text, text, bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION record_sponsor_decision_atomic(text, text, bigint) FROM anon;
REVOKE EXECUTE ON FUNCTION record_sponsor_decision_atomic(text, text, bigint) FROM authenticated;
GRANT  EXECUTE ON FUNCTION record_sponsor_decision_atomic(text, text, bigint) TO service_role;

-- -------------------------------------------------------------------------------------
-- 8. detect_capacity_drift() — the invariant, as a query.
--
-- Zero rows in a healthy system.
--   drift_cents > 0  the sponsor's cap is under-served: money is held that nothing
--                    accounts for (a stranded reservation).
--   drift_cents < 0  the books under-count and the cap can be overrun.
--
-- DELIBERATE OMISSION: this does NOT filter submissions.deleted_at. A soft-deleted row in
-- an awaiting-sponsor state still holds its reservation and must still count. Adding
-- `deleted_at IS NULL` would make the detector agree with a bug instead of finding it.
--
-- Every column reference is table-qualified on purpose: for a LANGUAGE sql function the
-- RETURNS TABLE column names are in scope as parameters and would otherwise shadow
-- submissions.sponsor_id / transactions_ledger.sponsor_id.
-- -------------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS detect_capacity_drift();
CREATE FUNCTION detect_capacity_drift()
RETURNS TABLE (
  sponsor_id uuid,
  company_name text,
  funding_cap_cents bigint,
  funding_used_cents bigint,
  open_reservations_cents bigint,
  settled_ledger_cents bigint,
  expected_used_cents bigint,
  drift_cents bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT s.id, s.company_name, s.funding_cap_cents, s.funding_used_cents,
         r.open_cents, l.settled_cents,
         r.open_cents + l.settled_cents AS expected_used_cents,
         s.funding_used_cents - (r.open_cents + l.settled_cents) AS drift_cents
    FROM sponsors s
    CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(sub.reserved_amount_cents), 0)::bigint AS open_cents
        FROM submissions sub
       WHERE sub.sponsor_id = s.id
         AND sub.status IN ('dispatched', 'delivered', 'opened')
    ) r
    CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(tl.amount_cents), 0)::bigint AS settled_cents
        FROM transactions_ledger tl
       WHERE tl.sponsor_id = s.id
    ) l
   WHERE s.funding_used_cents <> r.open_cents + l.settled_cents;
$$;

COMMENT ON FUNCTION detect_capacity_drift() IS
  'Read-only detector for violations of the capacity invariant (0047 header, 0065 '
  'verification block): funding_used_cents = open reservations + settled ledger. Returns '
  'one row per drifting sponsor, zero rows when healthy. Reports only — never repairs; '
  'silent repair would erase the evidence of whatever caused the drift.';

REVOKE EXECUTE ON FUNCTION detect_capacity_drift() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION detect_capacity_drift() FROM anon;
REVOKE EXECUTE ON FUNCTION detect_capacity_drift() FROM authenticated;
GRANT  EXECUTE ON FUNCTION detect_capacity_drift() TO service_role;

-- =====================================================================================
-- VERIFICATION (run after applying)
--
--   -- every pre-existing admin is a super admin
--   SELECT role, admin_level, count(*) FROM profiles GROUP BY 1,2;
--
--   -- the floor holds (expect: ERROR 23514, transaction rolled back)
--   BEGIN; UPDATE profiles SET admin_level='reviewer' WHERE role='admin'; COMMIT;
--
--   -- the hand-off still works (expect: COMMIT)
--   BEGIN;
--     UPDATE profiles SET admin_level='super_admin' WHERE id = '<B>';
--     UPDATE profiles SET admin_level='reviewer'    WHERE id = '<A>';
--   COMMIT;
--
--   -- no policy left on is_admin() for a sponsors write
--   SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies
--    WHERE schemaname='public' AND tablename IN ('sponsors','sponsor_applications')
--    ORDER BY tablename, policyname;
--
--   -- clean database: zero rows
--   SELECT * FROM detect_capacity_drift();
--
--   -- token parity: settle in the portal, then call the token RPC with a LIVE token
--   -- -> {"ok":false,"error":"already_decided"} AND used_at still NULL for that token.
--
--   Full seven-scenario proof: npm run verify:capacity  (SUPABASE_LOCAL=1 required)
-- =====================================================================================
