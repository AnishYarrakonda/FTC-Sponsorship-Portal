-- 0072_trusted_server_context.sql
-- =====================================================================================
-- Two fail-open guards, both currently unreachable, both held shut only by a SECOND
-- mechanism. Closing them so they stand on their own.
--
-- ── 1. `(auth.jwt() ->> 'sub') IS NULL` is not a service-role test ───────────────────
--
-- Five SECURITY DEFINER functions use the absence of a Clerk `sub` claim to mean
-- "trusted server context, skip the check". That is wrong: **anon is also a JWT**. The
-- Supabase anon key is a signed token carrying `{"role":"anon", ...}` and NO `sub`, so
-- an anonymous PostgREST caller satisfies `(auth.jwt() ->> 'sub') IS NULL` exactly as
-- the service role does.
--
--   caller                       auth.jwt()              ->>'sub'   ->>'role'
--   ---------------------------  ----------------------  ---------  --------------
--   Clerk-authenticated user     {...}                   user_2…    authenticated
--   anon key                     {...}                   NULL       anon        <-- !
--   service_role key             {...}                   NULL       service_role
--   direct postgres / pg_cron    NULL                    NULL       NULL
--
-- What each site would have allowed an anonymous caller to do, had anything admitted
-- anon to the write in the first place:
--
--   0064 guard_submission_writable_columns  skip the ENTIRE column allowlist on
--                                           submissions — the worst of the five
--   0051 prevent_role_elevation             set profiles.role / coach_verified freely
--   0062 approve_submission_atomic          supply its own actor id
--   0065 sponsor_decide_submission_atomic   supply its own actor id
--   0070 remint_submission_access_token     supply its own actor id
--
-- None is reachable today: no RLS policy admits anon to any of those writes, and 0062
-- revoked EXECUTE on all five RPCs from anon and authenticated. This migration removes
-- the dependence on that second mechanism.
--
-- The replacement predicate is a STRICT TIGHTENING of the old one — it keeps every
-- caller the old test trusted except anon. `auth.jwt() IS NULL` (a direct psql/cron
-- connection carries no claims at all) stays trusted deliberately: without it, this
-- migration would break any future data fix or scheduled job run outside PostgREST.
--
-- ── 2. Achievements survive un-verification asymmetrically ───────────────────────────
--
-- `achievements_insert` requires is_coach_verified(); `achievements_delete` and
-- `achievements_update` do not. So a coach whose verification is REVOKED can still wipe
-- or rewrite their team's achievements, but cannot add any back. Made symmetric.
--
-- APPLY WITH:  supabase db query --linked -f supabase/migrations/0072_trusted_server_context.sql
-- Idempotent: CREATE OR REPLACE + a rewrite loop that is a no-op once applied.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1. The helper.
--
-- NOT SECURITY DEFINER and NOT revoked: like is_admin() / current_profile_id(), this is
-- called from inside trigger and RLS contexts that evaluate as the calling role, so
-- revoking EXECUTE from `authenticated` would make every guard raise 42501 (see the
-- warning in 0062 about exactly this).
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_trusted_server_context()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  -- TRUE only for the service_role key, or a connection with no JWT at all
  -- (direct postgres / pg_cron). FALSE for anon and for every Clerk-authenticated user.
  SELECT (auth.jwt() ->> 'sub') IS NULL
     AND (
       auth.jwt() IS NULL
       OR coalesce(auth.jwt() ->> 'role', '') = 'service_role'
     )
$$;

COMMENT ON FUNCTION is_trusted_server_context() IS
  'TRUE for the Supabase service_role key and for direct postgres/cron connections. '
  'Replaces the fail-open test `(auth.jwt() ->> ''sub'') IS NULL`, which was ALSO true '
  'for anon because the anon key is itself a JWT with no sub claim (0072).';

GRANT EXECUTE ON FUNCTION is_trusted_server_context() TO authenticated, anon, service_role;

