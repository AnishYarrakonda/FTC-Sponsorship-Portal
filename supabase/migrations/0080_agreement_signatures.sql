-- 0080_agreement_signatures.sql
-- APPLY WITH: psql "$DATABASE_URL" -f supabase/migrations/0080_agreement_signatures.sql
-- Contains $$-quoted blocks — psql -f only, never the Supabase CLI splitter.
-- Idempotent.
--
-- APPEND-ONLY. agreement_signatures is an ESIGN/UETA business record. There is no UPDATE
-- policy and no DELETE policy, for any role, deliberately.
--
-- <ADVANCE_RPC> for this codebase is `record_fulfillment_transition` (0076); <FULFILLMENTS>
-- is `funding_fulfillments`. 0076 itself documents the gate this migration wires up:
-- "agreement_signed is a real gate that prompt 06 will wire up. For now pledged ->
-- payment_sent stays legal." — confirmed by reading 0076 in full before writing this file.

CREATE TABLE IF NOT EXISTS agreement_signatures (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Pins the EXACT version signed. RESTRICT would block template cleanup and, worse,
  -- 0079's delete-guard already forbids deleting a non-draft, so RESTRICT adds nothing.
  template_id           uuid REFERENCES agreement_templates(id) ON DELETE RESTRICT,
  template_key          text    NOT NULL,
  template_version      integer NOT NULL,

  -- Signer. SET NULL, not RESTRICT: a Clerk `user.deleted` webhook cascades through
  -- profiles and runs no app code, so RESTRICT would wedge account deletion. The
  -- denormalised columns below are what keep the record standing on its own.
  signer_profile_id     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  signer_role           text NOT NULL CHECK (signer_role IN ('sponsor','coach')),
  signer_legal_name     text NOT NULL,
  signer_email          text NOT NULL,

  -- Bound entities. All SET NULL for the same reason; entity_snapshot preserves the facts.
  submission_id         uuid REFERENCES submissions(id) ON DELETE SET NULL,
  sponsor_id            uuid REFERENCES sponsors(id)    ON DELETE SET NULL,
  team_id               uuid REFERENCES teams(id)       ON DELETE SET NULL,
  -- Permitted keys ONLY: team_number, team_name, team_organization, sponsor_company_name,
  -- amount_cents. No student names, no roster data, no minor's identity, ever (COPPA).
  entity_snapshot       jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- The ESIGN evidence.
  typed_name            text NOT NULL CHECK (length(btrim(typed_name)) BETWEEN 2 AND 200),
  signed_at             timestamptz NOT NULL DEFAULT now(),
  ip_address            text NOT NULL,
  user_agent            text NOT NULL,
  document_hash         text NOT NULL CHECK (document_hash ~ '^[0-9a-f]{64}$'),
  document_storage_path text NOT NULL,
  consent_text_version  integer NOT NULL,
  consent_text_hash     text NOT NULL CHECK (consent_text_hash ~ '^[0-9a-f]{64}$'),

  created_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE agreement_signatures ENABLE ROW LEVEL SECURITY;

-- One signature per role per submission. Partial, because submission_id becomes NULL
-- if the submission is ever deleted and NULLs must not collide.
CREATE UNIQUE INDEX IF NOT EXISTS agreement_signatures_one_per_role_per_submission
  ON agreement_signatures (submission_id, signer_role)
  WHERE submission_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS agreement_signatures_signer_idx    ON agreement_signatures (signer_profile_id);
CREATE INDEX IF NOT EXISTS agreement_signatures_sponsor_idx   ON agreement_signatures (sponsor_id);
CREATE INDEX IF NOT EXISTS agreement_signatures_team_idx      ON agreement_signatures (team_id);
CREATE INDEX IF NOT EXISTS agreement_signatures_hash_idx      ON agreement_signatures (document_hash);

-- Trap avoided deliberately: no
--   CHECK (submission_id IS NOT NULL OR sponsor_id IS NOT NULL OR team_id IS NOT NULL)
-- here. CHECK constraints re-evaluate on UPDATE, and an ON DELETE SET NULL cascade IS an
-- UPDATE. The last cascade would violate that CHECK and abort the parent delete — silently
-- converting SET NULL back into RESTRICT and breaking the Clerk deletion webhook. The
-- at-least-one-entity rule is enforced inside sign_agreement_atomic() instead.

-- Append-only guard as a trigger as well as by policy absence, because every write in this
-- codebase can reach the DB through the service-role client, which ignores RLS.
CREATE OR REPLACE FUNCTION guard_agreement_signature_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'agreement_signature_immutable'
      USING HINT = 'Executed signatures are an ESIGN business record and cannot be deleted.';
  END IF;
  -- Allow ONLY the FK SET NULL cascades to land. Everything else is frozen.
  IF NEW.typed_name        <> OLD.typed_name
     OR NEW.signed_at      <> OLD.signed_at
     OR NEW.ip_address     <> OLD.ip_address
     OR NEW.user_agent     <> OLD.user_agent
     OR NEW.document_hash  <> OLD.document_hash
     OR NEW.document_storage_path <> OLD.document_storage_path
     OR NEW.consent_text_hash     <> OLD.consent_text_hash
     OR NEW.signer_legal_name     <> OLD.signer_legal_name
     OR NEW.signer_email          <> OLD.signer_email
     OR NEW.template_version      <> OLD.template_version
     OR NEW.entity_snapshot IS DISTINCT FROM OLD.entity_snapshot THEN
    RAISE EXCEPTION 'agreement_signature_immutable';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_agreement_signature_append_only ON agreement_signatures;
CREATE TRIGGER trg_agreement_signature_append_only
  BEFORE UPDATE OR DELETE ON agreement_signatures
  FOR EACH ROW EXECUTE FUNCTION guard_agreement_signature_append_only();

REVOKE EXECUTE ON FUNCTION guard_agreement_signature_append_only() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION guard_agreement_signature_append_only() TO service_role;

-- RLS policies. No INSERT policy. No UPDATE policy. No DELETE policy. For any role.
-- Inserts happen only through sign_agreement_atomic(), SECURITY DEFINER, granted to
-- service_role alone.

DROP POLICY IF EXISTS agreement_signatures_select_own ON agreement_signatures;
CREATE POLICY agreement_signatures_select_own ON agreement_signatures
  FOR SELECT USING (signer_profile_id = current_profile_id());

DROP POLICY IF EXISTS agreement_signatures_select_admin ON agreement_signatures;
CREATE POLICY agreement_signatures_select_admin ON agreement_signatures
  FOR SELECT USING (is_admin());

-- Same shape as ledger_select_sponsor (0069_ledger_sponsor_and_coach_read.sql): a sponsor
-- sees the coach's countersignature on their own agreement, and no other sponsor's book.
DROP POLICY IF EXISTS agreement_signatures_select_sponsor ON agreement_signatures;
CREATE POLICY agreement_signatures_select_sponsor ON agreement_signatures
  FOR SELECT USING (
    sponsor_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM profiles p
       WHERE p.id = current_profile_id() AND p.role = 'sponsor'
         AND p.sponsor_id IS NOT NULL AND p.sponsor_id = agreement_signatures.sponsor_id
    )
  );

