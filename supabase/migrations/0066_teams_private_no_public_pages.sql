-- 0066_teams_private_no_public_pages.sql
-- =====================================================================================
-- P0-8: every team portfolio is published to the open web by default, with no opt-out.
--
-- 0046_team_slugs.sql:6 adds `public boolean NOT NULL DEFAULT true`, and 0050 grants
-- SELECT to the `public` role for any row where public = true. Confirmed live: an
-- anonymous request to /rest/v1/teams?select=* returns all 41 columns, including
-- owner_id, budget_items, financial_ask_cents, seed_funding_goals_cents,
-- coach_experience, community_endorsements and past_sponsors.
--
-- There is NO WRITER for teams.public anywhere in the application — re-verified at HEAD,
-- the only occurrences outside the generated types are dev fixtures
-- (lib/dev-coach-preview.ts:95, lib/dev-preview.ts:108). A coach cannot make their
-- portfolio private, because nothing can set the column.
--
-- ── Product decision (2026-08-06): FULLY PRIVATE. No public team pages. ──────────────
-- Team portfolios are no longer an open-web surface at all. The rationale is P0-8(b):
-- subteam_breakdown, community_endorsements, outreach_summary, technical_summary and
-- mission_statement are free-text fields a coach will eventually type a student's name
-- into, and an anonymously-readable URL survives both un-publishing and account
-- deletion. The schema itself is clean (no student-PII column exists; team_members was
-- correctly dropped in 0049) — the exposure is entirely free text and imagery, which is
-- exactly what a schema review misses.
--
-- Sponsor-facing reach is unaffected: it runs through the token-gated
-- /sponsor-view/[token] page, which reads via createAdminClient()
-- (app/sponsor-view/[token]/page.tsx:1,30) and therefore bypasses RLS entirely.
--
-- ── The trap this migration has to avoid ────────────────────────────────────────────
-- 0050's header says its policy exists so that "logged-in Sponsors (authenticated role)"
-- can read team profiles. Dropping it without a replacement would BREAK THE SPONSOR
-- PORTAL: every sponsor page embeds teams(...) through the RLS-respecting server client
-- (getAuthedProfile -> createClient), at
--   app/(sponsor)/sponsor/dashboard/page.tsx:24     .select('*, teams(...)')
--   app/(sponsor)/sponsor/submissions/page.tsx:20   .select('*, teams(...)')
--   app/(sponsor)/sponsor/submissions/[id]/page.tsx:29
--   app/(sponsor)/sponsor/funding/page.tsx:39
-- and `teams_select` (0051:113-115) only admits the owner and admins. Every team name in
-- the sponsor portal would render null. So the anonymous policy is REPLACED with a
-- sponsor-scoped one rather than simply removed.
--
-- APPLY WITH:  psql "$DATABASE_URL" -f supabase/migrations/0066_teams_private_no_public_pages.sql
-- Idempotent. Reversible: see the bottom of this file.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1. New rows are private.
-- -------------------------------------------------------------------------------------
ALTER TABLE teams ALTER COLUMN public SET DEFAULT false;

-- Existing rows: with no public pages there is no reason for any row to stay flagged
-- public, and nothing in the app can flip it back. Row count at audit time: 1.
UPDATE teams SET public = false WHERE public IS DISTINCT FROM false;

COMMENT ON COLUMN teams.public IS
  'Retained for a future opt-in publish toggle. As of 0066 the product has no public '
  'team pages: no RLS policy grants the anon role SELECT on teams, and /teams/[slug] '
  'was removed. Setting this to true alone does NOT publish anything.';

-- -------------------------------------------------------------------------------------
-- 2. Remove the anonymous read surface.
--    Both names are dropped: 0046:29-31 created it and 0050 re-created it under the same
--    name, but drop defensively in case an older name lingers on this database.
-- -------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Public portfolios are readable by anyone" ON teams;
DROP POLICY IF EXISTS "teams_select_public" ON teams;

