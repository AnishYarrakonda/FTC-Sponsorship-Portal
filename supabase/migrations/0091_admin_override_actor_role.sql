-- 0091_admin_override_actor_role.sql
--
-- Fixes: an admin override of a funding fulfillment always failed with `unauthorized`.
--
-- `record_fulfillment_transition` resolved the actor's role three different ways: sponsor
-- and coach were read from the `profiles` / `teams` rows for `p_actor_profile_id`, but
-- admin was read from the CALLER'S JWT via `is_admin()`. The only call site for an override
-- is `adminOverrideFulfillmentStatus` in app/actions/fulfillment.ts, which — correctly, per
-- the repo's own rules — goes through the service-role client. A service-role connection
-- carries no Clerk `sub`, so `is_admin()` is false there by construction. The actor then
-- matched no branch and the function returned `unauthorized`, meaning:
--
--   * no admin could ever move a stuck fulfillment back to `pledged`
--   * no admin could force `payment_received`, `receipted`, or `cancelled`
--
-- The authorization is not weakened: `v_actor` has already been proven above to be either
-- the JWT-verified caller (`v_actor = current_profile_id()`) or an id supplied by a trusted
-- server context. Reading its role from `profiles` is exactly what the sponsor and coach
-- branches already do; this only makes admin consistent with them.
--
-- Body is otherwise copied verbatim from 0080. Apply with `psql -f` (multiple $$ bodies).

