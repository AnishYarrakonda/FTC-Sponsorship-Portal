-- 0100 — legacy submissions bypassed the sponsor cap entirely (audit A-04-01, P0)
--
-- CAPACITY INTEGRITY (Core Mandate). Reproduced on a local stack before writing this:
-- with funding_cap_cents = 100000 and funding_used_cents = 0, a submission in status
-- 'dispatched' carrying reserved_amount_cents = 0 was funded for 900000 and the call
-- returned {"ok": true}. A 900000 row landed in transactions_ledger, funding_used_cents
-- stayed 0, and detect_capacity_drift() reported drift_cents = -900000.
--
-- Mechanism (the audit misdescribed this; the real cause is narrower):
-- the whole capacity block was guarded by
--     IF v_amount < COALESCE(v_submission.reserved_amount_cents, 0)
-- which only ever fires when the sponsor funds LESS than was reserved — the RELEASE case.
-- Reservation normally happens at admin approval (approve_submission_atomic sets both
-- funding_used_cents and reserved_amount_cents together), so for those rows delta <= 0 and
-- the old guard was sufficient. But a submission whose reserved_amount_cents is 0 or NULL
-- holds nothing, so the *entire* funded amount is new capacity — and with delta > 0 the
-- guard was false, skipping both the cap check and the funding_used_cents increment while
-- still writing the full amount to the ledger.
--
-- Fix: reconcile the signed delta instead of only the negative half.
--   delta > 0  -> new capacity: lock the sponsor, enforce the cap, increment.
--   delta < 0  -> unchanged release path.
--   delta = 0  -> nothing, the common case for a normally-reserved full decision.
--
-- 'insufficient_capacity' is the error code mapDecisionError() (lib/decision-followup.ts)
-- already maps for this path. The cap check and the inactive-status flip mirror
-- approve_submission_atomic exactly, so the two entry points cannot drift.
--
-- Body below is the LIVE definition dumped with pg_get_functiondef; only the capacity
-- block and the DECLARE list are changed.