-- -------------------------------------------------------------------------------------
-- 3. Replace it with sponsor-scoped access: a sponsor may read a team only when that
--    team has a submission addressed to them that CLEARED THE ADMIN GATE.
--    `sent_at IS NOT NULL` is the same marker 0064 uses for submissions_select_sponsor,
--    so the two policies cannot disagree (a sponsor seeing a pitch but not the team, or
--    the reverse).
-- -------------------------------------------------------------------------------------
-- !! The predicate MUST live inside a SECURITY DEFINER function, not inline in the
-- !! policy. Written inline as `EXISTS (SELECT 1 FROM submissions …)` it closes an RLS
-- !! policy CYCLE and Postgres aborts with 42P17 "infinite recursion detected in policy
-- !! for relation ...":
-- !!
-- !!   read teams  -> teams_select_sponsor  -> sublink on submissions
-- !!               -> submissions_select (0051:202-209) -> sublink on teams   -> BOOM
-- !!
-- !! Policy quals are expanded at REWRITE time for every permissive policy on the
-- !! command, regardless of which role is querying, so this fires for coaches and admins
-- !! too — it would have taken down the coach dashboard, the moderation queue, the
-- !! sponsor portal and the funding page simultaneously, on contact.
-- !!
-- !! This did not exist before 0066 because the old `teams_select` (0051:113-115) is
-- !! sublink-free: current_profile_id() and is_admin() are FUNCTION CALLS, which the
-- !! rewriter does not descend into. That opacity is exactly the property relied on here.
-- !!
-- !! SECURITY DEFINER also means the inner read of `submissions` is not itself
-- !! RLS-filtered, so the sponsor scoping in the body is the only thing that matters —
-- !! which is why the body re-asserts it explicitly rather than leaning on a policy.
CREATE OR REPLACE FUNCTION sponsor_can_view_team(p_team_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM submissions s
      JOIN profiles p ON p.id = current_profile_id()
     WHERE s.team_id = p_team_id
       AND p.role = 'sponsor'
       AND p.sponsor_id IS NOT NULL
       AND s.sponsor_id = p.sponsor_id
       AND s.sent_at IS NOT NULL          -- same admin-gate marker as 0064
       AND s.deleted_at IS NULL
  );
$$;

COMMENT ON FUNCTION sponsor_can_view_team(uuid) IS
  'True when the caller is a sponsor holding an admin-dispatched submission from this '
  'team. MUST stay a function: inlining it into an RLS policy closes a teams<->submissions '
  'policy cycle and every read of either table fails 42P17.';

-- Callable by policy evaluation, which runs as the querying role.
GRANT EXECUTE ON FUNCTION sponsor_can_view_team(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "teams_select_sponsor" ON teams;
CREATE POLICY "teams_select_sponsor" ON teams FOR SELECT
  USING (deleted_at IS NULL AND sponsor_can_view_team(id));

-- -------------------------------------------------------------------------------------
-- 4. team_achievements: drop the anonymous branch 0060 added, keep the sponsor branch,
--    and align it with the same sent_at marker.
--    (0060 used `s.status IN ('dispatched','approved','opened','delivered')`. sent_at is
--    equivalent for those states and additionally covers post-dispatch terminal states
--    like declined/expired, matching what submissions_select_sponsor now shows.)
-- -------------------------------------------------------------------------------------
-- Same reasoning: the sponsor branch goes through sponsor_can_view_team() so this policy
-- contributes no submissions sublink of its own. (The outer EXISTS on `teams` is fine —
-- `teams` policies are now sublink-free once the above is a function call.)
DROP POLICY IF EXISTS "achievements_select" ON team_achievements;
CREATE POLICY "achievements_select" ON team_achievements FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM teams t
       WHERE t.id = team_id
         AND (
           t.owner_id = current_profile_id()
           OR is_admin()
           OR sponsor_can_view_team(t.id)
         )
    )
  );

-- =====================================================================================
-- VERIFICATION (run after applying)
--
-- 1. Anonymous, the finding itself:
--      curl "$SUPABASE_URL/rest/v1/teams?select=*" -H "apikey: $ANON_KEY"
--      -> expect []                                        (before: 1 row, 41 columns)
--      curl "$SUPABASE_URL/rest/v1/team_achievements?select=*" -H "apikey: $ANON_KEY"
--      -> expect []
--      curl -sI https://<app>/teams/dev-test-team-99999     -> expect 404 (route removed)
--
-- 1b. THE CYCLE CHECK — run this first, it is what 42P17 would break:
--       SET ROLE authenticated;
--       SELECT count(*) FROM submissions;      -- must return a number, not 42P17
--       SELECT count(*) FROM teams;            -- must return a number, not 42P17
--       SELECT count(*) FROM team_achievements;
--       SELECT count(*) FROM transactions_ledger;
--       RESET ROLE;
--
-- 2. Non-regression, the one that matters most: sign in as a SPONSOR with a dispatched
--    pitch. /sponsor/dashboard, /sponsor/submissions, /sponsor/submissions/[id] and
--    /sponsor/funding must all still show the real team name, not blank. Achievements
--    must still render on the review page.
--
-- 3. A sponsor must NOT see a team whose only submission to them is still a draft
--    (sent_at IS NULL).
--
-- 4. Coach: own portfolio still fully readable and editable. Admin: unchanged.
--
-- 5. Storage buckets are deliberately NOT changed here — see docs/REMEDIATION-LOG.md.
--    pitch-media / visual-pitch-items / pitch-storage remain public=true; making them
--    private requires signed-URL plumbing in the sponsor-view page AND in the outbound
--    emails (where a short-lived signed URL would break on open). Tracked as follow-up.
--
-- ROLLBACK (if the sponsor portal regresses and you need the old behaviour fast):
--   ALTER TABLE teams ALTER COLUMN public SET DEFAULT true;
--   CREATE POLICY "Public portfolios are readable by anyone" ON teams FOR SELECT
--     TO public USING (public = true AND deleted_at IS NULL);
--   -- and re-apply 0060_achievements_visibility.sql
-- =====================================================================================
