-- 0097 — Two P3 findings from the 11–18 verification sweep (_AUDIT-11-18.md, G-13/G-17).
--
-- Nothing here rewrites a function BODY. That is deliberate: three of this schema's worst
-- defects (0093, 0094, 0096 — the last a cross-tenant takeover) came from a
-- CREATE OR REPLACE built by copying an older migration and silently deleting the fixes
-- that landed in between. This file only DROPs one dead function and REVOKEs privileges.

-- ── G-13. Drop increment_sponsor_funding(uuid, bigint) ───────────────────────
--
-- It is the schema's ONLY SECURITY DEFINER function with no pinned search_path, and it
-- carries a capacity-mutating `UPDATE sponsors`. It is also dead: zero call sites in app
-- code (it survives only in the generated lib/supabase/types.ts), zero triggers, zero
-- pg_depend references, and 0062 already revoked EXECUTE from anon and authenticated.
--
-- Capacity is reserved by approve_submission_atomic and released by
-- release_submission_reservation / 0095 — this predates both and duplicates neither. A
-- dead SECURITY DEFINER writer on the capacity column is a latent cap bypass waiting for
-- someone to re-grant EXECUTE, so it is removed rather than patched with a search_path.
DROP FUNCTION IF EXISTS public.increment_sponsor_funding(uuid, bigint);

-- ── G-17. Revoke EXECUTE on six trigger functions ────────────────────────────
--
-- Not a live hole: Postgres refuses a direct call to a RETURNS TRIGGER function
-- ("trigger functions can only be called as triggers"), and it does NOT check EXECUTE when
-- a trigger fires — only when the trigger is created, which requires table ownership these
-- roles do not have. The grant is inconsistency, not exposure: every other function in the
-- schema is blanket-revoked from anon/authenticated by 0062, and an inconsistent grant map
-- is what makes the next audit miss the one that matters.
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'prevent_role_elevation',
    'guard_submission_writable_columns',
    'guard_payout_profile_writable_columns',
    'prevent_duplicate_team_owner',
    'release_reservation_before_submission_delete',
    'expire_proposals_on_submission_exit'
  ] LOOP
    -- to_regprocedure-free: these are all zero-argument trigger functions, and a name that
    -- no longer exists must not abort a replay of this file.
    IF EXISTS (
      SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = fn
    ) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.%I() FROM PUBLIC, anon, authenticated', fn);
    END IF;
  END LOOP;
END $$;