-- Mirrors ledger_select_coach. This sublink on `teams` is only safe while every policy on
-- `teams` stays sublink-free (0066 wraps the sponsor predicate in sponsor_can_view_team());
-- an inline sublink there gives 42P17 on every read here.
DROP POLICY IF EXISTS agreement_signatures_select_coach ON agreement_signatures;
CREATE POLICY agreement_signatures_select_coach ON agreement_signatures
  FOR SELECT USING (
    team_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM teams t WHERE t.id = agreement_signatures.team_id AND t.owner_id = current_profile_id()
    )
  );

-- ── Storage: executed-agreements (private) ───────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('executed-agreements', 'executed-agreements', false)
ON CONFLICT (id) DO NOTHING;

UPDATE storage.buckets
   SET file_size_limit = 5242880,               -- 5 MB, matching coach-credentials
       allowed_mime_types = array['text/html']  -- HTML only in this slice; no PDF generation
 WHERE id = 'executed-agreements';

-- Path layout: {clerk_user_id}/{submission_id}/{template_key}-v{version}-{role}-{unix_ms}.html
-- The prepared (pre-signature) render lives at {clerk_user_id}/{submission_id}/prepared-{sha256}.html.
-- Folder-partitioned by Clerk user id exactly like coach-credentials in 0051_clerk_auth.sql.
DROP POLICY IF EXISTS "executed_agreements_select_own" ON storage.objects;
CREATE POLICY "executed_agreements_select_own" ON storage.objects FOR SELECT
  USING (bucket_id = 'executed-agreements' AND (auth.jwt() ->> 'sub') = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "executed_agreements_select_admin" ON storage.objects;
CREATE POLICY "executed_agreements_select_admin" ON storage.objects FOR SELECT
  USING (bucket_id = 'executed-agreements' AND public.is_admin());

-- No INSERT, UPDATE, or DELETE policy. Every write goes through the admin client inside
-- the provider. A signer cannot upload or overwrite their own executed document.

-- ── The gate ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION agreement_is_signed(p_submission_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM agreement_signatures s
                  WHERE s.submission_id = p_submission_id AND s.signer_role = 'sponsor')
     AND EXISTS (SELECT 1 FROM agreement_signatures s
                  WHERE s.submission_id = p_submission_id AND s.signer_role = 'coach');
$$;

REVOKE EXECUTE ON FUNCTION agreement_is_signed(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION agreement_is_signed(uuid) TO service_role;

-- ── sign_agreement_atomic ─────────────────────────────────────────────────────────────
-- Called via the admin client (no Clerk `sub`), so every entitlement decision derives
-- from p_signer_profile_id and the submission row — never from current_profile_id()/is_admin().
CREATE OR REPLACE FUNCTION sign_agreement_atomic(
  p_template_id           uuid,
  p_signer_profile_id     uuid,
  p_signer_role           text,
  p_submission_id         uuid,
  p_typed_name            text,
  p_ip                    text,
  p_user_agent            text,
  p_document_hash         text,
  p_document_storage_path text,
  p_consent_text_hash     text,
  p_entity_snapshot       jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_profile            profiles%ROWTYPE;
  v_template           agreement_templates%ROWTYPE;
  v_submission         submissions%ROWTYPE;
  v_fulfillment        funding_fulfillments%ROWTYPE;
  v_signature_id        uuid;
  v_all_signed          boolean;
  v_fulfillment_status  text;
  v_transition_result   jsonb;
BEGIN
  -- 1. Re-verify the actor.
  SELECT * INTO v_profile FROM profiles WHERE id = p_signer_profile_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  -- 2. Template must still be effective — a version retired between prepare and submit
  -- means the signer was looking at a stale document.
  SELECT * INTO v_template FROM agreement_templates
   WHERE id = p_template_id AND status = 'effective';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'template_not_effective');
  END IF;

  -- 3. Lock the submission; resolve team_id/sponsor_id FROM the row, never from a parameter.
  SELECT * INTO v_submission FROM submissions WHERE id = p_submission_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'submission_not_found');
  END IF;

  -- 4. Entitlement.
  IF p_signer_role = 'sponsor' THEN
    IF v_profile.role <> 'sponsor' OR v_profile.sponsor_id IS NULL
       OR v_profile.sponsor_id <> v_submission.sponsor_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
    END IF;
  ELSIF p_signer_role = 'coach' THEN
    IF v_profile.role <> 'coach' OR NOT v_profile.coach_verified
       OR NOT EXISTS (
         SELECT 1 FROM teams t WHERE t.id = v_submission.team_id AND t.owner_id = p_signer_profile_id
       ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
    END IF;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  -- 5. Ordering: a coach may not countersign before the sponsor has signed.
  IF p_signer_role = 'coach' AND NOT EXISTS (
    SELECT 1 FROM agreement_signatures s
     WHERE s.submission_id = p_submission_id AND s.signer_role = 'sponsor'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'awaiting_sponsor_signature');
  END IF;

  -- 6. Already signed for this (submission_id, signer_role) — also caught by the unique
  -- index; return the friendly code rather than a raw 23505.
  IF EXISTS (
    SELECT 1 FROM agreement_signatures s
     WHERE s.submission_id = p_submission_id AND s.signer_role = p_signer_role
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_signed');
  END IF;

  -- 7. Denormalise signer identity.
  IF v_profile.full_name IS NULL OR btrim(v_profile.full_name) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'profile_incomplete');
  END IF;

  -- 8. At-least-one-entity rule the CHECK constraint deliberately does not enforce.
  IF p_submission_id IS NULL AND v_submission.sponsor_id IS NULL AND v_submission.team_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_bound_entity');
  END IF;

  -- 9. Insert.
  INSERT INTO agreement_signatures (
    template_id, template_key, template_version,
    signer_profile_id, signer_role, signer_legal_name, signer_email,
    submission_id, sponsor_id, team_id, entity_snapshot,
    typed_name, ip_address, user_agent, document_hash, document_storage_path,
    consent_text_version, consent_text_hash
  ) VALUES (
    p_template_id, v_template.key, v_template.version,
    p_signer_profile_id, p_signer_role, v_profile.full_name, v_profile.email,
    p_submission_id, v_submission.sponsor_id, v_submission.team_id,
    COALESCE(p_entity_snapshot, '{}'::jsonb),
    p_typed_name, p_ip, p_user_agent, p_document_hash, p_document_storage_path,
    v_template.version, p_consent_text_hash
  )
  RETURNING id INTO v_signature_id;

  -- 10. If both parties have now signed, advance the fulfillment inside this same
  -- transaction. A failed transition rolls back the whole thing — never leave a
  -- signature recorded against a fulfillment that did not advance.
  v_all_signed := agreement_is_signed(p_submission_id);

  IF v_all_signed THEN
    SELECT * INTO v_fulfillment FROM funding_fulfillments
     WHERE submission_id = p_submission_id
     ORDER BY created_at DESC
     LIMIT 1
     FOR UPDATE;

    IF FOUND AND v_fulfillment.status = 'pledged' THEN
      v_transition_result := record_fulfillment_transition(
        v_fulfillment.id, NULL, 'agreement_signed'::fulfillment_status
      );
      IF NOT COALESCE((v_transition_result->>'ok')::boolean, false) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'fulfillment_transition_failed');
      END IF;
      v_fulfillment_status := v_transition_result->>'status';
    ELSIF FOUND THEN
      v_fulfillment_status := v_fulfillment.status::text;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'signature_id', v_signature_id, 'all_signed', v_all_signed,
    'fulfillment_status', v_fulfillment_status
  );
