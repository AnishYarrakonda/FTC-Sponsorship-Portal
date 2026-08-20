CREATE TABLE IF NOT EXISTS notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type        text NOT NULL CHECK (type IN ('submission_declined','submission_approved','submission_changes_requested','general')),
  title       text NOT NULL,
  body        text,
  submission_id uuid REFERENCES submissions(id) ON DELETE SET NULL,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- RLS: coaches can only read their own notifications
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "coaches_read_own_notifications" ON notifications;
CREATE POLICY "coaches_read_own_notifications"
  ON notifications FOR SELECT
  USING (recipient_id = auth.uid());
DROP POLICY IF EXISTS "service_insert_notifications" ON notifications;
CREATE POLICY "service_insert_notifications"
  ON notifications FOR INSERT
  WITH CHECK (true); -- service role only inserts; RLS bypassed by admin client

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS cad_software                text,
  ADD COLUMN IF NOT EXISTS control_system              text,
  ADD COLUMN IF NOT EXISTS github_link                 text,
  ADD COLUMN IF NOT EXISTS autonomous_description      text,
  ADD COLUMN IF NOT EXISTS proudest_mechanism_name     text,
  ADD COLUMN IF NOT EXISTS proudest_mechanism_problem  text,
  ADD COLUMN IF NOT EXISTS proudest_mechanism_solution text,
  ADD COLUMN IF NOT EXISTS subteam_breakdown           text,
  ADD COLUMN IF NOT EXISTS manufacturing_capabilities  text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS sensors                     text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS visual_pitch_items          jsonb  NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE teams
  ADD CONSTRAINT teams_autonomous_description_len
    CHECK (autonomous_description IS NULL OR char_length(autonomous_description) <= 750),
  ADD CONSTRAINT teams_mechanism_solution_len
    CHECK (proudest_mechanism_solution IS NULL OR char_length(proudest_mechanism_solution) <= 1000);

DROP VIEW IF EXISTS v_submission_summary;
CREATE OR REPLACE VIEW v_submission_summary WITH (security_invoker = true) AS
SELECT s.id, t.team_name, t.owner_id, sp.company_name,
       s.status, s.admin_feedback, s.is_locked,
       t.financial_ask_cents, s.created_at, s.updated_at
FROM submissions s
JOIN teams t  ON t.id = s.team_id
JOIN sponsors sp ON sp.id = s.sponsor_id;
