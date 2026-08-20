-- Enforce spec character limits at the database layer so the constraint
-- survives any server action that bypasses Zod.

ALTER TABLE teams DROP CONSTRAINT IF EXISTS teams_mission_statement_max_len;
ALTER TABLE teams
  ADD CONSTRAINT teams_mission_statement_max_len
  CHECK (mission_statement IS NULL OR char_length(mission_statement) <= 1500);

ALTER TABLE teams DROP CONSTRAINT IF EXISTS teams_technical_summary_max_len;
ALTER TABLE teams
  ADD CONSTRAINT teams_technical_summary_max_len
  CHECK (technical_summary IS NULL OR char_length(technical_summary) <= 2000);

ALTER TABLE teams DROP CONSTRAINT IF EXISTS teams_outreach_summary_max_len;
ALTER TABLE teams
  ADD CONSTRAINT teams_outreach_summary_max_len
  CHECK (outreach_summary IS NULL OR char_length(outreach_summary) <= 2000);

ALTER TABLE teams DROP CONSTRAINT IF EXISTS teams_community_interest_max_len;
ALTER TABLE teams
  ADD CONSTRAINT teams_community_interest_max_len
  CHECK (community_interest_text IS NULL OR char_length(community_interest_text) <= 2000);

ALTER TABLE submissions DROP CONSTRAINT IF EXISTS submissions_custom_pitch_max_len;
ALTER TABLE submissions
  ADD CONSTRAINT submissions_custom_pitch_max_len
  CHECK (custom_pitch_alignment IS NULL OR char_length(custom_pitch_alignment) <= 1500);

ALTER TABLE submissions DROP CONSTRAINT IF EXISTS submissions_specific_needs_max_len;
ALTER TABLE submissions
  ADD CONSTRAINT submissions_specific_needs_max_len
  CHECK (specific_needs_statement IS NULL OR char_length(specific_needs_statement) <= 1500);

ALTER TABLE submissions DROP CONSTRAINT IF EXISTS submissions_local_connection_max_len;
ALTER TABLE submissions
  ADD CONSTRAINT submissions_local_connection_max_len
  CHECK (local_connection_notes IS NULL OR char_length(local_connection_notes) <= 1000);
