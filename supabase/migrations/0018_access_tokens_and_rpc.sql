-- submission_access_tokens: signed tokens that let sponsors view/decide on a submission.
-- token_hash is SHA-256(random token) — we never store the plaintext.

CREATE TABLE IF NOT EXISTS submission_access_tokens (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id  uuid        NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  token_hash     text        NOT NULL UNIQUE,
  expires_at     timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  used_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sat_submission  ON submission_access_tokens(submission_id);
CREATE INDEX IF NOT EXISTS idx_sat_token_hash  ON submission_access_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_sat_expires_at  ON submission_access_tokens(expires_at);

ALTER TABLE submission_access_tokens ENABLE ROW LEVEL SECURITY;
-- No SELECT/INSERT/UPDATE/DELETE policies — all access via service-role client.


-- ---------------------------------------------------------------------------
-- approve_submission_atomic: concurrency-safe approval that:
--   1. Locks the sponsor row with SELECT FOR UPDATE
--   2. Verifies the sponsor still has capacity
--   3. Updates submissions.status → 'approved'
--   4. Writes to audit_log
--   5. Mints a new submission_access_token for the sponsor link
-- Returns: { ok, error, token }
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS approve_submission_atomic(uuid, uuid, bigint);
CREATE OR REPLACE FUNCTION approve_submission_atomic(
  p_submission_id  uuid,
  p_admin_id       uuid,
  p_amount_cents   bigint  -- 0 means "use team's financial_ask_cents"
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_submission    submissions%ROWTYPE;
  v_sponsor       sponsors%ROWTYPE;
  v_team          teams%ROWTYPE;
  v_ask_cents     bigint;
  v_token_plain   text;
  v_token_hash    text;
BEGIN
  -- Fetch & lock submission
  SELECT * INTO v_submission FROM submissions WHERE id = p_submission_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'submission_not_found');
  END IF;
  IF v_submission.status NOT IN ('pending') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'submission_not_pending');
  END IF;

  -- Fetch & lock sponsor row
  SELECT * INTO v_sponsor FROM sponsors WHERE id = v_submission.sponsor_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sponsor_not_found');
  END IF;

  -- Fetch team for ask amount
  SELECT * INTO v_team FROM teams WHERE id = v_submission.team_id;
  v_ask_cents := CASE WHEN p_amount_cents > 0 THEN p_amount_cents ELSE v_team.financial_ask_cents END;

  -- Check capacity
  IF (v_sponsor.funding_used_cents + v_ask_cents) > v_sponsor.funding_cap_cents THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_sponsor_capacity');
  END IF;

  -- 1. Update submission
  UPDATE submissions
  SET status = 'approved', reviewed_by = p_admin_id, reviewed_at = now()
  WHERE id = p_submission_id;

  -- 2. Audit log
  INSERT INTO audit_log(actor_id, action, entity_type, entity_id, metadata)
  VALUES (p_admin_id, 'approve_submission', 'submissions', p_submission_id,
    jsonb_build_object('amount_cents', v_ask_cents, 'sponsor_id', v_sponsor.id));

  -- 3. Mint access token (random 32-byte hex, SHA-256 hashed for storage)
  v_token_plain := encode(gen_random_bytes(32), 'hex');
  v_token_hash  := encode(digest(v_token_plain, 'sha256'), 'hex');

  INSERT INTO submission_access_tokens(submission_id, token_hash, expires_at)
  VALUES (p_submission_id, v_token_hash, now() + interval '14 days');

  RETURN jsonb_build_object('ok', true, 'token', v_token_plain, 'amount_cents', v_ask_cents);
END;
$$;
