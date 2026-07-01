-- 0054_portfolio_redesign.sql
-- =====================================================================================
-- Portfolio redesign: sponsors care about achievements, credibility, team story, and
-- community impact — not hardware/software specifics. This migration is ADDITIVE only:
--   * new sponsor-facing columns on teams (story / credibility / impact)
--   * backfills technical_summary from the legacy robot columns so no coach-entered
--     content is lost when 0056 drops them
-- Legacy robot columns are dropped separately in 0056 (applied after all app code has
-- stopped referencing them) so the live build stays compatible at every step.
--
-- RLS: no policy changes needed — existing teams policies are row-level and
-- column-agnostic; the new columns inherit them.
-- =====================================================================================

-- Team Story & People
ALTER TABLE teams ADD COLUMN IF NOT EXISTS founded_year int CHECK (founded_year IS NULL OR (founded_year >= 1992 AND founded_year <= 2100));
ALTER TABLE teams ADD COLUMN IF NOT EXISTS team_size int CHECK (team_size IS NULL OR team_size >= 0);
ALTER TABLE teams ADD COLUMN IF NOT EXISTS seasons_competed int CHECK (seasons_competed IS NULL OR seasons_competed >= 0);
ALTER TABLE teams ADD COLUMN IF NOT EXISTS coach_experience text;

-- Credibility
ALTER TABLE teams ADD COLUMN IF NOT EXISTS past_sponsors text[] NOT NULL DEFAULT '{}';
ALTER TABLE teams ADD COLUMN IF NOT EXISTS press_links jsonb NOT NULL DEFAULT '[]';
ALTER TABLE teams ADD COLUMN IF NOT EXISTS community_endorsements text;

-- Community & Ethics Impact
ALTER TABLE teams ADD COLUMN IF NOT EXISTS students_reached int CHECK (students_reached IS NULL OR students_reached >= 0);
ALTER TABLE teams ADD COLUMN IF NOT EXISTS events_hosted int CHECK (events_hosted IS NULL OR events_hosted >= 0);
ALTER TABLE teams ADD COLUMN IF NOT EXISTS volunteer_hours int CHECK (volunteer_hours IS NULL OR volunteer_hours >= 0);

-- Backfill technical_summary from legacy robot fields (prose, skips NULL/empty parts).
-- Guarded so replays and already-backfilled rows are untouched.
UPDATE teams
SET technical_summary = NULLIF(btrim(concat_ws(E'\n',
  CASE WHEN COALESCE(drivetrain, '') <> ''              THEN 'Drivetrain: ' || drivetrain END,
  CASE WHEN COALESCE(build_system, '') <> ''            THEN 'Build system: ' || build_system END,
  CASE WHEN COALESCE(programming, '') <> ''             THEN 'Programming: ' || programming END,
  CASE WHEN COALESCE(cad_software, '') <> ''            THEN 'CAD software: ' || cad_software END,
  CASE WHEN COALESCE(control_system, '') <> ''          THEN 'Control system: ' || control_system END,
  CASE WHEN sensors IS NOT NULL AND array_length(sensors, 1) > 0
                                                        THEN 'Sensors: ' || array_to_string(sensors, ', ') END,
  CASE WHEN manufacturing_capabilities IS NOT NULL AND array_length(manufacturing_capabilities, 1) > 0
                                                        THEN 'Manufacturing: ' || array_to_string(manufacturing_capabilities, ', ') END,
  CASE WHEN COALESCE(autonomous_description, '') <> ''  THEN 'Autonomous: ' || autonomous_description END,
  CASE WHEN COALESCE(proudest_mechanism_name, '') <> ''
       THEN 'Proudest mechanism — ' || proudest_mechanism_name
            || CASE WHEN COALESCE(proudest_mechanism_problem, '') <> '' THEN '. Problem: ' || proudest_mechanism_problem ELSE '' END
            || CASE WHEN COALESCE(proudest_mechanism_solution, '') <> '' THEN ' Solution: ' || proudest_mechanism_solution ELSE '' END
  END
)), '')
WHERE COALESCE(technical_summary, '') = ''
  AND (
    COALESCE(drivetrain, '') <> '' OR COALESCE(build_system, '') <> '' OR COALESCE(programming, '') <> ''
    OR COALESCE(cad_software, '') <> '' OR COALESCE(control_system, '') <> ''
    OR (sensors IS NOT NULL AND array_length(sensors, 1) > 0)
    OR (manufacturing_capabilities IS NOT NULL AND array_length(manufacturing_capabilities, 1) > 0)
    OR COALESCE(autonomous_description, '') <> '' OR COALESCE(proudest_mechanism_name, '') <> ''
  );
