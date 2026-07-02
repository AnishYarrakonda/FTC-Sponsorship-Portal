-- 0056_drop_legacy_robot_columns.sql
-- =====================================================================================
-- Portfolio redesign, phase 2 (apply ONLY after all app code has stopped referencing
-- these columns — the 0054 backfill already preserved their content in
-- technical_summary). Sponsors evaluate teams on achievements, credibility, story,
-- and community impact; granular robot hardware/software fields are retired.
-- =====================================================================================

ALTER TABLE teams
  DROP COLUMN IF EXISTS drivetrain,
  DROP COLUMN IF EXISTS build_system,
  DROP COLUMN IF EXISTS programming,
  DROP COLUMN IF EXISTS cad_software,
  DROP COLUMN IF EXISTS control_system,
  DROP COLUMN IF EXISTS sensors,
  DROP COLUMN IF EXISTS autonomous_description,
  DROP COLUMN IF EXISTS proudest_mechanism_name,
  DROP COLUMN IF EXISTS proudest_mechanism_problem,
  DROP COLUMN IF EXISTS proudest_mechanism_solution,
  DROP COLUMN IF EXISTS manufacturing_capabilities;
