-- 0068_missing_indexes.sql
-- =====================================================================================
-- P2 (report §12): four hot columns have no index. Postgres does NOT auto-index foreign
-- keys, and none of migrations 0001-0067 create these. Batched into one file because
-- each is independently low-risk and they share a verification step.
--
-- Confirmed absent by sweep:
--   grep -rn "CREATE INDEX" supabase/migrations/ | grep -E "team_achievements|profiles|submissions"
-- returns idx_profiles_clerk_user_id, idx_profiles_sponsor_id, idx_submissions_{team_id,
-- sponsor_id,status,resend_message_id,reviewed_by,expires_at} — and nothing for the four
-- below.
--
-- CREATE INDEX CONCURRENTLY is deliberately NOT used: it cannot run inside a transaction
-- block, and psql -f wraps nothing implicitly but the Supabase pooler may. These tables
-- are tiny (single-digit rows today), so a plain CREATE INDEX takes milliseconds and its
-- brief ACCESS EXCLUSIVE lock is irrelevant. Revisit if these ever grow large.
--
-- APPLY WITH:  psql "$DATABASE_URL" -f supabase/migrations/0068_missing_indexes.sql
-- Idempotent: IF NOT EXISTS throughout.
-- =====================================================================================

-- FK with no index. Filtered on every portfolio render and by achievements_select's
-- EXISTS subquery, which runs on every team_achievements row read.
CREATE INDEX IF NOT EXISTS idx_team_achievements_team_id
  ON team_achievements(team_id);

-- profiles.role: scanned by every "notify all admins" fan-out
-- (submission.ts:170, lib/notify.ts) and by is_admin()'s underlying lookup.
CREATE INDEX IF NOT EXISTS idx_profiles_role
  ON profiles(role);

-- profiles.coach_verified: the /coaches admin queue and /analytics both filter on it.
-- Partial index — the pending queue (false) is the selective, frequently-scanned side.
CREATE INDEX IF NOT EXISTS idx_profiles_coach_verified
  ON profiles(coach_verified);

-- submissions.created_at: the 7-day rolling submission-rate check
-- (app/actions/submission.ts:72) does a range scan on it, as do the admin list orders.
CREATE INDEX IF NOT EXISTS idx_submissions_created_at
  ON submissions(created_at DESC);

-- =====================================================================================
-- VERIFICATION
--   SELECT indexname, indexdef FROM pg_indexes
--    WHERE schemaname='public'
--      AND indexname IN ('idx_team_achievements_team_id','idx_profiles_role',
--                        'idx_profiles_coach_verified','idx_submissions_created_at')
--    ORDER BY 1;
--   -- expect 4 rows
-- =====================================================================================
