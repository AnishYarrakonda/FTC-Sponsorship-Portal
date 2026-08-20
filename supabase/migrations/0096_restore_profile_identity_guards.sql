-- 0096_restore_profile_identity_guards.sql
--
-- P0. RESTORES TWO GUARDS THAT MIGRATION 0084 SILENTLY DELETED.
--
-- 0073_profile_identity_pin_and_active_submission.sql added two branches to
-- `prevent_role_elevation()` and said exactly why (0073:72-81):
--
--     -- P1-27. `profiles_update_own` has USING but no WITH CHECK, so without these a user
--     -- could PATCH their own row and take over another sponsor company, or repoint the
--     -- Clerk identity bridge.
--     IF NEW.sponsor_id     IS DISTINCT FROM OLD.sponsor_id     AND NOT is_admin() THEN ...
--     IF NEW.clerk_user_id  IS DISTINCT FROM OLD.clerk_user_id  AND NOT is_admin() THEN ...
--
-- 0084 re-issued `CREATE OR REPLACE FUNCTION prevent_role_elevation()` to add the
-- `admin_level` branch, and rebuilt the body from the pre-0073 version. CREATE OR REPLACE
-- overwrites a body wholesale, so both guards vanished from the live function. This is the
-- same trap the migrations already warn about for REVOKE ("replacing a function does not
-- preserve a REVOKE you did not re-issue"), applied to the body instead of the grants.
--
-- REPRODUCED AGAINST PRODUCTION (in a rolled-back transaction) BEFORE WRITING THIS:
--
--   SET LOCAL ROLE authenticated;
--   SET LOCAL request.jwt.claims = '{"sub":"user_attacker_B","role":"authenticated"}';
--   SELECT current_sponsor_ids();                      -->  {…B}
--   UPDATE profiles SET sponsor_id = '<TENANT A>' WHERE clerk_user_id = 'user_attacker_B';
--   UPDATE 1                                           -->  NOT BLOCKED
--   SELECT current_sponsor_ids();                      -->  {…A}
--   SELECT count(*) FROM sponsors WHERE id = '<TENANT A>';  -->  1
--
-- Impact: any sponsor user, with nothing but their own valid Clerk session and the public
-- anon key, could re-scope themselves into another sponsor's tenant. Because
-- `sponsor_ids_for_profile()` keeps the legacy `profiles.sponsor_id` branch as a fallback,
-- rewriting that one column re-points `current_sponsor_ids()` and therefore EVERY
-- sponsor-scoped policy at once: submissions, funding_fulfillments, funding_capacity_releases,
-- sponsor_recognition_awards, recognition_benefit_deliveries, impact_report_snapshots and the
-- Q&A threads. It needs no vulnerable server action — it is reachable straight from PostgREST.
--
-- The `clerk_user_id` half was NOT exploitable, but only by luck: `profiles_update_own` has
-- no explicit WITH CHECK, so Postgres defaults it to the USING clause
-- (`clerk_user_id = auth.jwt()->>'sub'`), which happens to pin that one column. `sponsor_id`
-- is not mentioned there, so nothing constrained it. Relying on that coincidence is why §3
-- below makes the WITH CHECK explicit instead of implicit.
--
-- NOTE ON WHY THE POLICY CANNOT CARRY THIS RULE: a WITH CHECK sees only the NEW row. It
-- cannot express "sponsor_id must equal its previous value". Column immutability is
-- necessarily the trigger's job; the policy can only pin a column to a known constant.
--
-- APPLY WITH:  psql "$DATABASE_URL" -f supabase/migrations/0096_restore_profile_identity_guards.sql
-- Idempotent: CREATE OR REPLACE + DROP/CREATE POLICY.

-- -------------------------------------------------------------------------------------
-- 1. Restore the full guard set.
--
-- This body is 0084's, plus the two branches 0073 added. When you next replace this
-- function, copy THIS body — do not rebuild it from an older migration.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_role_elevation()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- 0072 rule: is_trusted_server_context(), never a raw `sub IS NULL` test.
  -- Server actions write through the service-role client and are unaffected by everything
  -- below; these guards exist for direct PostgREST calls carrying a user's Clerk session.
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

  -- 0073 P1-27, deleted by 0084, restored here. Without this a sponsor user can PATCH their
  -- own row and take over another sponsor company.
  IF NEW.sponsor_id IS DISTINCT FROM OLD.sponsor_id AND NOT is_admin() THEN
    RAISE EXCEPTION 'sponsor_id modification not permitted';
  END IF;

  -- 0073 P1-27, deleted by 0084, restored here. Repointing the Clerk identity bridge.
  IF NEW.clerk_user_id IS DISTINCT FROM OLD.clerk_user_id AND NOT is_admin() THEN
    RAISE EXCEPTION 'clerk_user_id modification not permitted';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.prevent_role_elevation() IS
  'BEFORE UPDATE guard on profiles. Pins role, admin_level, coach_verified, sponsor_id and '
  'clerk_user_id against direct PostgREST writes by the row owner. Early-returns for the '
  'trusted server context. If you CREATE OR REPLACE this function, copy the body from 0096 '
  'or later — rebuilding it from an older migration is how 0084 deleted two of these guards.';

-- -------------------------------------------------------------------------------------
-- 2. Make profiles_update_own's WITH CHECK explicit.
--
-- Behaviourally identical to the implicit default, and that is the point: the clerk_user_id
-- pivot was blocked only because Postgres silently reuses USING as WITH CHECK. Writing it
-- down means a future edit to the USING clause cannot quietly unpin the identity bridge.
-- -------------------------------------------------------------------------------------
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE
  USING      (clerk_user_id = (auth.jwt() ->> 'sub'))
  WITH CHECK (clerk_user_id = (auth.jwt() ->> 'sub'));

-- =====================================================================================
-- VERIFICATION (run after applying)
--
--   -- both guards are back
--   SELECT pg_get_functiondef(oid) LIKE '%sponsor_id modification not permitted%'
--       AND pg_get_functiondef(oid) LIKE '%clerk_user_id modification not permitted%'
--     FROM pg_proc WHERE proname = 'prevent_role_elevation';   -- expect t
--
--   -- and the pivot is refused (expect ERROR, not UPDATE 1)
--   BEGIN;
--     SET LOCAL ROLE authenticated;
--     SET LOCAL request.jwt.claims = '{"sub":"<a real sponsor sub>","role":"authenticated"}';
--     UPDATE profiles SET sponsor_id = '<another sponsor id>' WHERE clerk_user_id = '<that sub>';
--   ROLLBACK;
-- =====================================================================================
