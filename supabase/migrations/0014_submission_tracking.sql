-- 0014_submission_tracking.sql

ALTER TABLE submissions
ADD COLUMN IF NOT EXISTS resend_message_id text;

CREATE INDEX IF NOT EXISTS idx_submissions_resend_message_id ON submissions(resend_message_id);
