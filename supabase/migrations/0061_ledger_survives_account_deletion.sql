-- 0061_ledger_survives_account_deletion.sql
-- =====================================================================================
-- Live E2E caught account deletion failing for any coach whose team has settled
-- funding: transactions_ledger's team_id/submission_id FKs are ON DELETE RESTRICT,
-- so the Clerk user.deleted webhook's profile delete (cascading into teams and
-- submissions) aborts with 23503 — the Clerk account is gone but the Supabase data
-- stays orphaned. The ledger is the append-only financial record and must survive
-- account deletion, so the references become nullable ON DELETE SET NULL.
-- sponsor_id stays RESTRICT: sponsors are deleted by admins, who must resolve the
-- books first. Idempotent.
-- =====================================================================================

ALTER TABLE transactions_ledger ALTER COLUMN team_id DROP NOT NULL;
ALTER TABLE transactions_ledger ALTER COLUMN submission_id DROP NOT NULL;

ALTER TABLE transactions_ledger DROP CONSTRAINT IF EXISTS transactions_ledger_team_id_fkey;
ALTER TABLE transactions_ledger ADD CONSTRAINT transactions_ledger_team_id_fkey
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL;

ALTER TABLE transactions_ledger DROP CONSTRAINT IF EXISTS transactions_ledger_submission_id_fkey;
ALTER TABLE transactions_ledger ADD CONSTRAINT transactions_ledger_submission_id_fkey
  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE SET NULL;
