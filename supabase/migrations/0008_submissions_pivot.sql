-- 0008_submissions_pivot.sql

-- 1. Create tax_status enum and add to teams
DO $tax$ BEGIN
  CREATE TYPE tax_status_type AS ENUM ('501c3', 'School', 'None');
EXCEPTION WHEN duplicate_object THEN NULL;
END $tax$;

ALTER TABLE teams ADD COLUMN IF NOT EXISTS tax_status tax_status_type NOT NULL DEFAULT 'None';

-- Migrate the old boolean to the enum, then retire it. Guarded on the column still
-- being present so a replay over an already-migrated database is a no-op rather than
-- an "is_501c3 does not exist" abort.
DO $b501c3$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'teams' AND column_name = 'is_501c3'
  ) THEN
    UPDATE teams SET tax_status = '501c3' WHERE is_501c3 = true;
    ALTER TABLE teams DROP COLUMN is_501c3;
  END IF;
END $b501c3$;

-- 2. Clean up old pitch architecture
DROP VIEW IF EXISTS v_pitch_summary;

DROP TABLE IF EXISTS pitch_sponsor_targets CASCADE;
DROP TABLE IF EXISTS pitches CASCADE;

DROP TYPE IF EXISTS dispatch_status CASCADE;
DROP TYPE IF EXISTS pitch_status CASCADE;

-- 3. Create new submissions architecture
-- NOTE: All status values that later migrations (0011/0015/0019/0035) add are
-- declared up front so this migration's policies (which reference
-- 'changes_requested') apply cleanly to a fresh database. The later ALTER TYPE
-- ... ADD VALUE statements are IF NOT EXISTS and become no-ops.
DO $substatus$ BEGIN
  CREATE TYPE submission_status AS ENUM ('draft', 'pending', 'approved', 'declined', 'changes_requested', 'opened', 'bounced', 'delivered', 'expired', 'dispatched');
EXCEPTION WHEN duplicate_object THEN NULL;
END $substatus$;

CREATE TABLE IF NOT EXISTS submissions (
    id                          uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id                     uuid                NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    sponsor_id                  uuid                NOT NULL REFERENCES sponsors(id) ON DELETE CASCADE,
    custom_pitch_alignment      text,
    specific_needs_statement    text,
    local_connection_notes      text,
    status                      submission_status   NOT NULL DEFAULT 'draft',
    created_at                  timestamptz         NOT NULL DEFAULT now(),
    updated_at                  timestamptz         NOT NULL DEFAULT now(),
    UNIQUE(team_id, sponsor_id)
);

-- Triggers for updated_at
DROP TRIGGER IF EXISTS set_updated_at_submissions ON submissions;
CREATE TRIGGER set_updated_at_submissions
    BEFORE UPDATE ON submissions
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_submissions_team_id ON submissions(team_id);
CREATE INDEX IF NOT EXISTS idx_submissions_sponsor_id ON submissions(sponsor_id);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);

-- RLS
ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "submissions_select" ON submissions;
CREATE POLICY "submissions_select" ON submissions FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM teams t
            WHERE t.id = team_id AND (t.owner_id = auth.uid() OR is_admin())
        )
    );

DROP POLICY IF EXISTS "submissions_insert" ON submissions;
CREATE POLICY "submissions_insert" ON submissions FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM teams t
            WHERE t.id = team_id AND t.owner_id = auth.uid()
        )
        AND is_coach_verified()
    );

DROP POLICY IF EXISTS "submissions_update_coach" ON submissions;
CREATE POLICY "submissions_update_coach" ON submissions FOR UPDATE
    USING (
        EXISTS (SELECT 1 FROM teams t WHERE t.id = team_id AND t.owner_id = auth.uid())
        AND status IN ('draft', 'declined', 'changes_requested')
    )
    WITH CHECK (
        status IN ('draft', 'pending')
    );

DROP POLICY IF EXISTS "submissions_update_admin" ON submissions;
CREATE POLICY "submissions_update_admin" ON submissions FOR UPDATE
    USING (is_admin());

DROP POLICY IF EXISTS "submissions_delete" ON submissions;
CREATE POLICY "submissions_delete" ON submissions FOR DELETE
    USING (
        is_admin() OR
        (EXISTS (SELECT 1 FROM teams t WHERE t.id = team_id AND t.owner_id = auth.uid()) AND status = 'draft')
    );