CREATE OR REPLACE FUNCTION record_fulfillment_transition(
  p_fulfillment_id    uuid,
  p_actor_profile_id  uuid,
  p_to_status         fulfillment_status,
  p_payment_method    fulfillment_payment_method DEFAULT NULL,
  p_payment_reference text  DEFAULT NULL,
  p_occurred_on       date  DEFAULT NULL,
  p_note              text  DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor      uuid;
  v_f          funding_fulfillments%ROWTYPE;
  v_actor_role text;
  v_occurred   timestamptz;
BEGIN
  IF (auth.jwt() ->> 'sub') IS NOT NULL THEN
    v_actor := current_profile_id();
    IF v_actor IS NULL OR v_actor <> p_actor_profile_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
    END IF;
  ELSIF is_trusted_server_context() THEN
    v_actor := p_actor_profile_id;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  SELECT * INTO v_f FROM funding_fulfillments WHERE id = p_fulfillment_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'fulfillment_not_found');
  END IF;

  IF is_admin()
     OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = v_actor AND p.role = 'admin') THEN
    v_actor_role := 'admin';
  ELSIF EXISTS (SELECT 1 FROM profiles p WHERE p.id = v_actor AND p.role = 'sponsor' AND p.sponsor_id = v_f.sponsor_id) THEN
    v_actor_role := 'sponsor';
  ELSIF v_f.team_id IS NOT NULL AND EXISTS (SELECT 1 FROM teams t WHERE t.id = v_f.team_id AND t.owner_id = v_actor) THEN
    v_actor_role := 'coach';
  ELSIF is_trusted_server_context() AND p_actor_profile_id IS NULL THEN
    v_actor_role := 'system';
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  IF v_f.status = p_to_status THEN
    RETURN jsonb_build_object('ok', true, 'status', p_to_status, 'from_status', v_f.status, 'error', 'already_in_status');
  END IF;

  IF v_f.status = 'receipted' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'receipt_issued');
  END IF;
  IF v_f.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_cancelled');
  END IF;

  IF p_to_status = 'agreement_signed' THEN
    IF v_f.status <> 'pledged' OR v_actor_role NOT IN ('admin', 'system') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'illegal_transition', 'from_status', v_f.status, 'to_status', p_to_status);
    END IF;
  ELSIF p_to_status = 'payment_sent' THEN
    IF v_f.status = 'pledged' OR v_f.status = 'agreement_signed' THEN
      IF v_actor_role NOT IN ('sponsor', 'admin') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'illegal_transition', 'from_status', v_f.status, 'to_status', p_to_status);
      END IF;
    ELSIF v_f.status = 'payment_received' THEN
      IF v_actor_role <> 'admin' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'illegal_transition', 'from_status', v_f.status, 'to_status', p_to_status);
      END IF;
    ELSE
      RETURN jsonb_build_object('ok', false, 'error', 'illegal_transition', 'from_status', v_f.status, 'to_status', p_to_status);
    END IF;
    IF p_payment_method IS NULL AND v_f.payment_method IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'payment_details_required');
    END IF;
    -- PROMPT 06 GATE: no fulfillment may reach payment_sent — from any prior status —
    -- until both parties have executed the sponsorship agreement for its submission.
    IF v_f.submission_id IS NOT NULL AND NOT agreement_is_signed(v_f.submission_id) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'agreement_not_signed');
    END IF;
  ELSIF p_to_status = 'cancelled' THEN
    IF v_f.status = 'pledged' OR v_f.status = 'agreement_signed' THEN
      IF v_actor_role NOT IN ('sponsor', 'admin') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'illegal_transition', 'from_status', v_f.status, 'to_status', p_to_status);
      END IF;
    ELSIF v_f.status = 'payment_sent' THEN
      IF v_actor_role <> 'admin' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'illegal_transition', 'from_status', v_f.status, 'to_status', p_to_status);
      END IF;
    ELSE
      RETURN jsonb_build_object('ok', false, 'error', 'illegal_transition', 'from_status', v_f.status, 'to_status', p_to_status);
    END IF;
  ELSIF p_to_status = 'payment_received' THEN
    IF v_f.status <> 'payment_sent' OR v_actor_role NOT IN ('coach', 'admin') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'illegal_transition', 'from_status', v_f.status, 'to_status', p_to_status);
    END IF;
  ELSIF p_to_status = 'pledged' THEN
    IF v_f.status <> 'payment_sent' OR v_actor_role <> 'admin' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'illegal_transition', 'from_status', v_f.status, 'to_status', p_to_status);
    END IF;
  ELSIF p_to_status = 'receipted' THEN
    IF v_f.status <> 'payment_received' OR v_actor_role NOT IN ('admin', 'system') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'illegal_transition', 'from_status', v_f.status, 'to_status', p_to_status);
    END IF;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'illegal_transition', 'from_status', v_f.status, 'to_status', p_to_status);
  END IF;

  v_occurred := COALESCE(p_occurred_on::timestamptz, now());
  IF v_occurred::date > current_date THEN
    RETURN jsonb_build_object('ok', false, 'error', 'future_date');
  END IF;

  UPDATE funding_fulfillments
     SET status = p_to_status,
         agreement_signed_at = CASE WHEN p_to_status = 'agreement_signed' THEN v_occurred ELSE agreement_signed_at END,
         payment_sent_at     = CASE WHEN p_to_status = 'payment_sent' THEN v_occurred ELSE payment_sent_at END,
         payment_received_at = CASE WHEN p_to_status = 'payment_received' THEN v_occurred ELSE payment_received_at END,
         receipted_at        = CASE WHEN p_to_status = 'receipted' THEN v_occurred ELSE receipted_at END,
         cancelled_at        = CASE WHEN p_to_status = 'cancelled' THEN v_occurred ELSE cancelled_at END,
         cancelled_reason    = CASE WHEN p_to_status = 'cancelled' THEN COALESCE(p_note, cancelled_reason) ELSE cancelled_reason END,
         payment_method      = COALESCE(p_payment_method, payment_method),
         payment_reference   = COALESCE(p_payment_reference, payment_reference),
         updated_at          = now()
   WHERE id = p_fulfillment_id;

  INSERT INTO funding_fulfillment_events
    (fulfillment_id, from_status, to_status, actor_profile_id, actor_role, note, metadata)
  VALUES (p_fulfillment_id, v_f.status, p_to_status, v_actor, v_actor_role, p_note,
          jsonb_build_object('payment_method', COALESCE(p_payment_method, v_f.payment_method), 'occurred_on', v_occurred::date));

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor, 'fulfillment_transition', 'funding_fulfillments', p_fulfillment_id,
          jsonb_build_object('from', v_f.status, 'to', p_to_status, 'actor_role', v_actor_role, 'amount_cents', v_f.amount_cents, 'sponsor_id', v_f.sponsor_id));

  RETURN jsonb_build_object('ok', true, 'status', p_to_status, 'from_status', v_f.status);
END;
$$;

-- Replacing a function does not preserve a REVOKE you did not re-issue.
REVOKE EXECUTE ON FUNCTION record_fulfillment_transition(uuid, uuid, fulfillment_status, fulfillment_payment_method, text, date, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION record_fulfillment_transition(uuid, uuid, fulfillment_status, fulfillment_payment_method, text, date, text) FROM anon;
REVOKE EXECUTE ON FUNCTION record_fulfillment_transition(uuid, uuid, fulfillment_status, fulfillment_payment_method, text, date, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION record_fulfillment_transition(uuid, uuid, fulfillment_status, fulfillment_payment_method, text, date, text) TO service_role;

