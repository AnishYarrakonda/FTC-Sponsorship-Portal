-- 0088_impact_reports.sql
--
-- CSR / ESG impact reports.
--
-- A sponsor's community-relations manager has to justify the spend internally, usually to
-- someone who was not in the room. The platform holds every fact they need and can emit
-- none of them: the only export is the admin submissions CSV, which is both unreachable to
-- a sponsor and the wrong document (it carries contact emails and every pitch's full text).
--
-- Design notes:
--
--  * SNAPSHOT, DO NOT RECOMPUTE. A closed year must be stable: the CFO who downloaded the
--    2026 report in January must get the same document in July, even though the team has
--    since edited its portfolio. A live query cannot promise that, so the rendered payload
--    is stored.
--
--  * THE COPPA ALLOWLIST IS TYPESCRIPT, NOT SQL. lib/impact-report/projection.ts is the
--    only place a team, achievement, fulfillment or benefit becomes report output, and it
--    builds every object by explicit key enumeration with no spread. Aggregates in SQL,
--    projections in TypeScript: refresh_public_platform_stats() emits seven scalars and
--    touches no per-entity text, so there is no allowlist to enforce and nothing a unit
--    test could usefully assert about it. The report payload is a per-team document
--    assembled from fifteen columns across four tables, where the allowlist IS the
--    security control and must be unit-testable.
--
--  * PHOTOS FAIL CLOSED. recognition_benefit_deliveries.proof_url cannot exist without the
--    no-minors affirmation (0087's CHECK). teams.media_urls predates that and has no such
--    guarantee, so this migration adds one, defaulting to NULL — no portfolio photo reaches
--    a report until a coach opts in, and the affirmation is cleared automatically whenever
--    the photos change.
--
--  * SPONSOR SCOPING GOES THROUGH current_sponsor_ids() (0082), NOT profiles.sponsor_id.
--    A sponsor user can belong to several sponsor orgs; the single-column comparison the
--    pre-0082 shape uses silently returns nothing for them.
--
--  * $$-quoted blocks: apply with `psql -f`, never the Supabase CLI splitter.
--
-- Idempotent: safe to run twice.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The media affirmation on teams
-- ─────────────────────────────────────────────────────────────────────────────
-- Safe to add: guard_submission_writable_columns() (0064) fails closed against an
-- allowlist on SUBMISSIONS, not on teams, and teams' RLS policies are column-agnostic —
-- the same reasoning 0058 records for the two columns it added.
ALTER TABLE teams ADD COLUMN IF NOT EXISTS media_no_minors_confirmed_at timestamptz;

COMMENT ON COLUMN teams.media_no_minors_confirmed_at IS
  'Set when the coach affirms that every image in media_urls depicts robots, workspaces, '
  'signage or events with no identifiable minors. NULL means portfolio photos are EXCLUDED '
  'from CSR impact reports. Cleared automatically whenever media_urls changes.';

-- The affirmation must not survive a change to the thing it affirms. A coach adding a
-- photo after affirming must re-affirm.
CREATE OR REPLACE FUNCTION trg_reset_media_affirmation()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.media_urls IS DISTINCT FROM OLD.media_urls THEN
    NEW.media_no_minors_confirmed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION trg_reset_media_affirmation() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION trg_reset_media_affirmation() FROM anon;
REVOKE EXECUTE ON FUNCTION trg_reset_media_affirmation() FROM authenticated;
GRANT  EXECUTE ON FUNCTION trg_reset_media_affirmation() TO service_role;

DROP TRIGGER IF EXISTS reset_media_affirmation ON teams;
CREATE TRIGGER reset_media_affirmation
  BEFORE UPDATE OF media_urls ON teams
  FOR EACH ROW EXECUTE FUNCTION trg_reset_media_affirmation();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. impact_report_snapshots — the frozen artifact
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS impact_report_snapshots (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'sponsor' = one company's report. 'platform' = the aggregate used for grant
  -- applications and the landing page.
  scope                 text NOT NULL CHECK (scope IN ('sponsor', 'platform')),
  sponsor_id            uuid REFERENCES sponsors(id) ON DELETE CASCADE,
  report_year           int  NOT NULL CHECK (report_year BETWEEN 2000 AND 2100),
  status                text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  -- The frozen document, produced by lib/impact-report/projection.ts and NOTHING else.
  payload               jsonb NOT NULL,
  -- Bumped when the projection's shape changes, so an old snapshot renders with the
  -- renderer it was built for instead of crashing on a missing key.
  payload_schema_version int NOT NULL DEFAULT 1,
  generated_at          timestamptz NOT NULL DEFAULT now(),
  generated_by          uuid REFERENCES profiles(id) ON DELETE SET NULL,
  closed_at             timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  -- Keeps sponsor_id consistent with scope, so a platform row can never be mistaken for a
  -- sponsor row by a policy.
  CONSTRAINT scope_matches_sponsor CHECK ((scope = 'sponsor') = (sponsor_id IS NOT NULL)),
  CONSTRAINT closed_has_timestamp  CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);

-- Two PARTIAL unique indexes, not one composite: in Postgres NULLs are distinct, so a
-- plain UNIQUE (sponsor_id, report_year) would happily allow fifty platform rows for 2026.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_impact_snapshot_sponsor_year
  ON impact_report_snapshots(sponsor_id, report_year) WHERE sponsor_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_impact_snapshot_platform_year
  ON impact_report_snapshots(report_year) WHERE sponsor_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_impact_snapshots_year ON impact_report_snapshots(report_year DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. public_platform_stats — the anon-readable projection
-- ─────────────────────────────────────────────────────────────────────────────
-- The landing page must NOT read impact_report_snapshots; those rows carry per-sponsor
-- payloads. Seven integers and a timestamp is what makes an anon SELECT defensible here
-- and indefensible there.
CREATE TABLE IF NOT EXISTS public_platform_stats (
  -- Single-row table. The CHECK plus the PK make a second row impossible.
  id                     boolean PRIMARY KEY DEFAULT true CHECK (id),
  teams_supported        int    NOT NULL DEFAULT 0,
  sponsors_active        int    NOT NULL DEFAULT 0,
  dollars_pledged_cents  bigint NOT NULL DEFAULT 0,
  dollars_received_cents bigint NOT NULL DEFAULT 0,
  students_reached       int    NOT NULL DEFAULT 0,
  events_hosted          int    NOT NULL DEFAULT 0,
  volunteer_hours        int    NOT NULL DEFAULT 0,
  refreshed_at           timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public_platform_stats (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RPCs
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION upsert_impact_snapshot(
  p_actor_profile_id uuid,
  p_scope            text,
  p_sponsor_id       uuid,
  p_report_year      int,
  p_payload          jsonb,
  p_schema_version   int DEFAULT 1
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor  uuid;
  v_existing impact_report_snapshots%ROWTYPE;
  v_id     uuid;
  v_now    timestamptz := now();
BEGIN
  IF (auth.jwt() ->> 'sub') IS NOT NULL THEN
    v_actor := current_profile_id();
    IF v_actor IS NULL OR v_actor <> p_actor_profile_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
    END IF;
    -- Sponsors never write their own report.
    IF NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = v_actor AND p.role = 'admin') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
    END IF;
  ELSIF is_trusted_server_context() THEN
    v_actor := p_actor_profile_id;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  IF (p_scope = 'sponsor') <> (p_sponsor_id IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'scope_mismatch');
  END IF;
  IF p_scope NOT IN ('sponsor', 'platform') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'scope_mismatch');
  END IF;

  -- The immutability guarantee lives HERE, in the database, so that no future caller can
  -- route around it by talking to the table directly.
  SELECT * INTO v_existing FROM impact_report_snapshots
   WHERE report_year = p_report_year
     AND ((p_sponsor_id IS NULL AND sponsor_id IS NULL) OR sponsor_id = p_sponsor_id)
   FOR UPDATE;

  IF FOUND AND v_existing.status = 'closed' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'year_closed');
  END IF;

  IF FOUND THEN
    UPDATE impact_report_snapshots SET
      payload = p_payload,
      payload_schema_version = p_schema_version,
      generated_at = v_now,
      generated_by = v_actor,
      updated_at = v_now
    WHERE id = v_existing.id;
    v_id := v_existing.id;
  ELSE
    INSERT INTO impact_report_snapshots
      (scope, sponsor_id, report_year, payload, payload_schema_version, generated_at, generated_by)
    VALUES
      (p_scope, p_sponsor_id, p_report_year, p_payload, p_schema_version, v_now, v_actor)
    RETURNING id INTO v_id;
  END IF;

  -- The payload is a whole document and audit_log is forever: record its size, not itself.
  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_actor, 'impact_snapshot_generated', 'impact_report_snapshots', v_id,
    jsonb_build_object(
      'scope', p_scope,
      'sponsor_id', p_sponsor_id,
      'report_year', p_report_year,
      'teams', COALESCE(jsonb_array_length(p_payload -> 'teams'), 0),
      'bytes', octet_length(p_payload::text)
    )
  );

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'generated_at', v_now);
END;
$$;

REVOKE EXECUTE ON FUNCTION upsert_impact_snapshot(uuid, text, uuid, int, jsonb, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION upsert_impact_snapshot(uuid, text, uuid, int, jsonb, int) FROM anon;
REVOKE EXECUTE ON FUNCTION upsert_impact_snapshot(uuid, text, uuid, int, jsonb, int) FROM authenticated;
GRANT  EXECUTE ON FUNCTION upsert_impact_snapshot(uuid, text, uuid, int, jsonb, int) TO service_role;

CREATE OR REPLACE FUNCTION close_impact_report_year(
  p_actor_profile_id uuid,
  p_year             int
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_count int;
BEGIN
  IF (auth.jwt() ->> 'sub') IS NOT NULL THEN
    v_actor := current_profile_id();
    IF v_actor IS NULL OR v_actor <> p_actor_profile_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = v_actor AND p.role = 'admin') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
    END IF;
  ELSIF is_trusted_server_context() THEN
    v_actor := p_actor_profile_id;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  UPDATE impact_report_snapshots
     SET status = 'closed', closed_at = now(), updated_at = now()
   WHERE report_year = p_year AND status = 'open';
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor, 'impact_year_closed', 'impact_report_snapshots', NULL,
          jsonb_build_object('report_year', p_year, 'snapshots_closed', v_count));

  RETURN jsonb_build_object('ok', true, 'closed', v_count);
END;
$$;

REVOKE EXECUTE ON FUNCTION close_impact_report_year(uuid, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION close_impact_report_year(uuid, int) FROM anon;
REVOKE EXECUTE ON FUNCTION close_impact_report_year(uuid, int) FROM authenticated;
GRANT  EXECUTE ON FUNCTION close_impact_report_year(uuid, int) TO service_role;

-- Reopening a published, financial-adjacent document is deliberately a three-step, logged
-- operation. It should feel heavier than clicking refresh.
CREATE OR REPLACE FUNCTION reopen_impact_report_year(
  p_actor_profile_id uuid,
  p_year             int,
  p_reason           text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_count int;
BEGIN
  IF (auth.jwt() ->> 'sub') IS NOT NULL THEN
    v_actor := current_profile_id();
    IF v_actor IS NULL OR v_actor <> p_actor_profile_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
    END IF;
  ELSIF is_trusted_server_context() THEN
    v_actor := p_actor_profile_id;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = v_actor AND p.role = 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  IF p_reason IS NULL OR char_length(btrim(p_reason)) < 10 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'reason_required');
  END IF;

  UPDATE impact_report_snapshots
     SET status = 'open', closed_at = NULL, updated_at = now()
   WHERE report_year = p_year AND status = 'closed';
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor, 'impact_year_reopened', 'impact_report_snapshots', NULL,
          jsonb_build_object('report_year', p_year, 'snapshots_reopened', v_count,
                             'reason', btrim(p_reason)));

  RETURN jsonb_build_object('ok', true, 'reopened', v_count);
END;
$$;

REVOKE EXECUTE ON FUNCTION reopen_impact_report_year(uuid, int, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION reopen_impact_report_year(uuid, int, text) FROM anon;
REVOKE EXECUTE ON FUNCTION reopen_impact_report_year(uuid, int, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION reopen_impact_report_year(uuid, int, text) TO service_role;

CREATE OR REPLACE FUNCTION refresh_public_platform_stats()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_teams    int;
  v_sponsors int;
  v_pledged  bigint;
  v_received bigint;
  v_students int;
  v_events   int;
  v_hours    int;
BEGIN
  SELECT COUNT(DISTINCT f.team_id),
         COALESCE(SUM(f.amount_cents), 0),
         COALESCE(SUM(f.amount_cents) FILTER (
           WHERE f.status IN ('payment_received', 'receipted')), 0)
    INTO v_teams, v_pledged, v_received
    FROM funding_fulfillments f
   WHERE f.status <> 'cancelled' AND f.team_id IS NOT NULL;

  SELECT COUNT(*) INTO v_sponsors FROM sponsors WHERE status = 'active';

  -- Summed over the DISTINCT FUNDED teams only, never over every team on the platform.
  -- Advertising the reach of teams nobody funded would be a lie.
  SELECT COALESCE(SUM(t.students_reached), 0),
         COALESCE(SUM(t.events_hosted), 0),
         COALESCE(SUM(t.volunteer_hours), 0)
    INTO v_students, v_events, v_hours
    FROM teams t
   WHERE t.deleted_at IS NULL
     AND t.id IN (SELECT DISTINCT f.team_id FROM funding_fulfillments f
                   WHERE f.status <> 'cancelled' AND f.team_id IS NOT NULL);

  INSERT INTO public_platform_stats (
    id, teams_supported, sponsors_active, dollars_pledged_cents, dollars_received_cents,
    students_reached, events_hosted, volunteer_hours, refreshed_at
  ) VALUES (
    true, v_teams, v_sponsors, v_pledged, v_received, v_students, v_events, v_hours, now()
  )
  ON CONFLICT (id) DO UPDATE SET
    teams_supported        = EXCLUDED.teams_supported,
    sponsors_active        = EXCLUDED.sponsors_active,
    dollars_pledged_cents  = EXCLUDED.dollars_pledged_cents,
    dollars_received_cents = EXCLUDED.dollars_received_cents,
    students_reached       = EXCLUDED.students_reached,
    events_hosted          = EXCLUDED.events_hosted,
    volunteer_hours        = EXCLUDED.volunteer_hours,
    refreshed_at           = EXCLUDED.refreshed_at;

  RETURN jsonb_build_object(
    'ok', true, 'teams_supported', v_teams, 'sponsors_active', v_sponsors,
    'dollars_pledged_cents', v_pledged, 'dollars_received_cents', v_received
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION refresh_public_platform_stats() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refresh_public_platform_stats() FROM anon;
REVOKE EXECUTE ON FUNCTION refresh_public_platform_stats() FROM authenticated;
GRANT  EXECUTE ON FUNCTION refresh_public_platform_stats() TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RLS
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE impact_report_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_platform_stats   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS impact_snapshots_select_admin ON impact_report_snapshots;
CREATE POLICY impact_snapshots_select_admin ON impact_report_snapshots
  FOR SELECT USING (is_admin());

-- The `scope = 'sponsor'` clause is not redundant with scope_matches_sponsor — it is the
-- belt that stops a future platform row with a stray sponsor_id being visible.
DROP POLICY IF EXISTS impact_snapshots_select_sponsor ON impact_report_snapshots;
CREATE POLICY impact_snapshots_select_sponsor ON impact_report_snapshots
  FOR SELECT USING (
    scope = 'sponsor'
    AND sponsor_id IS NOT NULL
    AND sponsor_id = ANY (current_sponsor_ids())
  );

-- No coach policy. A CSR report is a sponsor's internal document; the team's own facts are
-- already on their dashboard.
-- No INSERT / UPDATE / DELETE policies. Every write is service-role through the RPCs.

DROP POLICY IF EXISTS platform_stats_select_public ON public_platform_stats;
CREATE POLICY platform_stats_select_public ON public_platform_stats
  FOR SELECT TO anon, authenticated USING (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Seed the stats row with real numbers so the landing page is correct on deploy.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT refresh_public_platform_stats();
