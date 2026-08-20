-- 0013_submission_moderation_fields.sql

ALTER TABLE submissions
ADD COLUMN IF NOT EXISTS admin_feedback text,
ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