-- -------------------------------------------------------------------------------------
-- 2. Rewrite the five call sites.
--
-- Done by rewriting pg_get_functiondef() rather than by re-pasting each body. Copying
-- ~15 KB of plpgsql across five functions by hand to change one line each is how a
-- transcription error silently reverts a fix — and 0053 already demonstrated on this
-- database what a silently-not-applied function body costs. This way the body that gets
-- re-created is byte-for-byte the body that is already live, with only the guard swapped.
--
-- is_admin() / is_coach_verified() / current_profile_id() also mention auth.jwt()->>'sub',
-- but as `clerk_user_id = (auth.jwt() ->> 'sub')`, which matches neither pattern and is
-- therefore left alone — correctly, since for them the comparison IS the point.
-- -------------------------------------------------------------------------------------
DO $mig$
DECLARE
  r       record;
  newdef  text;
  n       int := 0;
  touched text[] := '{}';
BEGIN
  -- prokind='f': pg_get_functiondef() raises on aggregates/procedures. It is also kept
  -- out of any WHERE clause on purpose — the planner may evaluate a WHERE-clause call
  -- against pg_catalog rows BEFORE the nspname filter, which errors on array_agg.
  -- In the SELECT list it runs only on rows that already passed the filter.
  FOR r IN
    SELECT p.oid, p.proname::text AS nm, pg_get_functiondef(p.oid) AS def
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.prokind = 'f'
       AND p.proname <> 'is_trusted_server_context'
  LOOP
    newdef := r.def;
    newdef := replace(newdef, '(auth.jwt() ->> ''sub'') IS NOT NULL', 'NOT is_trusted_server_context()');
    newdef := replace(newdef, '(auth.jwt() ->> ''sub'') IS NULL',     'is_trusted_server_context()');

    IF newdef IS DISTINCT FROM r.def THEN
      EXECUTE newdef;
      n := n + 1;
      touched := touched || r.nm;
    END IF;
  END LOOP;

  RAISE NOTICE '0072: rewrote % function(s): %', n, touched;

  -- Fail loudly if the pattern stopped matching (e.g. someone reformatted a body):
  -- silently rewriting nothing is exactly the 0053 failure mode.
  IF n = 0 AND EXISTS (
    SELECT 1 FROM (
      SELECT pg_get_functiondef(p.oid) AS def
        FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
       WHERE ns.nspname = 'public'
         AND p.prokind = 'f'
         AND p.proname <> 'is_trusted_server_context'
       OFFSET 0            -- optimisation fence: keep the LIKE off pg_catalog rows
    ) q WHERE q.def LIKE '%auth.jwt() ->> ''sub'') IS N%'
  ) THEN
    RAISE EXCEPTION '0072: found unconverted `sub IS NULL` guards but rewrote none — pattern drift';
  END IF;
END
$mig$;

-- -------------------------------------------------------------------------------------
-- 3. Achievements: a coach who has been un-verified may no longer mutate achievements.
--    The admin branch is deliberately left unconditional.
-- -------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "achievements_delete" ON team_achievements;
CREATE POLICY "achievements_delete" ON team_achievements FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM teams
       WHERE teams.id = team_achievements.team_id
         AND (
           (teams.owner_id = current_profile_id() AND is_coach_verified())
           OR is_admin()
         )
    )
  );

DROP POLICY IF EXISTS "achievements_update" ON team_achievements;
CREATE POLICY "achievements_update" ON team_achievements FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM teams
       WHERE teams.id = team_achievements.team_id
         AND (
           (teams.owner_id = current_profile_id() AND is_coach_verified())
           OR is_admin()
         )
    )
  );

-- =====================================================================================
-- VERIFICATION (run after applying)
--
--   -- helper truth table (simulate each caller's claims)
--   SELECT is_trusted_server_context();                                   -- no claims -> true
--   SET request.jwt.claims = '{"role":"anon"}';                           -- -> FALSE (was true)
--   SET request.jwt.claims = '{"role":"service_role"}';                   -- -> true
--   SET request.jwt.claims = '{"role":"authenticated","sub":"user_x"}';   -- -> false
--
--   -- no guard left behind
--   SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='public' AND pg_get_functiondef(p.oid) LIKE '%''sub'') IS N%';
--   -- expect 0 rows
--
--   -- end-to-end, with the REAL service-role key (nil submission, real admin id):
--   --   POST /rest/v1/rpc/approve_submission_atomic
--   --   -> {"ok":false,"error":"submission_not_found"}   (reached the body = trusted)
--   --   -> {"ok":false,"error":"forbidden"}              (WRONG - service role misdetected)
-- =====================================================================================
