-- 0102_teams_update_requires_verified_coach.sql
-- B-01-3 (P1): teams_insert required is_coach_verified(), teams_update did not.
--
-- The asymmetry meant a coach who created a team while verified, and whose verification
-- was later revoked by an admin, kept full write access to the portfolio — which is the
-- precise surface revoking verification is meant to shut off. The server action half was
-- also only requireAuth(); both halves are now closed (app/actions/team.ts).
--
-- The admin branch is preserved verbatim: admins must still be able to correct or
-- moderate a team regardless of the owner's verification state, and admins are not
-- coaches so is_coach_verified() would be false for them.
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE POLICY.

DROP POLICY IF EXISTS teams_update ON public.teams;

CREATE POLICY teams_update ON public.teams
  FOR UPDATE
  USING (
    ((owner_id = current_profile_id()) AND (deleted_at IS NULL) AND is_coach_verified())
    OR is_admin()
  )
  WITH CHECK (
    ((owner_id = current_profile_id()) AND is_coach_verified())
    OR is_admin()
  );
