-- 0060_achievements_visibility.sql
-- =====================================================================================
-- Live E2E caught achievements invisible to exactly the audiences the portfolio
-- redesign targets: achievements_select (0051) only allowed the owning coach and
-- admins, so (a) anonymous visitors to PUBLIC team portfolios and (b) sponsors
-- reviewing a dispatched pitch both saw "No achievements listed."
-- New read rule: owner, admin, anyone for public non-deleted teams, and sponsors
-- with a live submission from that team. Write policies unchanged (owner-only).
-- No student PII lives in team_achievements (season/event/award/description).
-- =====================================================================================

DROP POLICY IF EXISTS "achievements_select" ON team_achievements;
CREATE POLICY "achievements_select" ON team_achievements FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM teams t
      WHERE t.id = team_id
        AND (
          t.owner_id = current_profile_id()
          OR is_admin()
          OR (t.public = true AND t.deleted_at IS NULL)
          OR EXISTS (
            SELECT 1
            FROM submissions s
            JOIN profiles p ON p.clerk_user_id = auth.jwt()->>'sub'
            WHERE s.team_id = t.id
              AND p.sponsor_id IS NOT NULL
              AND s.sponsor_id = p.sponsor_id
              AND s.status IN ('dispatched', 'approved', 'opened', 'delivered')
          )
        )
    )
  );
