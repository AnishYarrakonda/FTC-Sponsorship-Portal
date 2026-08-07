-- 0070_remint_submission_access_token.sql
-- =====================================================================================
-- P0-11 (second half): an approved-but-undelivered pitch cannot be retried AT ALL.
--
-- approve_submission_atomic has already debited the sponsor's cap, written the audit
-- row, minted the access token and moved the submission to 'dispatched'. If Resend then
-- returns 429/5xx, dispatchApprovedSubmission returns {success:false} and there is no
-- way back: re-approving is impossible (the RPC asserts status='pending', which no
-- longer holds) and no re-dispatch action exists. Capacity is consumed, the coach was
-- told it was approved, and the sponsor never received anything.
--
-- The blocker for a retry is the TOKEN. approve_submission_atomic returns the plaintext
-- exactly once and stores only sha256(token); it is unrecoverable afterwards. So the
-- retry has to mint a fresh one, which is what this function does — atomically revoking
-- the old unused tokens so a resend never leaves two live links to the same pitch.
--
-- EXECUTE is granted to service_role only, consistent with 0062.
--
-- APPLY WITH:  psql "$DATABASE_URL" -f supabase/migrations/0070_remint_submission_access_token.sql
-- Idempotent: CREATE OR REPLACE.
-- =====================================================================================

CREATE OR REPLACE FUNCTION remint_submission_access_token(
  p_submission_id uuid,
  p_admin_id      uuid
)
RETURNS jsonb
-- search_path includes `extensions` for the same reason 0059 widened
-- approve_submission_atomic: pgcrypto lives there on Supabase, so gen_random_bytes()
-- and digest() cannot resolve under a public-only search_path.
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_submission  submissions%ROWTYPE;
  v_actor_id    uuid;
  v_actor_role  text;
  v_token_plain text;
  v_token_hash  text;
  v_expires     timestamptz;
BEGIN
  -- Same context-aware actor check as 0062 (see its header for why asserting
  -- is_admin() unconditionally would break the only real caller).
  IF (auth.jwt() ->> 'sub') IS NOT NULL THEN
    v_actor_id := current_profile_id();
    IF v_actor_id IS NULL OR NOT is_admin() THEN
      RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
    END IF;
  ELSE
    SELECT id, role INTO v_actor_id, v_actor_role FROM profiles WHERE id = p_admin_id;
    IF v_actor_id IS NULL OR v_actor_role <> 'admin' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
    END IF;
  END IF;

  SELECT * INTO v_submission FROM submissions WHERE id = p_submission_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'submission_not_found'); END IF;

  -- Only a pitch that is genuinely awaiting the sponsor may be re-sent. Notably this
  -- EXCLUDES 'approved' — re-sending a decision link for a settled deal would let the
  -- sponsor decide twice — and excludes 'expired'/'bounced', whose reservations have
  -- already been released.
  IF v_submission.status NOT IN ('dispatched', 'delivered', 'opened') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_redispatchable',
                              'current_status', v_submission.status);
  END IF;

  -- Preserve the original deadline rather than silently extending the sponsor's window
  -- on every retry; fall back to a fresh 14 days only if it was never set.
  v_expires := COALESCE(v_submission.expires_at, now() + interval '14 days');
  IF v_expires <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'submission_expired');
  END IF;

  -- Exactly one live link per pitch.
  UPDATE submission_access_tokens
     SET revoked_at = now()
   WHERE submission_id = p_submission_id
     AND used_at IS NULL
     AND revoked_at IS NULL;

  v_token_plain := encode(gen_random_bytes(32), 'hex');
  v_token_hash  := encode(digest(v_token_plain, 'sha256'), 'hex');
  INSERT INTO submission_access_tokens(submission_id, token_hash, expires_at)
  VALUES (p_submission_id, v_token_hash, v_expires);

  INSERT INTO audit_log(actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor_id, 'remint_access_token', 'submissions', p_submission_id,
          jsonb_build_object('reason', 'redispatch', 'expires_at', v_expires));

  RETURN jsonb_build_object('ok', true, 'token', v_token_plain);
END;
$$;

REVOKE EXECUTE ON FUNCTION remint_submission_access_token(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION remint_submission_access_token(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION remint_submission_access_token(uuid, uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION remint_submission_access_token(uuid, uuid) TO service_role;

-- =====================================================================================
-- VERIFICATION
-- 1. Anon must not be able to call it:
--      curl -X POST "$SUPABASE_URL/rest/v1/rpc/remint_submission_access_token" \
--        -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' \
--        -d '{"p_submission_id":"00000000-0000-0000-0000-000000000000",
--             "p_admin_id":"00000000-0000-0000-0000-000000000000"}'
--      -> expect 42501
-- 2. Admin flow: approve a pitch, then use "Resend to sponsor" in /moderation.
--    - a NEW row appears in submission_access_tokens; the previous unused one has
--      revoked_at set.
--    - the old /sponsor-view/<old-token> link now 404s; the new one works.
--    - sponsors.funding_used_cents does NOT move (no second reservation).
--    - audit_log gains a 'remint_access_token' row.
-- 3. Re-dispatching an 'approved' submission must return not_redispatchable.
-- =====================================================================================
