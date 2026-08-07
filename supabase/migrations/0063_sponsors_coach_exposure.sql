-- 0063_sponsors_coach_exposure.sql
-- =====================================================================================
-- P0-4: every verified coach can read every sponsor's contact_email and the admin's
-- private `notes` column.
--
-- `sponsors_select` (0051:166-185) grants verified coaches SELECT on the sponsors BASE
-- TABLE. RLS is row-level, not column-level, so the geo/status predicate limits WHICH
-- sponsors a coach sees but not WHICH COLUMNS — all 17 come back, including
-- contact_name, contact_email, contact_title and `notes`, whose own schema comment
-- claims it is "admin-only field (enforced by RLS)". It is not enforced.
--
-- contact_email means any coach can bypass the moderation queue and cold-email every
-- sponsor directly, which is the exact thing the product exists to prevent. `notes` is
-- where an admin writes "declined us last year, do not re-contact".
--
-- ── Why the report's proposed fix is not what is implemented here ────────────────────
-- The report says "restrict the coach policy to the view and revoke the base-table
-- grant". The literal revoke would break MORE than it fixes:
--   * admin pages read the base table with the caller's own (authenticated) session —
--     app/(admin)/sponsors/page.tsx:13 does createClient().from('sponsors').select('*'),
--     as do /sponsors/[id]/edit, /analytics and components/admin/analytics-charts.tsx.
--   * a sponsor legitimately reads its own full row via `sponsors_select_own` (0051:188).
-- Admin, sponsor and coach are all the same Postgres role (`authenticated`), so a
-- table-level or column-level REVOKE cannot distinguish them. The separation has to
-- live in RLS + the view, which is what this migration does:
--
--   1. `sponsors_select` loses its coach branch and becomes admin-only.
--      -> a coach now reads ZERO rows from the base table.
--   2. `v_sponsors_public` becomes a SECURITY DEFINER view (security_invoker = false)
--      that re-implements the coach visibility predicate internally, and gains
--      `geo_states` (needed by the browse UI, and not sensitive).
--      -> a coach reads exactly the 10 safe columns, for exactly the sponsors they
--         were already entitled to see.
--   3. Explicit REVOKE ... FROM anon on the view, because a SECURITY DEFINER view
--      bypasses base-table RLS and must never be reachable unauthenticated.
--
-- APP CHANGE REQUIRED WITH THIS MIGRATION (shipped in the same commit):
--   app/actions/submission.ts:80-88 re-checks sponsor status through the coach's own
--   RLS-respecting client against the BASE table. After (1) that returns null for
--   every coach and the guard would reject every pitch with "This sponsor is not
--   currently accepting new submissions." It is repointed at v_sponsors_public.
--   Swept: this was the only coach-context read of the base table via `.from('sponsors')`.
--   BUT that grep could not see PostgREST EMBEDS, and there is one:
--     app/(coach)/dashboard/page.tsx:35
--       .select('..., sponsors:sponsor_id(company_name)')
--   An embed resolves against the BASE TABLE, not the view, so after this migration it
--   returns null for every coach and the dashboard renders blank sponsor names on the
--   submissions list and the needs-attention banner — silently, with no error. The
--   dashboard is changed in the same commit to resolve names from v_sponsors_public
--   instead, which is why the view gains the "already pitched" branch below.
--
-- APPLY WITH:  psql "$DATABASE_URL" -f supabase/migrations/0063_sponsors_coach_exposure.sql
-- Idempotent: DROP ... IF EXISTS then CREATE.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1. Coach-safe projection. SECURITY DEFINER (security_invoker = false) so it can read
--    the base table without the coach holding base-table access. The visibility rules
--    that used to live in the `sponsors_select` policy move in here verbatim.
--
--    DROP + CREATE rather than CREATE OR REPLACE: the column list changes (geo_states
--    is added) and the security_invoker option flips, neither of which CREATE OR REPLACE
--    VIEW supports. Verified no other database object depends on this view — the only
--    references in supabase/migrations/ are 0045's own CREATE and GRANT.
-- -------------------------------------------------------------------------------------
DROP VIEW IF EXISTS v_sponsors_public;

CREATE VIEW v_sponsors_public WITH (security_invoker = false) AS
SELECT
  s.id,
  s.company_name,
  s.industry,
  s.website,
  s.logo_url,
  s.geo_states,
  s.funding_cap_cents,
  s.funding_used_cents,
  s.status,
  s.created_at
FROM sponsors s
WHERE
  -- Admins see everything (they also have the base table).
  is_admin()
  OR (
    -- Verified coaches see active, non-exhausted, geo-matching sponsors only.
    -- Identical predicate to the coach branch removed from sponsors_select below.
    is_coach_verified()
    AND s.status = 'active'
    AND s.funding_used_cents < s.funding_cap_cents
    AND (
      s.geo_states IS NULL
      OR EXISTS (
        SELECT 1 FROM teams t
         WHERE t.owner_id = current_profile_id()
           AND t.state = ANY(s.geo_states)
      )
    )
  )
  OR (
    -- ...AND any sponsor this coach has ALREADY pitched, regardless of that sponsor's
    -- current status, capacity or geo. Without this branch a coach's own submission
    -- history renders with a blank company name the moment the sponsor goes inactive or
    -- fills its cap — and the coach dashboard lists exactly those rows. Discloses only
    -- the same 10 safe columns, for a sponsor the coach demonstrably already knows about.
    EXISTS (
      SELECT 1
        FROM submissions sub
        JOIN teams t ON t.id = sub.team_id
       WHERE sub.sponsor_id = s.id
         AND t.owner_id = current_profile_id()
    )
  );

COMMENT ON VIEW v_sponsors_public IS
  'Coach-safe projection of sponsors. SECURITY DEFINER: it deliberately bypasses RLS on '
  'the base table, so the visibility predicate lives in the view body and the view MUST '
  'NEVER be granted to anon. Omits contact_name, contact_email, contact_title, notes and '
  'every other admin-only column (P0-4).';

-- A SECURITY DEFINER view is a privileged surface: be explicit about who may read it.
REVOKE ALL ON v_sponsors_public FROM PUBLIC;
REVOKE ALL ON v_sponsors_public FROM anon;
GRANT SELECT ON v_sponsors_public TO authenticated;
GRANT SELECT ON v_sponsors_public TO service_role;

-- -------------------------------------------------------------------------------------
-- 2. Base table: admins only. The coach branch is gone — coaches go through the view.
--    `sponsors_select_own` (0051:188-197) is intentionally left in place so a sponsor
--    can still read its own company record, including its own contact_email.
-- -------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "sponsors_select" ON sponsors;
CREATE POLICY "sponsors_select" ON sponsors FOR SELECT
  USING (is_admin());

-- =====================================================================================
-- VERIFICATION (run after applying)
--
-- 1. As a verified coach (real Clerk session -> PostgREST):
--      GET /rest/v1/sponsors?select=*                 -> expect []            (was: full rows)
--      GET /rest/v1/v_sponsors_public?select=*        -> expect the geo-matched active
--                                                        sponsors, 10 columns, and NO
--                                                        contact_email / notes key at all
-- 2. As anon:
--      GET /rest/v1/v_sponsors_public?select=*        -> expect 401/permission denied
-- 3. As an admin: /admin/sponsors must still render every sponsor with contact_email.
-- 4. As a sponsor: /sponsor/* must still resolve its own company row.
-- 5. Coach flow: create and submit a pitch — the submission.ts:80 status guard must pass.
-- =====================================================================================
