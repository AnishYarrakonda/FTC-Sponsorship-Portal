-- 0076_funding_fulfillments.sql
-- =====================================================================================
-- Funding fulfillments state machine.
-- Tracks a commitment from pledged -> agreement_signed -> payment_sent -> payment_received -> receipted.
--
-- ── !! PRE-APPLY CHECK FOR THE HUMAN !! ──────────────────────────────────────────────
-- This file REPLACES the whole function bodies of `sponsor_decide_submission_atomic`
-- and `record_sponsor_decision_atomic` to hook into the settle path.
-- Before applying, run:
--
--   SELECT pg_get_functiondef(p.oid)
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname='public' AND p.proname IN ('sponsor_decide_submission_atomic','record_sponsor_decision_atomic');
--
-- If either body differs from 0065/0071 by anything other than whitespace, STOP and
-- report the diff before applying.
--
-- APPLY WITH:  psql "$DATABASE_URL" -f supabase/migrations/0076_funding_fulfillments.sql
-- Idempotent: CREATE OR REPLACE.
-- =====================================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fulfillment_status') THEN
    CREATE TYPE fulfillment_status AS ENUM (
      'pledged', 'agreement_signed', 'payment_sent', 'payment_received',
      'receipted', 'cancelled'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fulfillment_payment_method') THEN
    CREATE TYPE fulfillment_payment_method AS ENUM ('check', 'ach', 'wire', 'other');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS funding_fulfillments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id      uuid NOT NULL UNIQUE REFERENCES transactions_ledger(id) ON DELETE RESTRICT,
  sponsor_id          uuid NOT NULL REFERENCES sponsors(id)    ON DELETE RESTRICT,
  team_id             uuid          REFERENCES teams(id)       ON DELETE SET NULL,
  submission_id       uuid          REFERENCES submissions(id) ON DELETE SET NULL,
  amount_cents        bigint NOT NULL CHECK (amount_cents > 0),
  status              fulfillment_status NOT NULL DEFAULT 'pledged',
  payment_method      fulfillment_payment_method,
  payment_reference   text CHECK (payment_reference IS NULL OR char_length(payment_reference) <= 64),
  expected_by         date,
  notes               text CHECK (notes IS NULL OR char_length(notes) <= 1000),
  pledged_at          timestamptz NOT NULL DEFAULT now(),
  agreement_signed_at timestamptz,
  payment_sent_at     timestamptz,
  payment_received_at timestamptz,
  receipted_at        timestamptz,
  cancelled_at        timestamptz,
  cancelled_reason    text,
  last_nudged_at      timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fulfillments_sponsor    ON funding_fulfillments(sponsor_id);
CREATE INDEX IF NOT EXISTS idx_fulfillments_team       ON funding_fulfillments(team_id);
CREATE INDEX IF NOT EXISTS idx_fulfillments_submission ON funding_fulfillments(submission_id);
CREATE INDEX IF NOT EXISTS idx_fulfillments_open
  ON funding_fulfillments(status, pledged_at)
  WHERE status IN ('pledged', 'agreement_signed', 'payment_sent');

CREATE TABLE IF NOT EXISTS funding_fulfillment_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fulfillment_id  uuid NOT NULL REFERENCES funding_fulfillments(id) ON DELETE CASCADE,
  from_status     fulfillment_status,
  to_status       fulfillment_status NOT NULL,
  actor_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  actor_role      text NOT NULL CHECK (actor_role IN ('sponsor', 'coach', 'admin', 'system')),
  note            text CHECK (note IS NULL OR char_length(note) <= 1000),
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fulfillment_events_parent
  ON funding_fulfillment_events(fulfillment_id, created_at DESC);

ALTER TABLE funding_fulfillments ENABLE ROW LEVEL SECURITY;
ALTER TABLE funding_fulfillment_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fulfillments_select_admin ON funding_fulfillments;
CREATE POLICY fulfillments_select_admin ON funding_fulfillments
  FOR SELECT USING (is_admin());

DROP POLICY IF EXISTS fulfillments_select_sponsor ON funding_fulfillments;
CREATE POLICY fulfillments_select_sponsor ON funding_fulfillments
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM profiles p 
     WHERE p.id = current_profile_id() AND p.role = 'sponsor' 
       AND p.sponsor_id IS NOT NULL AND p.sponsor_id = funding_fulfillments.sponsor_id
  ));