CREATE OR REPLACE FUNCTION public.sponsor_decide_submission_atomic(p_submission_id uuid, p_sponsor_user_id uuid, p_decision text, p_feedback text DEFAULT NULL::text, p_amount_cents bigint DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_profile    profiles%ROWTYPE;
  v_submission submissions%ROWTYPE;
  v_actor_id   uuid;
  v_reserved   bigint;
  v_amount     bigint;
  v_decision_type text;
  v_txn_id     uuid;
  v_fulfillment_id uuid;
  v_prior_reserved bigint;
  v_delta      bigint;
  v_sponsor    sponsors%ROWTYPE;
BEGIN
  IF (auth.jwt() ->> 'sub') IS NOT NULL THEN
    v_actor_id := current_profile_id();
    IF v_actor_id IS NULL OR v_actor_id <> p_sponsor_user_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
    END IF;
  ELSE
    v_actor_id := p_sponsor_user_id;
  END IF;

  SELECT * INTO v_profile FROM profiles WHERE id = v_actor_id;
  IF NOT FOUND OR v_profile.role <> 'sponsor' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  SELECT * INTO v_submission FROM submissions WHERE id = p_submission_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'submission_not_found'); END IF;
  IF v_submission.sponsor_id IS NULL
     OR NOT (v_submission.sponsor_id = ANY (sponsor_ids_for_profile(v_actor_id))) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  IF v_submission.status NOT IN ('dispatched', 'delivered', 'opened') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status');
  END IF;

  v_reserved := COALESCE(v_submission.reserved_amount_cents, 0);

  IF p_decision IN ('declined', 'changes_requested') THEN
    PERFORM release_submission_reservation(
      p_submission_id,
      p_decision,
      CASE WHEN p_decision = 'declined' THEN 'sponsor_decline' ELSE 'sponsor_changes_requested' END
    );
    UPDATE submissions
       SET admin_feedback = NULLIF(p_feedback, ''), reviewed_by = v_actor_id
     WHERE id = p_submission_id;
    INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_actor_id,
            CASE WHEN p_decision = 'declined' THEN 'sponsor_decline_submission'
                 ELSE 'sponsor_request_changes_submission' END,
            'submissions', p_submission_id,
            jsonb_build_object('sponsor_id', v_submission.sponsor_id));
    RETURN jsonb_build_object('ok', true);
  END IF;

  IF p_decision <> 'approved' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status');
  END IF;

  IF EXISTS (
    SELECT 1 FROM transactions_ledger tl
     WHERE tl.submission_id = p_submission_id AND tl.actor_type = 'sponsor'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_decided');
  END IF;

  IF v_reserved <= 0 THEN
    v_reserved := COALESCE(v_submission.requested_amount_cents, 0);
  END IF;

  IF p_amount_cents > 0 AND p_amount_cents < v_reserved THEN
    v_amount := p_amount_cents;
    v_decision_type := 'partial';
  ELSE
    v_amount := v_reserved;
    v_decision_type := 'full';
  END IF;

  IF v_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'amount_required');
  END IF;

  -- Capacity reconciliation against what this submission ALREADY holds. Note this reads
  -- v_submission.reserved_amount_cents (the true prior reservation), NOT v_reserved, which
  -- has been overwritten with the requested amount by the fallback above.
  v_prior_reserved := COALESCE(v_submission.reserved_amount_cents, 0);
  v_delta := v_amount - v_prior_reserved;

  IF v_delta > 0 THEN
    -- Committing MORE than is reserved. For a legacy row (reserved 0/NULL) that is the
    -- entire amount, and nothing has checked it against the cap yet.
    SELECT * INTO v_sponsor FROM sponsors WHERE id = v_submission.sponsor_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'submission_not_found');
    END IF;

    IF (v_sponsor.funding_used_cents + v_delta) > v_sponsor.funding_cap_cents THEN
      RETURN jsonb_build_object('ok', false, 'error', 'insufficient_capacity');
    END IF;

    UPDATE sponsors
       SET funding_used_cents = funding_used_cents + v_delta,
           status = CASE WHEN funding_used_cents + v_delta >= funding_cap_cents
                         THEN 'inactive'::sponsor_status ELSE status END
     WHERE id = v_submission.sponsor_id;

  ELSIF v_delta < 0 THEN
    -- Funded less than reserved: release the unused remainder. Unchanged behaviour.
    UPDATE sponsors
       SET funding_used_cents =
             GREATEST(funding_used_cents - (v_prior_reserved - v_amount), 0),
           status = CASE
             WHEN status = 'inactive'
              AND (funding_used_cents - (v_prior_reserved - v_amount)) < funding_cap_cents
             THEN 'active'::sponsor_status ELSE status END
     WHERE id = v_submission.sponsor_id;
  END IF;

  UPDATE submissions
     SET status = 'approved',
         admin_feedback = NULLIF(p_feedback, ''),
         reviewed_by = v_actor_id,
         reviewed_at = now(),
         reserved_amount_cents = v_amount
   WHERE id = p_submission_id;

  INSERT INTO transactions_ledger (sponsor_id, team_id, submission_id, amount_cents, decision_type, actor_type)
  VALUES (v_submission.sponsor_id, v_submission.team_id, p_submission_id, v_amount, v_decision_type, 'sponsor')
  RETURNING id INTO v_txn_id;

  INSERT INTO funding_fulfillments
    (transaction_id, sponsor_id, team_id, submission_id, amount_cents, status)
  VALUES (v_txn_id, v_submission.sponsor_id, v_submission.team_id, p_submission_id, v_amount, 'pledged')
  RETURNING id INTO v_fulfillment_id;

  INSERT INTO funding_fulfillment_events
    (fulfillment_id, from_status, to_status, actor_profile_id, actor_role, metadata)
  VALUES (v_fulfillment_id, NULL, 'pledged', v_actor_id, 'system',
          jsonb_build_object('source', 'portal_settle'));

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor_id, 'sponsor_approve_submission', 'submissions', p_submission_id,
          jsonb_build_object('sponsor_id', v_submission.sponsor_id,
                             'amount_cents', v_amount,
                             'decision_type', v_decision_type));

  RETURN jsonb_build_object('ok', true, 'amount_cents', v_amount);
END;
$function$

;
