-- Keep admin approval side-effect free with respect to sponsor funding.
-- Approval should only validate capacity, mark the submission approved,
-- write the moderation audit event, and mint the sponsor-view access token.

DROP FUNCTION IF EXISTS approve_submission_atomic(uuid, uuid, bigint);
CREATE OR REPLACE FUNCTION approve_submission_atomic(
  p_submission_id  uuid,
  p_admin_id       uuid,
  p_amount_cents   bigint
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
  SELECT * INTO v_submission FROM submissions WHERE id = p_submission_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'submission_not_found');
  END IF;

  IF v_submission.status NOT IN ('pending') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'submission_not_pending');
  END IF;

  SELECT * INTO v_sponsor FROM sponsors WHERE id = v_submission.sponsor_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sponsor_not_found');
  END IF;

  SELECT * INTO v_team FROM teams WHERE id = v_submission.team_id;
  v_ask_cents := CASE WHEN p_amount_cents > 0 THEN p_amount_cents ELSE v_team.financial_ask_cents END;

  IF (v_sponsor.funding_used_cents + v_ask_cents) > v_sponsor.funding_cap_cents THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_sponsor_capacity');
  END IF;

  UPDATE submissions
  SET status = 'approved', reviewed_by = p_admin_id, reviewed_at = now()
  WHERE id = p_submission_id;

  INSERT INTO audit_log(actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    p_admin_id,
    'approve_submission',
    'submissions',
    p_submission_id,
    jsonb_build_object('amount_cents', v_ask_cents, 'sponsor_id', v_sponsor.id)
  );

  v_token_plain := encode(gen_random_bytes(32), 'hex');
  v_token_hash  := encode(digest(v_token_plain, 'sha256'), 'hex');

  INSERT INTO submission_access_tokens(submission_id, token_hash, expires_at)
  VALUES (p_submission_id, v_token_hash, now() + interval '14 days');

  RETURN jsonb_build_object('ok', true, 'token', v_token_plain, 'amount_cents', v_ask_cents);
END;
$$;
