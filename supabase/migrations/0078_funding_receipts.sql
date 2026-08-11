-- Migration 0078: Funding Receipts and Acknowledgment Letters
--
-- Adds funding_receipts and funding_receipt_counters for IRS Pub 1771 compliant
-- written acknowledgments. Issued on the payment_received -> receipted transition.
--
-- SECURITY & DATA EXPOSURE NOTE:
-- Prompt 02 encrypts the EIN on team_payout_profiles. Issuing a 501(c)(3) receipt
-- prints the EIN on document_html, which is stored in this table. This is bounded:
-- 1. Full EIN lives ONLY inside document_html, never in a structured column.
-- 2. Structured field is payee_ein_last4.
-- 3. Document is readable ONLY by the two parties and admin via can_read_fulfillment.
-- 4. EIN is printed ONLY for 501c3 and school payees (public organisational EINs).
-- 5. Unincorporated payees (individual TIN/SSN) resolve to non_charitable and
--    NEVER print an EIN (showEin: false).

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'receipt_status') THEN
    CREATE TYPE receipt_status AS ENUM ('issued', 'voided');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'receipt_variant') THEN
    CREATE TYPE receipt_variant AS ENUM (
      'charitable_501c3',      -- Pub 1771 acknowledgment; asserts deductibility
      'governmental_school',   -- public school / governmental unit; makes NO deductibility claim
      'non_charitable'         -- payment record only; explicitly not a charitable receipt
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS funding_receipts (
  id                             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number                 text NOT NULL UNIQUE,

  fulfillment_id                 uuid NOT NULL REFERENCES funding_fulfillments(id) ON DELETE RESTRICT,
  transaction_id                 uuid NOT NULL REFERENCES transactions_ledger(id)  ON DELETE RESTRICT,
  sponsor_id                     uuid NOT NULL REFERENCES sponsors(id)             ON DELETE RESTRICT,
  team_id                        uuid REFERENCES teams(id)                        ON DELETE SET NULL,

  amount_cents                   bigint NOT NULL CHECK (amount_cents > 0),
  contribution_date              date   NOT NULL,
  variant                        receipt_variant NOT NULL,
  payee_legal_name               text   NOT NULL CHECK (char_length(payee_legal_name) BETWEEN 2 AND 200),
  payee_ein_last4                text   CHECK (payee_ein_last4 IS NULL OR payee_ein_last4 ~ '^[0-9]{4}$'),
  payee_tax_classification       text,
  sponsor_legal_name             text   NOT NULL CHECK (char_length(sponsor_legal_name) BETWEEN 1 AND 200),
  sponsor_contact_email          text,

  goods_or_services_description  text CHECK (goods_or_services_description IS NULL
                                            OR char_length(goods_or_services_description) <= 1000),
  goods_or_services_fmv_cents    bigint CHECK (goods_or_services_fmv_cents IS NULL
                                              OR goods_or_services_fmv_cents >= 0),

  document_html                  text NOT NULL,
  document_sha256                text NOT NULL CHECK (document_sha256 ~ '^[0-9a-f]{64}$'),
  copy_version                   text NOT NULL,
  copy_reviewed_at               timestamptz,

  status                         receipt_status NOT NULL DEFAULT 'issued',
  issued_at                      timestamptz NOT NULL DEFAULT now(),
  issued_by                      uuid REFERENCES profiles(id) ON DELETE SET NULL,
  emailed_at                     timestamptz,

  voided_at                      timestamptz,
  voided_by                      uuid REFERENCES profiles(id) ON DELETE SET NULL,
  voided_reason                  text CHECK (voided_reason IS NULL OR char_length(voided_reason) <= 1000),

  supersedes_receipt_id          uuid REFERENCES funding_receipts(id) ON DELETE RESTRICT,
  superseded_by_receipt_id      uuid REFERENCES funding_receipts(id) ON DELETE RESTRICT,

  created_at                     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT receipt_void_fields_together CHECK (
    (status = 'issued' AND voided_at IS NULL AND voided_reason IS NULL)
    OR (status = 'voided' AND voided_at IS NOT NULL AND voided_reason IS NOT NULL)
  ),
  CONSTRAINT receipt_fmv_requires_description CHECK (
    goods_or_services_fmv_cents IS NULL OR goods_or_services_description IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_receipts_sponsor     ON funding_receipts(sponsor_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_receipts_team        ON funding_receipts(team_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_receipts_fulfillment ON funding_receipts(fulfillment_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_receipt_live_per_fulfillment
  ON funding_receipts(fulfillment_id) WHERE status = 'issued';

-- Yearly transactional counter for gap-free receipt numbering (PF-YYYY-NNNNNN)
CREATE TABLE IF NOT EXISTS funding_receipt_counters (
  year       int    PRIMARY KEY,
  last_value bigint NOT NULL DEFAULT 0 CHECK (last_value >= 0)
);

ALTER TABLE funding_receipt_counters ENABLE ROW LEVEL SECURITY;
-- No policies on funding_receipt_counters: deny-all for non-service role.

ALTER TABLE funding_receipts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'funding_receipts' AND policyname = 'receipts_select'
  ) THEN
    CREATE POLICY receipts_select ON funding_receipts
      FOR SELECT USING (can_read_fulfillment(fulfillment_id));
  END IF;
END $$;


-- RPC: issue_funding_receipt
--
-- Mints gap-free receipt number, inserts receipt, updates superseding relationships,
-- and transitions fulfillment to 'receipted' via record_fulfillment_transition.
--
-- Performance / Gap-freedom note: Serializes concurrent issuances per year on the counter
-- row lock. At this volume this takes microseconds and guarantees gap-freedom.
CREATE OR REPLACE FUNCTION issue_funding_receipt(
  p_fulfillment_id           uuid,
  p_actor_profile_id         uuid,
  p_variant                  receipt_variant,
  p_payee_legal_name         text,
  p_payee_ein_last4          text,
  p_payee_tax_classification text,
  p_sponsor_legal_name       text,
  p_sponsor_contact_email    text,
  p_goods_or_services        text,
  p_goods_or_services_fmv_cents bigint,
  p_document_html            text,
  p_document_sha256          text,
  p_copy_version             text,
  p_copy_reviewed_at         timestamptz,
  p_supersedes_receipt_id    uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_actor      uuid;
  v_f          RECORD;
  v_old_r      RECORD;
  v_existing_id uuid;
  v_existing_num text;
  v_year       int;
  v_seq        bigint;
  v_number     text;
  v_new_id     uuid;
  v_actor_role text;
  v_txn        jsonb;
BEGIN
  -- 1. Actor resolution (three-branch)
  IF (auth.jwt() ->> 'sub') IS NOT NULL THEN
    v_actor := current_profile_id();
    IF v_actor IS NULL OR v_actor IS DISTINCT FROM p_actor_profile_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
    END IF;
  ELSIF is_trusted_server_context() THEN
    v_actor := p_actor_profile_id;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  -- 2. Role check (admin or system path)
  IF v_actor IS NOT NULL THEN
    SELECT role INTO v_actor_role FROM profiles WHERE id = v_actor;
    IF v_actor_role IS DISTINCT FROM 'admin' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
    END IF;
  END IF;

  -- 3. Lock fulfillment
  SELECT * INTO v_f FROM funding_fulfillments WHERE id = p_fulfillment_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'fulfillment_not_found');
  END IF;

  -- 4. State gate
  IF v_f.status = 'payment_received' THEN
    -- First issuance
    NULL;
  ELSIF v_f.status = 'receipted' AND p_supersedes_receipt_id IS NOT NULL THEN
    -- Reissue path: check superseded receipt exists, belongs to this fulfillment, and is voided
    SELECT * INTO v_old_r FROM funding_receipts WHERE id = p_supersedes_receipt_id FOR UPDATE;
    IF NOT FOUND OR v_old_r.fulfillment_id <> p_fulfillment_id OR v_old_r.status <> 'voided' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_supersedes_receipt');
    END IF;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'not_receiptable', 'current_status', v_f.status);
  END IF;

  -- 5. Idempotency check (for first issuance)
  IF p_supersedes_receipt_id IS NULL THEN
    SELECT id, receipt_number INTO v_existing_id, v_existing_num
      FROM funding_receipts
     WHERE fulfillment_id = p_fulfillment_id AND status = 'issued';
    IF v_existing_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'ok', true,
        'already_issued', true,
        'receipt_id', v_existing_id,
        'receipt_number', v_existing_num
      );
    END IF;
  END IF;

  -- 6. Integrity check on document HTML hash
  IF p_document_sha256 IS DISTINCT FROM encode(digest(p_document_html, 'sha256'), 'hex') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'document_hash_mismatch');
  END IF;

  -- 7. Mint gap-free counter
  v_year := EXTRACT(YEAR FROM now() AT TIME ZONE 'utc')::int;

  INSERT INTO funding_receipt_counters (year, last_value)
  VALUES (v_year, 0)
  ON CONFLICT (year) DO NOTHING;

  UPDATE funding_receipt_counters
     SET last_value = last_value + 1
   WHERE year = v_year
  RETURNING last_value INTO v_seq;

  v_number := 'PF-' || v_year::text || '-' || lpad(v_seq::text, 6, '0');
  v_new_id := gen_random_uuid();

  -- 8. Insert receipt
  INSERT INTO funding_receipts (
    id,
    receipt_number,
    fulfillment_id,
    transaction_id,
    sponsor_id,
    team_id,
    amount_cents,
    contribution_date,
    variant,
    payee_legal_name,
    payee_ein_last4,
    payee_tax_classification,
    sponsor_legal_name,
    sponsor_contact_email,
    goods_or_services_description,
    goods_or_services_fmv_cents,
    document_html,
    document_sha256,
    copy_version,
    copy_reviewed_at,
    status,
    issued_at,
    issued_by,
    supersedes_receipt_id
  ) VALUES (
    v_new_id,
    v_number,
    p_fulfillment_id,
    v_f.transaction_id,
    v_f.sponsor_id,
    v_f.team_id,
    v_f.amount_cents,
    (v_f.payment_received_at AT TIME ZONE 'utc')::date,
    p_variant,
    p_payee_legal_name,
    p_payee_ein_last4,
    p_payee_tax_classification,
    p_sponsor_legal_name,
    p_sponsor_contact_email,
    p_goods_or_services,
    p_goods_or_services_fmv_cents,
    p_document_html,
    p_document_sha256,
    p_copy_version,
    p_copy_reviewed_at,
    'issued',
    now(),
    v_actor,
    p_supersedes_receipt_id
  );

  IF p_supersedes_receipt_id IS NOT NULL THEN
    UPDATE funding_receipts
       SET superseded_by_receipt_id = v_new_id
     WHERE id = p_supersedes_receipt_id;
  END IF;

  -- 9. Transition fulfillment to 'receipted' if currently 'payment_received'
  IF v_f.status = 'payment_received' THEN
    v_txn := record_fulfillment_transition(
      p_fulfillment_id   := p_fulfillment_id,
      p_actor_profile_id := p_actor_profile_id,
      p_to_status        := 'receipted',
      p_note             := 'Receipt ' || v_number || ' issued'
    );
    IF NOT (v_txn ->> 'ok')::boolean AND (v_txn ->> 'error') <> 'already_in_status' THEN
      RAISE EXCEPTION 'receipt_transition_failed: %', v_txn ->> 'error';
    END IF;
  END IF;

  -- 10. Audit log
  INSERT INTO audit_log (
    actor_id, action, entity_type, entity_id, metadata
  ) VALUES (
    v_actor,
    'issue_funding_receipt',
    'funding_receipts',
    v_new_id,
    jsonb_build_object(
      'receipt_number', v_number,
      'fulfillment_id', p_fulfillment_id,
      'variant', p_variant,
      'amount_cents', v_f.amount_cents,
      'supersedes', p_supersedes_receipt_id
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'receipt_id', v_new_id,
    'receipt_number', v_number
  );
END;
$$;


-- RPC: void_funding_receipt
CREATE OR REPLACE FUNCTION void_funding_receipt(
  p_receipt_id        uuid,
  p_actor_profile_id  uuid,
  p_reason            text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_actor      uuid;
  v_actor_role text;
  v_r          RECORD;
BEGIN
  -- 1. Actor resolution (three-branch)
  IF (auth.jwt() ->> 'sub') IS NOT NULL THEN
    v_actor := current_profile_id();
    IF v_actor IS NULL OR v_actor IS DISTINCT FROM p_actor_profile_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
    END IF;
  ELSIF is_trusted_server_context() THEN
    v_actor := p_actor_profile_id;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  -- 2. Role check
  IF v_actor IS NOT NULL THEN
    SELECT role INTO v_actor_role FROM profiles WHERE id = v_actor;
    IF v_actor_role IS DISTINCT FROM 'admin' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
    END IF;
  END IF;

  -- 3. Reason check
  IF p_reason IS NULL OR char_length(trim(p_reason)) < 10 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'reason_required');
  END IF;

  -- 4. Lock receipt
  SELECT * INTO v_r FROM funding_receipts WHERE id = p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'receipt_not_found');
  END IF;

  IF v_r.status = 'voided' THEN
    RETURN jsonb_build_object('ok', true, 'already_voided', true);
  END IF;

  -- 5. Update void fields
  UPDATE funding_receipts
     SET status = 'voided',
         voided_at = now(),
         voided_by = v_actor,
         voided_reason = trim(p_reason)
   WHERE id = p_receipt_id;

  -- 6. Audit
  INSERT INTO audit_log (
    actor_id, action, entity_type, entity_id, metadata
  ) VALUES (
    v_actor,
    'void_funding_receipt',
    'funding_receipts',
    p_receipt_id,
    jsonb_build_object(
      'receipt_number', v_r.receipt_number,
      'fulfillment_id', v_r.fulfillment_id,
      'reason', trim(p_reason)
    )
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;


-- Grants & Revokes
REVOKE EXECUTE ON FUNCTION issue_funding_receipt(uuid, uuid, receipt_variant, text, text, text, text, text, text, bigint, text, text, text, timestamptz, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION issue_funding_receipt(uuid, uuid, receipt_variant, text, text, text, text, text, text, bigint, text, text, text, timestamptz, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION issue_funding_receipt(uuid, uuid, receipt_variant, text, text, text, text, text, text, bigint, text, text, text, timestamptz, uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION issue_funding_receipt(uuid, uuid, receipt_variant, text, text, text, text, text, text, bigint, text, text, text, timestamptz, uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION void_funding_receipt(uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION void_funding_receipt(uuid, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION void_funding_receipt(uuid, uuid, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION void_funding_receipt(uuid, uuid, text) TO service_role;
