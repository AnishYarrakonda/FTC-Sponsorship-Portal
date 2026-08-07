-- 0071_token_decision_check_status_first.sql
-- =====================================================================================
-- `record_sponsor_decision_atomic` — the RPC behind the emailed /sponsor-view/[token]
-- link — CLAIMS THE SINGLE-USE TOKEN BEFORE it checks whether the submission can still
-- be decided.
--
-- 0047:198-219, in order:
--   1. UPDATE submission_access_tokens SET used_at = now() WHERE token_hash = ... -- burned
--   2. SELECT ... FROM submissions FOR UPDATE
--   3. IF status NOT IN ('dispatched','delivered','opened') -> RETURN invalid_status
--
-- So a sponsor who clicks Approve on a pitch that has since moved on gets an error AND a
-- permanently dead link, because step 1 already consumed the token. There is no recovery:
-- remint_submission_access_token (0070:62) refuses anything outside the live states, and
-- the reservation for a `bounced` pitch has already been released.
--
-- Reachable, and not rare — the token stays live and unrevoked in both cases:
--   * `bounced`  — app/api/webhooks/resend/route.ts:106 flips the status and releases the
--                  reservation, but never revokes the access token.
--   * `declined` / `changes_requested` decided in the sponsor PORTAL —
--                  sponsor_decide_submission_atomic never touches submission_access_tokens.
--
-- Fix: resolve the token WITHOUT consuming it, validate the submission, and only then
-- claim it. The claim remains a conditional single-statement UPDATE, so the concurrency
-- property that mattered — two simultaneous clicks, exactly one winner — is preserved:
-- the loser's UPDATE matches zero rows and it bails with token_used.
--
-- Everything else in the body is byte-identical to 0047:181-266.
--
-- APPLY WITH:  psql "$DATABASE_URL" -f supabase/migrations/0071_token_decision_check_status_first.sql
-- Idempotent: CREATE OR REPLACE.
-- =====================================================================================

CREATE OR REPLACE FUNCTION record_sponsor_decision_atomic(
  p_token_hash text,
  p_decision text,                          -- 'full' | 'partial' | 'decline'
  p_partial_amount_cents bigint DEFAULT 0
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_token_id      uuid;
  v_submission_id uuid;
  v_submission    submissions%ROWTYPE;
  v_reserved      bigint;
  v_amount        bigint;
  v_decision_type text;
BEGIN
  -- 1. RESOLVE the token without consuming it.
  SELECT id, submission_id INTO v_token_id, v_submission_id
    FROM submission_access_tokens
   WHERE token_hash = p_token_hash
     AND used_at IS NULL
     AND revoked_at IS NULL
     AND expires_at > now();

  IF v_token_id IS NULL THEN
    PERFORM 1 FROM submission_access_tokens WHERE token_hash = p_token_hash;
    IF FOUND THEN RETURN json_build_object('ok', false, 'error', 'token_used'); END IF;
    RETURN json_build_object('ok', false, 'error', 'invalid_token');
  END IF;

  -- 2. VALIDATE the submission BEFORE burning anything. This is the whole fix: a sponsor
  --    who arrives at a pitch that has already moved on now keeps a usable link.
  SELECT * INTO v_submission FROM submissions WHERE id = v_submission_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'submission_not_found');
  END IF;
  IF v_submission.status NOT IN ('dispatched', 'delivered', 'opened') THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_status',
                             'current_status', v_submission.status);
  END IF;

  -- 3. CLAIM the token. Still a single conditional UPDATE, so of two concurrent callers
  --    exactly one matches a row; the loser sees zero rows and stops here.
  UPDATE submission_access_tokens
     SET used_at = now()
   WHERE id = v_token_id
     AND used_at IS NULL
     AND revoked_at IS NULL;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'token_used');
  END IF;

  v_reserved := COALESCE(v_submission.reserved_amount_cents, 0);

  IF p_decision = 'decline' THEN
    PERFORM release_submission_reservation(v_submission_id, 'declined', 'sponsor_decline');
    RETURN json_build_object('ok', true);
  END IF;

  -- SETTLE. Funds are already reserved, so we never debit again; clamp partial to the
  -- reserved amount (a sponsor cannot fund more than the reserved ask).
  IF p_decision = 'partial' AND p_partial_amount_cents > 0 AND p_partial_amount_cents < v_reserved THEN
    v_amount := p_partial_amount_cents;
    v_decision_type := 'partial';
  ELSE
    v_amount := v_reserved;
    v_decision_type := 'full';
  END IF;

  IF v_amount <= 0 THEN
    RETURN json_build_object('ok', false, 'error', 'amount_required');
  END IF;

  -- Release the unfunded difference on a partial settlement.
  IF v_amount < v_reserved THEN
    UPDATE sponsors
       SET funding_used_cents = GREATEST(funding_used_cents - (v_reserved - v_amount), 0),
           status = CASE WHEN status = 'inactive'
                          AND (funding_used_cents - (v_reserved - v_amount)) < funding_cap_cents
                         THEN 'active'::sponsor_status ELSE status END
     WHERE id = v_submission.sponsor_id;
  END IF;

  UPDATE submissions
     SET status = 'approved', reviewed_at = now(), reserved_amount_cents = v_amount
   WHERE id = v_submission_id;

  INSERT INTO transactions_ledger (sponsor_id, team_id, submission_id, amount_cents, decision_type, actor_type)
  VALUES (v_submission.sponsor_id, v_submission.team_id, v_submission_id, v_amount, v_decision_type, 'sponsor');

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata)
  VALUES (NULL, 'sponsor_accept', 'submissions', v_submission_id,
          jsonb_build_object('sponsor_id', v_submission.sponsor_id, 'amount_cents', v_amount,
                             'decision_type', v_decision_type));

  RETURN json_build_object('ok', true, 'amount_cents', v_amount);
END;
$$;

-- 0062 revokes by name and therefore already covers this function, but this file may be
-- applied on its own — keep the grants explicit and idempotent.
REVOKE EXECUTE ON FUNCTION record_sponsor_decision_atomic(text, text, bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION record_sponsor_decision_atomic(text, text, bigint) FROM anon;
REVOKE EXECUTE ON FUNCTION record_sponsor_decision_atomic(text, text, bigint) FROM authenticated;
GRANT  EXECUTE ON FUNCTION record_sponsor_decision_atomic(text, text, bigint) TO service_role;

-- =====================================================================================
-- VERIFICATION (scratch project)
-- 1. Dispatch a pitch, then flip it to 'bounced' (or decline it in the sponsor portal).
--    Open the emailed /sponsor-view/<token> link and press Approve.
--    -> expect {"ok":false,"error":"invalid_status"} AND submission_access_tokens.used_at
--       still NULL for that token. Before this fix used_at was stamped and the link died.
-- 2. Happy path unchanged: a 'dispatched' pitch approves once, writes one ledger row, and
--    the token's used_at is set.
-- 3. Concurrency unchanged: fire two simultaneous Approves on one token — exactly one
--    succeeds, the other returns token_used, and only one ledger row exists.
-- =====================================================================================