DROP POLICY IF EXISTS fulfillments_select_coach ON funding_fulfillments;
CREATE POLICY fulfillments_select_coach ON funding_fulfillments
  FOR SELECT USING (
    funding_fulfillments.team_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM teams t 
       WHERE t.id = funding_fulfillments.team_id AND t.owner_id = current_profile_id()
    )
  );

CREATE OR REPLACE FUNCTION can_read_fulfillment(p_fulfillment_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM funding_fulfillments f
     WHERE f.id = p_fulfillment_id
       AND (
         is_admin()
         OR EXISTS (SELECT 1 FROM profiles p
                     WHERE p.id = current_profile_id() AND p.role = 'sponsor'
                       AND p.sponsor_id IS NOT NULL AND p.sponsor_id = f.sponsor_id)
         OR (f.team_id IS NOT NULL AND EXISTS (
               SELECT 1 FROM teams t WHERE t.id = f.team_id AND t.owner_id = current_profile_id()))
       )
  );
$$;

DROP POLICY IF EXISTS fulfillment_events_select ON funding_fulfillment_events;
CREATE POLICY fulfillment_events_select ON funding_fulfillment_events
  FOR SELECT USING (can_read_fulfillment(fulfillment_id));

-- Transition table (authoritative)
-- From -> To | Who may drive it
-- pledged -> agreement_signed | admin, system
-- pledged -> payment_sent | sponsor, admin
-- pledged -> cancelled | sponsor, admin
-- agreement_signed -> payment_sent | sponsor, admin
-- agreement_signed -> cancelled | sponsor, admin
-- payment_sent -> payment_received | coach, admin
-- payment_sent -> pledged | admin only (correction)
-- payment_sent -> cancelled | admin only
-- payment_received -> receipted | admin, system
-- payment_received -> payment_sent | admin only (correction)
-- receipted -> — | terminal
-- cancelled -> — | terminal
--
-- Notes:
-- - A sponsor can never mark payment_received. A coach can never mark payment_sent and can never cancel.
-- - agreement_signed is a real gate that prompt 06 will wire up. For now pledged -> payment_sent stays legal.
-- - receipted is issued by prompt 04.

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

  IF is_admin() THEN
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

REVOKE EXECUTE ON FUNCTION record_fulfillment_transition(uuid, uuid, fulfillment_status, fulfillment_payment_method, text, date, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION record_fulfillment_transition(uuid, uuid, fulfillment_status, fulfillment_payment_method, text, date, text) FROM anon;
REVOKE EXECUTE ON FUNCTION record_fulfillment_transition(uuid, uuid, fulfillment_status, fulfillment_payment_method, text, date, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION record_fulfillment_transition(uuid, uuid, fulfillment_status, fulfillment_payment_method, text, date, text) TO service_role;


-- Replace sponsor_decide_submission_atomic
CREATE OR REPLACE FUNCTION sponsor_decide_submission_atomic(
  p_submission_id uuid,
  p_sponsor_user_id uuid,
  p_decision text,                 -- 'approved' | 'declined' | 'changes_requested'
  p_feedback text DEFAULT NULL,
  p_amount_cents bigint DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_profile    profiles%ROWTYPE;
  v_submission submissions%ROWTYPE;
  v_actor_id   uuid;
  v_reserved   bigint;
  v_amount     bigint;
  v_decision_type text;
  v_txn_id     uuid;
  v_fulfillment_id uuid;
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
  IF NOT FOUND OR v_profile.role <> 'sponsor' OR v_profile.sponsor_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  SELECT * INTO v_submission FROM submissions WHERE id = p_submission_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'submission_not_found'); END IF;
  IF v_submission.sponsor_id <> v_profile.sponsor_id THEN
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
            jsonb_build_object('sponsor_id', v_profile.sponsor_id));
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

  IF v_amount < COALESCE(v_submission.reserved_amount_cents, 0) THEN
    UPDATE sponsors
       SET funding_used_cents =
             GREATEST(funding_used_cents - (v_submission.reserved_amount_cents - v_amount), 0),
           status = CASE
             WHEN status = 'inactive'
              AND (funding_used_cents - (v_submission.reserved_amount_cents - v_amount)) < funding_cap_cents
             THEN 'active'::sponsor_status ELSE status END
     WHERE id = v_profile.sponsor_id;
  END IF;

  UPDATE submissions
     SET status = 'approved',
         admin_feedback = NULLIF(p_feedback, ''),
         reviewed_by = v_actor_id,
         reviewed_at = now(),
         reserved_amount_cents = v_amount
   WHERE id = p_submission_id;

  INSERT INTO transactions_ledger (sponsor_id, team_id, submission_id, amount_cents, decision_type, actor_type)
  VALUES (v_profile.sponsor_id, v_submission.team_id, p_submission_id, v_amount, v_decision_type, 'sponsor')
  RETURNING id INTO v_txn_id;

  INSERT INTO funding_fulfillments
    (transaction_id, sponsor_id, team_id, submission_id, amount_cents, status)
  VALUES (v_txn_id, v_profile.sponsor_id, v_submission.team_id, p_submission_id, v_amount, 'pledged')
  RETURNING id INTO v_fulfillment_id;

  INSERT INTO funding_fulfillment_events
    (fulfillment_id, from_status, to_status, actor_profile_id, actor_role, metadata)
  VALUES (v_fulfillment_id, NULL, 'pledged', v_actor_id, 'system',
          jsonb_build_object('source', 'portal_settle'));

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor_id, 'sponsor_approve_submission', 'submissions', p_submission_id,
          jsonb_build_object('sponsor_id', v_profile.sponsor_id,
                             'amount_cents', v_amount,
                             'decision_type', v_decision_type));

  RETURN jsonb_build_object('ok', true, 'amount_cents', v_amount);
