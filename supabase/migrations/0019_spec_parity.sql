-- 0019_spec_parity.sql
-- Adds all fields needed to reach Master Specification parity.

-- ---------------------------------------------------------------------------
-- A. Tagline on teams (250-char max)
-- ---------------------------------------------------------------------------
ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS tagline text;

ALTER TABLE teams DROP CONSTRAINT IF EXISTS teams_tagline_max_len;
ALTER TABLE teams
  ADD CONSTRAINT teams_tagline_max_len
  CHECK (tagline IS NULL OR char_length(tagline) <= 250);


-- ---------------------------------------------------------------------------
-- B. Robot Specs — structured dropdowns
-- ---------------------------------------------------------------------------
CREATE TYPE drivetrain_type    AS ENUM ('mecanum', 'swerve', 'tank', 'other');
CREATE TYPE build_system_type  AS ENUM ('gobilda', 'rev', 'custom', 'other');
CREATE TYPE programming_lang   AS ENUM ('java', 'blocks', 'other');

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS drivetrain      drivetrain_type,
  ADD COLUMN IF NOT EXISTS build_system    build_system_type,
  ADD COLUMN IF NOT EXISTS programming     programming_lang;


-- ---------------------------------------------------------------------------
-- C. is_locked generated column on submissions
-- Spec: teams cannot edit once in the Admin Queue.
-- Stored generated column so it's queryable/indexable without app logic.
-- ---------------------------------------------------------------------------
ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS is_locked boolean
  GENERATED ALWAYS AS (
    status NOT IN ('draft', 'declined', 'changes_requested')
  ) STORED;


-- ---------------------------------------------------------------------------
-- D. Geographic preferences on sponsors
-- geo_states: NULL = no restriction; non-empty array = restricted to those states.
-- ---------------------------------------------------------------------------
ALTER TABLE sponsors
  ADD COLUMN IF NOT EXISTS geo_states text[] DEFAULT NULL;

-- Update the coach-facing RLS policy to honour geo_states.
-- Drop existing policy and replace with geo-aware version.
DROP POLICY IF EXISTS "sponsors_select_coach"  ON sponsors;
DROP POLICY IF EXISTS "sponsors_select"        ON sponsors;

CREATE POLICY "sponsors_select" ON sponsors FOR SELECT
  USING (
    CASE
      WHEN is_admin() THEN true
      WHEN is_coach_verified() THEN (
        status = 'active'
        AND funding_used_cents < funding_cap_cents
        -- geo filter: if sponsor has geo_states set, only show to coaches in those states
        AND (
          geo_states IS NULL
          OR EXISTS (
            SELECT 1 FROM teams t
            WHERE t.owner_id = auth.uid()
              AND t.state = ANY(geo_states)
          )
        )
      )
      ELSE false
    END
  );


-- ---------------------------------------------------------------------------
-- E. age_confirmed_at on profiles (COPPA / 18+ enforcement)
-- ---------------------------------------------------------------------------
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS age_confirmed_at timestamptz DEFAULT NULL;


-- ---------------------------------------------------------------------------
-- F. expires_at on submissions (14-day sponsor response window)
-- Only set when a submission moves to 'approved' (dispatched to sponsor).
-- Default NULL so drafts don't expire.
-- ---------------------------------------------------------------------------
ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS expires_at timestamptz DEFAULT NULL;

-- Add 'expired' to the status enum
ALTER TYPE submission_status ADD VALUE IF NOT EXISTS 'expired';
ALTER TYPE submission_status ADD VALUE IF NOT EXISTS 'changes_requested';


-- ---------------------------------------------------------------------------
-- G. variant_label on submissions (Application V2 versioning)
-- Allows multiple drafts per team×sponsor (UNIQUE constraint relaxed to
-- team_id + sponsor_id + variant_label).
-- ---------------------------------------------------------------------------
ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS variant_label text DEFAULT 'default';

-- The existing UNIQUE(team_id, sponsor_id) becomes too narrow once variants
-- are allowed.  Replace it with a 3-column unique index.
ALTER TABLE submissions DROP CONSTRAINT IF EXISTS submissions_team_id_sponsor_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_unique_variant
  ON submissions(team_id, sponsor_id, variant_label);
