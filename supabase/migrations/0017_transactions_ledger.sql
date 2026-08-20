-- transactions_ledger: append-only record of every sponsorship acceptance.
-- The sponsors.funding_used_cents counter is the fast cache; this is ground truth.

CREATE TABLE IF NOT EXISTS transactions_ledger (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_id     uuid        NOT NULL REFERENCES sponsors(id) ON DELETE RESTRICT,
  team_id        uuid        NOT NULL REFERENCES teams(id)   ON DELETE RESTRICT,
  submission_id  uuid        NOT NULL REFERENCES submissions(id) ON DELETE RESTRICT,
  amount_cents   bigint      NOT NULL CHECK (amount_cents > 0),
  decision_type  text        NOT NULL CHECK (decision_type IN ('full', 'partial')),
  actor_type     text        NOT NULL CHECK (actor_type IN ('sponsor', 'admin')),
  created_at     timestamptz NOT NULL DEFAULT now()
  -- No updated_at: this table is append-only
);

CREATE INDEX IF NOT EXISTS idx_transactions_sponsor ON transactions_ledger(sponsor_id);
CREATE INDEX IF NOT EXISTS idx_transactions_team    ON transactions_ledger(team_id);
CREATE INDEX IF NOT EXISTS idx_transactions_submission ON transactions_ledger(submission_id);

ALTER TABLE transactions_ledger ENABLE ROW LEVEL SECURITY;

-- Admins can read; no one can UPDATE or DELETE (no policies = denied by RLS)
DROP POLICY IF EXISTS "ledger_select_admin" ON transactions_ledger;
CREATE POLICY "ledger_select_admin" ON transactions_ledger FOR SELECT
  USING (is_admin());

-- INSERT is handled by service-role client only (same pattern as audit_log)