END;
$$;

-- Replace record_sponsor_decision_atomic
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
  v_txn_id        uuid;
  v_fulfillment_id uuid;
BEGIN
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

  SELECT * INTO v_submission FROM submissions WHERE id = v_submission_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'submission_not_found');
  END IF;
  IF v_submission.status NOT IN ('dispatched', 'delivered', 'opened') THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_status',
                             'current_status', v_submission.status);
  END IF;

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
  VALUES (v_submission.sponsor_id, v_submission.team_id, v_submission_id, v_amount, v_decision_type, 'sponsor')
  RETURNING id INTO v_txn_id;

  INSERT INTO funding_fulfillments
    (transaction_id, sponsor_id, team_id, submission_id, amount_cents, status)
  VALUES (v_txn_id, v_submission.sponsor_id, v_submission.team_id, v_submission_id, v_amount, 'pledged')
  RETURNING id INTO v_fulfillment_id;

  INSERT INTO funding_fulfillment_events
    (fulfillment_id, from_status, to_status, actor_profile_id, actor_role, metadata)
  VALUES (v_fulfillment_id, NULL, 'pledged', NULL, 'system',
          jsonb_build_object('source', 'token_settle'));

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata)
  VALUES (NULL, 'sponsor_accept', 'submissions', v_submission_id,
          jsonb_build_object('sponsor_id', v_submission.sponsor_id, 'amount_cents', v_amount,
                             'decision_type', v_decision_type));

  RETURN json_build_object('ok', true, 'amount_cents', v_amount);
END;
$$;

REVOKE EXECUTE ON FUNCTION record_sponsor_decision_atomic(text, text, bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION record_sponsor_decision_atomic(text, text, bigint) FROM anon;
REVOKE EXECUTE ON FUNCTION record_sponsor_decision_atomic(text, text, bigint) FROM authenticated;
GRANT  EXECUTE ON FUNCTION record_sponsor_decision_atomic(text, text, bigint) TO service_role;


-- Backfill
INSERT INTO funding_fulfillments
  (transaction_id, sponsor_id, team_id, submission_id, amount_cents, status, pledged_at, created_at)
SELECT tl.id, tl.sponsor_id, tl.team_id, tl.submission_id, tl.amount_cents, 'pledged',
       tl.created_at, tl.created_at
  FROM transactions_ledger tl
 WHERE NOT EXISTS (SELECT 1 FROM funding_fulfillments f WHERE f.transaction_id = tl.id);

INSERT INTO funding_fulfillment_events
  (fulfillment_id, from_status, to_status, actor_role, metadata, created_at)
SELECT f.id, NULL, 'pledged', 'system', jsonb_build_object('source', 'backfill'), f.pledged_at
  FROM funding_fulfillments f
 WHERE NOT EXISTS (SELECT 1 FROM funding_fulfillment_events e WHERE e.fulfillment_id = f.id);
