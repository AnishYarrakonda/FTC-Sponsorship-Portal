-- Production Hardening & Logic Fixes

-- 1. The 'dispatched' submission_status value is pre-declared in 0008, so the
--    ALTER TYPE ... ADD VALUE that used to live here is no longer needed.
--    (Admin approval → 'dispatched' (sent to sponsor); sponsor approval → 'approved'.)

-- 2. Add requested_amount_cents to submissions
-- Snapshots the financial ask at the time of submission to prevent retroactive changes.
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS requested_amount_cents bigint NOT NULL DEFAULT 0;

-- Backfill requested_amount_cents from teams
UPDATE submissions s
SET requested_amount_cents = t.financial_ask_cents
FROM teams t
WHERE s.team_id = t.id AND s.requested_amount_cents = 0;

-- 3. Sponsor Applications Uniqueness
ALTER TABLE sponsor_applications DROP CONSTRAINT IF EXISTS sponsor_apps_email_unique;
ALTER TABLE sponsor_applications ADD CONSTRAINT sponsor_apps_email_unique UNIQUE (contact_email);

-- 4. Update approve_submission_atomic to use 'dispatched' and snapshot amount
CREATE OR REPLACE FUNCTION approve_submission_atomic(
  p_submission_id  uuid,
  p_admin_id       uuid,
  p_amount_cents   bigint DEFAULT 0
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

  -- Transition to 'dispatched' and snapshot the amount
  UPDATE submissions
  SET 
    status = 'dispatched', 
    reviewed_by = p_admin_id, 
    reviewed_at = now(),
    requested_amount_cents = v_ask_cents
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

-- 5. Update sponsor_decide_submission_atomic to transition from 'dispatched' to 'approved'
CREATE OR REPLACE FUNCTION sponsor_decide_submission_atomic(
  p_submission_id uuid,
  p_sponsor_user_id uuid,
  p_decision text, -- 'approved' | 'declined' | 'changes_requested'
  p_feedback text DEFAULT NULL,
  p_amount_cents bigint DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile profiles%ROWTYPE;
  v_submission submissions%ROWTYPE;
  v_sponsor sponsors%ROWTYPE;
  v_team teams%ROWTYPE;
  v_amount bigint;
BEGIN
  SELECT * INTO v_profile
  FROM profiles
  WHERE id = p_sponsor_user_id;

  IF NOT FOUND OR v_profile.role <> 'sponsor' OR v_profile.sponsor_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  SELECT * INTO v_submission
  FROM submissions
  WHERE id = p_submission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'submission_not_found');
  END IF;

  IF v_submission.sponsor_id <> v_profile.sponsor_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  -- Sponsors can only act on 'dispatched' submissions (or 'approved' if we allow editing, but let's stick to state machine)
  IF v_submission.status NOT IN ('dispatched', 'approved') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status');
  END IF;

  IF p_decision = 'declined' OR p_decision = 'changes_requested' THEN
    UPDATE submissions
    SET
      status = p_decision::submission_status,
      admin_feedback = NULLIF(p_feedback, ''),
      reviewed_by = p_sponsor_user_id,
      reviewed_at = now()
    WHERE id = p_submission_id;

    INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata)
    VALUES (
      p_sponsor_user_id,
      CASE WHEN p_decision = 'declined' THEN 'sponsor_decline_submission' ELSE 'sponsor_request_changes_submission' END,
      'submissions',
      p_submission_id,
      jsonb_build_object('sponsor_id', v_profile.sponsor_id)
    );

    RETURN jsonb_build_object('ok', true);
  END IF;

  IF p_decision <> 'approved' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status');
  END IF;

  -- Prevent double-funding if already approved
  IF EXISTS (
    SELECT 1
    FROM transactions_ledger tl
    WHERE tl.submission_id = p_submission_id
      AND tl.actor_type = 'sponsor'
      AND tl.decision_type IN ('full', 'partial')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_decided');
  END IF;

  SELECT * INTO v_sponsor
  FROM sponsors
  WHERE id = v_profile.sponsor_id
  FOR UPDATE;

  -- Use snapshotted amount if possible
  v_amount := CASE 
    WHEN p_amount_cents > 0 THEN p_amount_cents 
    WHEN v_submission.requested_amount_cents > 0 THEN v_submission.requested_amount_cents
    ELSE (SELECT financial_ask_cents FROM teams WHERE id = v_submission.team_id)
  END;

  IF v_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'amount_required');
  END IF;

  IF v_sponsor.funding_used_cents + v_amount > v_sponsor.funding_cap_cents THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_capacity');
  END IF;

  UPDATE submissions
  SET
    status = 'approved',
    admin_feedback = NULLIF(p_feedback, ''),
    reviewed_by = p_sponsor_user_id,
    reviewed_at = now(),
    requested_amount_cents = v_amount -- update if partial
  WHERE id = p_submission_id;

  UPDATE sponsors
  SET
    funding_used_cents = funding_used_cents + v_amount,
    status = CASE
      WHEN funding_used_cents + v_amount >= funding_cap_cents THEN 'inactive'::sponsor_status
      ELSE status
    END
  WHERE id = v_profile.sponsor_id;

  INSERT INTO transactions_ledger (sponsor_id, team_id, submission_id, amount_cents, decision_type, actor_type)
  VALUES (
    v_profile.sponsor_id,
    v_submission.team_id,
    p_submission_id,
    v_amount,
    CASE WHEN v_amount < v_submission.requested_amount_cents THEN 'partial' ELSE 'full' END,
    'sponsor'
  );

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    p_sponsor_user_id,
    'sponsor_approve_submission',
    'submissions',
    p_submission_id,
    jsonb_build_object('sponsor_id', v_profile.sponsor_id, 'amount_cents', v_amount)
  );

  RETURN jsonb_build_object('ok', true, 'amount_cents', v_amount);
END;
$$;

-- 6. Update v_submission_summary to use requested_amount_cents
DROP VIEW IF EXISTS v_submission_summary;
CREATE OR REPLACE VIEW v_submission_summary 
  WITH (security_invoker = true)
AS
SELECT 
  s.id, 
  t.team_name, 
  t.owner_id, 
  sp.company_name,
  s.status, 
  s.admin_feedback, 
  s.is_locked,
  s.season,
  s.requested_amount_cents, 
  s.created_at, 
  s.updated_at
FROM submissions s
JOIN teams t ON t.id = s.team_id
JOIN sponsors sp ON sp.id = s.sponsor_id;