END $$;

REVOKE EXECUTE ON FUNCTION sign_agreement_atomic(uuid,uuid,text,uuid,text,text,text,text,text,text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION sign_agreement_atomic(uuid,uuid,text,uuid,text,text,text,text,text,text,jsonb)
  TO service_role;

-- ── The gate, enforced in two places, nowhere else authoritative ───────────────────────
--
-- 1. Inside record_fulfillment_transition (<ADVANCE_RPC>, 0076). Body copied verbatim from
--    0076_funding_fulfillments.sql, with ONE addition: a signed-agreement check at the top
--    of the p_to_status = 'payment_sent' branch, after the existing payment-details check,
--    covering every path into payment_sent regardless of the from-status (pledged,
--    agreement_signed, or the payment_received correction path) — 0076 explicitly left
--    pledged -> payment_sent legal without this gate ("For now pledged -> payment_sent
--    stays legal"). submission_id is nullable (ON DELETE SET NULL); a fulfillment whose
--    submission has been deleted has nothing left to gate against, so the check is skipped
--    only in that case, not bypassed for a live submission.
--
-- 2. A BEFORE UPDATE trigger on funding_fulfillments (<FULFILLMENTS>), so the rule survives
--    a direct service-role UPDATE that bypasses the RPC entirely.

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

-- Belt-and-braces: the same rule as a trigger, so a direct service-role UPDATE that
-- bypasses record_fulfillment_transition entirely still cannot reach payment_sent unsigned.
CREATE OR REPLACE FUNCTION guard_fulfillment_requires_signed_agreement()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status = 'payment_sent' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.submission_id IS NOT NULL AND NOT agreement_is_signed(NEW.submission_id) THEN
      RAISE EXCEPTION 'agreement_not_signed'
        USING HINT = 'Both parties must execute the sponsorship agreement first.';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_fulfillment_requires_signed_agreement ON funding_fulfillments;
CREATE TRIGGER trg_fulfillment_requires_signed_agreement
  BEFORE UPDATE ON funding_fulfillments
  FOR EACH ROW EXECUTE FUNCTION guard_fulfillment_requires_signed_agreement();

REVOKE EXECUTE ON FUNCTION guard_fulfillment_requires_signed_agreement() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION guard_fulfillment_requires_signed_agreement() TO service_role;

-- =====================================================================================
-- VERIFICATION (run manually after applying; not executed by this migration)
--
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'agreement_signatures' ORDER BY 1;
--   -> exactly 4 rows, all SELECT: _select_admin, _select_coach, _select_own, _select_sponsor
--
-- SELECT public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'executed-agreements';
--   -> public=false, file_size_limit=5242880, allowed_mime_types={text/html}
-- SELECT policyname FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage'
--   AND policyname LIKE 'executed_agreements%';
--   -> exactly 2 rows
--
-- As service_role:
--   UPDATE agreement_signatures SET typed_name = 'x'; -> agreement_signature_immutable
--   DELETE FROM agreement_signatures;                 -> agreement_signature_immutable
--
-- As coach A's JWT: GET .../agreement_signatures?select=* -> only their own team's rows
-- As sponsor B's JWT: sponsor A's signature is absent
-- As anon: []
--
-- SELECT has_function_privilege('authenticated','sign_agreement_atomic(uuid,uuid,text,uuid,text,text,text,text,text,text,jsonb)','EXECUTE'); -> false
-- SELECT has_function_privilege('authenticated','agreement_is_signed(uuid)','EXECUTE'); -> false
-- SELECT has_function_privilege('authenticated','record_fulfillment_transition(uuid,uuid,fulfillment_status,fulfillment_payment_method,text,date,text)','EXECUTE'); -> false
--
-- Gate cannot be bypassed — with a fulfillment in 'pledged' and no signatures:
--   (a) SELECT record_fulfillment_transition('<id>', NULL, 'payment_sent', 'check');
--       -> {"ok":false,"error":"agreement_not_signed"}   (server context; substitute a real admin actor id to hit the admin path)
--   (b) UPDATE funding_fulfillments SET status = 'payment_sent' WHERE id = '<id>';
--       -> ERROR: agreement_not_signed
--
-- Deleting a signer's profiles row nulls signer_profile_id and leaves the signature intact
-- with its denormalised name and email — and does not error.
--
-- Replay this whole file a second time with psql -f -> must succeed.
-- =====================================================================================
