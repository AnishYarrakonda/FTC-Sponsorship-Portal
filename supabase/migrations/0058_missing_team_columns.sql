-- 0058_missing_team_columns.sql
-- =====================================================================================
-- Live E2E verification caught updateTeam/createTeam writing two columns that were
-- defined in the Zod schema (and collected by the incubator UI) but never existed in
-- the database: sustainability_plan and student_interest_count. The `as never` cast
-- on the Supabase payload hid this from typecheck. Both are legitimate global team
-- facts (Goals & Funding section), so add the columns rather than dropping the fields.
-- RLS: column-agnostic row policies on teams cover these automatically.
-- =====================================================================================

ALTER TABLE teams ADD COLUMN IF NOT EXISTS sustainability_plan text;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS student_interest_count int CHECK (student_interest_count IS NULL OR student_interest_count >= 0);
