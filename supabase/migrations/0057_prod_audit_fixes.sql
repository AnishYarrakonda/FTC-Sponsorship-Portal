-- (Renumbered from 00211_prod_audit_fixes.sql — the 5-digit version broke the
-- Supabase CLI's migration ordering. Content already applied to prod; idempotent.)

-- C6: Explicit RLS policy on submission_access_tokens
DROP POLICY IF EXISTS "sat_deny_all" ON submission_access_tokens;
CREATE POLICY "sat_deny_all" ON submission_access_tokens FOR ALL USING (false) WITH CHECK (false);

-- C9: Missing indexes on hot submission columns
CREATE INDEX IF NOT EXISTS idx_submissions_reviewed_by ON submissions(reviewed_by);
CREATE INDEX IF NOT EXISTS idx_submissions_resend_msg ON submissions(resend_message_id);
CREATE INDEX IF NOT EXISTS idx_submissions_expires_at ON submissions(expires_at);

-- H1: Add revoked_at to allow token revocation
ALTER TABLE submission_access_tokens ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
