-- 0073_profile_identity_pin_and_active_submission.sql
-- =====================================================================================
-- Two verified P1s from docs/PRE-LAUNCH-QA-REPORT.md §2, both confirmed against the LIVE
-- schema (not inferred from migration files).
--
-- ── P1-27: `profiles_update_own` has no WITH CHECK ───────────────────────────────────
--
--   live: USING (clerk_user_id = auth.jwt() ->> 'sub')   WITH CHECK = (none)
--
-- A USING clause alone only decides which rows you may target. With no WITH CHECK, the
-- row you WRITE is unconstrained, so a user may rewrite any column on their own profile
-- that no trigger defends. `prevent_role_elevation()` (0051) pins `role` and
-- `coach_verified` — and nothing else.
--
-- The sharp one is `sponsor_id`. A legitimate sponsor user can repoint their own
-- `sponsor_id` at ANOTHER company's uuid and inherit that sponsor's pitch inbox, funding
-- cap and decision powers wholesale — `requireSponsor()` reads exactly this column
-- (lib/actions-utils.ts) and every sponsor RLS policy keys off it. That is a lateral
-- takeover of another organisation's account with one PATCH to /rest/v1/profiles.
--
-- `clerk_user_id` is the second: it is the entire identity bridge. Rewriting it points
-- someone else's Clerk session at your profile row.
--
-- Fixed in the existing trigger rather than with WITH CHECK, because WITH CHECK cannot
-- see OLD and so cannot express "this column may not CHANGE" — only "its new value must
-- satisfy X". Extending prevent_role_elevation() also means the service-role escape
-- hatch, the audit trail and the 0072 trusted-context test all stay in one place.
--
-- `email` is deliberately NOT pinned: account settings legitimately updates it, and the
-- Clerk webhook syncs it. It only ever affects the user's own row.
--
-- ── P1-9: the single-active-submission unique index is inert ─────────────────────────
--
--   live: CREATE UNIQUE INDEX idx_single_active_submission_per_season
--           ON submissions (team_id, sponsor_id, season)
--         WHERE status <> ALL(...) AND deleted_at IS NULL
--
-- `submissions.season` is written by NO application code — swept the whole repo; the only
-- `season` writes anywhere are on `team_achievements`. It is therefore always NULL, and
-- in a Postgres unique index NULLs are DISTINCT, so every row is unique on that tuple and
-- the constraint has never once fired. A coach can hold unlimited concurrent live pitches
-- to the same sponsor, each reserving capacity against that sponsor's cap.
--
-- Rebuilt without the season column. Dropping it rather than adding NULLS NOT DISTINCT
-- because the product has no season concept on submissions at all — keeping a column in
-- the key that nothing populates is what disguised the bug for 30-odd migrations.
--
-- APPLY WITH:  supabase db query --linked -f supabase/migrations/0073_profile_identity_pin_and_active_submission.sql
-- Idempotent: CREATE OR REPLACE + DROP INDEX IF EXISTS.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1. Pin the identity columns on profiles.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION prevent_role_elevation()
RETURNS TRIGGER AS $$
BEGIN
  -- Service role / trusted server context (0072). Admin provisioning legitimately moves
  -- sponsor_id, and the Clerk webhook legitimately writes clerk_user_id.
  IF is_trusted_server_context() THEN
    RETURN NEW;
  END IF;

  IF NEW.role <> OLD.role AND NOT is_admin() THEN
    RAISE EXCEPTION 'role elevation not permitted';
  END IF;

  IF NEW.coach_verified <> OLD.coach_verified AND NOT is_admin() THEN
    RAISE EXCEPTION 'coach_verified modification not permitted';
  END IF;

  -- P1-27. `profiles_update_own` has USING but no WITH CHECK, so without these a user
  -- could PATCH their own row and take over another sponsor company, or repoint the
  -- Clerk identity bridge.
  IF NEW.sponsor_id IS DISTINCT FROM OLD.sponsor_id AND NOT is_admin() THEN
    RAISE EXCEPTION 'sponsor_id modification not permitted';
  END IF;

  IF NEW.clerk_user_id IS DISTINCT FROM OLD.clerk_user_id AND NOT is_admin() THEN
    RAISE EXCEPTION 'clerk_user_id modification not permitted';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- -------------------------------------------------------------------------------------
-- 2. Make the single-active-submission constraint actually constrain something.
-- -------------------------------------------------------------------------------------
DROP INDEX IF EXISTS idx_single_active_submission_per_season;

CREATE UNIQUE INDEX IF NOT EXISTS idx_single_active_submission_per_sponsor
  ON submissions (team_id, sponsor_id)
  WHERE status <> ALL (ARRAY['declined'::submission_status,
                             'expired'::submission_status,
                             'bounced'::submission_status])
    AND deleted_at IS NULL;

COMMENT ON INDEX idx_single_active_submission_per_sponsor IS
  'One live pitch per (team, sponsor). Replaces idx_single_active_submission_per_season, '
  'which included submissions.season — a column no application code has ever written, so '
  'it was always NULL and (NULLs being distinct in a unique index) the constraint never '
  'fired (P1-9).';

-- =====================================================================================
-- VERIFICATION (run after applying)
--
--   -- 1. as a real sponsor user, the takeover must now fail:
--   --    PATCH /rest/v1/profiles?id=eq.<self>  {"sponsor_id":"<other company uuid>"}
--   --    -> ERROR: sponsor_id modification not permitted
--
--   -- 2. the index must be keyed on two columns, not three:
--   SELECT indexdef FROM pg_indexes
--    WHERE indexname = 'idx_single_active_submission_per_sponsor';
--
--   -- 3. pre-existing duplicates would block the CREATE. Confirm none exist first:
--   SELECT team_id, sponsor_id, count(*) FROM submissions
--    WHERE deleted_at IS NULL
--      AND status <> ALL (ARRAY['declined','expired','bounced']::submission_status[])
--    GROUP BY 1,2 HAVING count(*) > 1;
--   -- (0 rows on this database: submissions is empty pre-launch)
-- =====================================================================================
