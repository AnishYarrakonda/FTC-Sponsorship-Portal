-- 0106_legal_review_gate_and_orphan_fulfillments.sql
-- APPLY WITH: psql "$DATABASE_URL" -f supabase/migrations/0106_legal_review_gate_and_orphan_fulfillments.sql
-- Contains $$-quoted function bodies -- the Supabase CLI splitter mishandles them. psql -f only.
-- Idempotent (CREATE OR REPLACE).
--
-- A-04-02  sign_agreement_atomic never checked agreement_templates.needs_legal_review, so a
--          template explicitly flagged as not-reviewed-by-counsel was fully executable.
-- A-04-03  record_fulfillment_transition's signature gate is written
--          "IF submission_id IS NOT NULL AND NOT agreement_is_signed(...)", which skips on an
--          orphaned fulfillment (submission_id is ON DELETE SET NULL). Forward money
--          transitions are now refused on an orphan; only cancellation is allowed.
--
-- Both bodies below were dumped LIVE with pg_get_functiondef and patched in place -- never
-- rebuilt from an older migration file.

CREATE OR REPLACE FUNCTION public.sign_agreement_atomic(p_template_id uuid, p_signer_profile_id uuid, p_signer_role text, p_submission_id uuid, p_typed_name text, p_ip text, p_user_agent text, p_document_hash text, p_document_storage_path text, p_consent_text_hash text, p_entity_snapshot jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_profile            profiles%ROWTYPE;
  v_template           agreement_templates%ROWTYPE;
  v_submission         submissions%ROWTYPE;
  v_fulfillment        funding_fulfillments%ROWTYPE;
  v_signature_id        uuid;
  v_all_signed          boolean;
  v_fulfillment_status  text;
  v_transition_result   jsonb;
  v_member_role         text;
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

  -- 2b. A-04-02. Counsel review is a precondition to execution, not a decoration.
  -- 0079's own header states it: "An attorney must review it and an admin must clear the
  -- flag before this platform relies on it in a real transaction." Until now nothing
  -- enforced that, so the seeded sponsorship_agreement -- which still carries an
  -- unresolved TODO(legal) governing-law clause (B-03-08) -- was fully signable, and the
  -- resulting signature attests to bytes that name no jurisdiction.
  --
  -- Clearing the flag is a deliberate admin act (approveAgreementTemplate,
  -- app/actions/agreements.ts) and is the single step that unblocks signing.
  IF v_template.needs_legal_review THEN
    RETURN jsonb_build_object('ok', false, 'error', 'template_needs_legal_review');
  END IF;

  -- 3. Lock the submission; resolve team_id/sponsor_id FROM the row, never from a parameter.
  SELECT * INTO v_submission FROM submissions WHERE id = p_submission_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'submission_not_found');
  END IF;

  -- 4. Entitlement.
  IF p_signer_role = 'sponsor' THEN
    IF v_profile.role <> 'sponsor'
       OR v_submission.sponsor_id IS NULL
       OR NOT (v_submission.sponsor_id = ANY (sponsor_ids_for_profile(p_signer_profile_id))) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
    END IF;

    -- 4b. Rank. Belonging to the org is not authority to bind it: signing is an
    -- approver-and-above act, alongside confirming a funding decision.
    v_member_role := COALESCE(
      (SELECT m.role FROM sponsor_members m
        WHERE m.profile_id = p_signer_profile_id
          AND m.sponsor_id = v_submission.sponsor_id),
      (SELECT 'org_admin' FROM profiles p
        WHERE p.id = p_signer_profile_id
          AND p.role = 'sponsor'
          AND p.sponsor_id = v_submission.sponsor_id)
    );

    IF sponsor_member_role_rank(v_member_role) < sponsor_member_role_rank('approver') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'insufficient_org_role');
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
END $function$;

CREATE OR REPLACE FUNCTION public.record_fulfillment_transition(p_fulfillment_id uuid, p_actor_profile_id uuid, p_to_status fulfillment_status, p_payment_method fulfillment_payment_method DEFAULT NULL::fulfillment_payment_method, p_payment_reference text DEFAULT NULL::text, p_occurred_on date DEFAULT NULL::date, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor      uuid;
  v_f          funding_fulfillments%ROWTYPE;
  v_actor_role text;
  v_occurred   timestamptz;
  v_released   bigint := 0;
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
  ELSIF EXISTS (SELECT 1 FROM profiles p WHERE p.id = v_actor AND p.role = 'sponsor'
                 AND v_f.sponsor_id = ANY (sponsor_ids_for_profile(v_actor))) THEN
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

  -- A-04-03. funding_fulfillments.submission_id is ON DELETE SET NULL, so deleting a coach
  -- account cascades away the team and submission and leaves the fulfillment orphaned. The
  -- payment_sent gate below reads
  --     IF v_f.submission_id IS NOT NULL AND NOT agreement_is_signed(...)
  -- which SKIPS ENTIRELY on an orphan: money could be marked sent, received and receipted
  -- against a submission whose executed agreement can no longer be verified at all.
  --
  -- An orphan has exactly one correct disposition: cancel it, which releases the sponsor's
  -- capacity through the 0095 path below. Every forward transition is refused.
  IF v_f.submission_id IS NULL AND p_to_status <> 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'submission_orphaned',
                              'from_status', v_f.status, 'to_status', p_to_status);
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

  -- ---------------------------------------------------------------------------------
  -- 0095: release the sponsor's capacity on cancellation.
  --
  -- ON CONFLICT DO NOTHING + RETURNING means v_released is 0 when a release row already
  -- exists, so the decrement below cannot run twice for one fulfillment even if this
  -- function is somehow re-entered for an already-released row.
  -- ---------------------------------------------------------------------------------
  IF p_to_status = 'cancelled' AND v_f.amount_cents > 0 THEN
    INSERT INTO funding_capacity_releases
      (fulfillment_id, sponsor_id, submission_id, amount_cents, released_by, reason)
    VALUES (p_fulfillment_id, v_f.sponsor_id, v_f.submission_id, v_f.amount_cents, v_actor, p_note)
    ON CONFLICT (fulfillment_id) DO NOTHING
    RETURNING amount_cents INTO v_released;

    IF COALESCE(v_released, 0) > 0 THEN
      -- Same idiom as sponsor_decide_submission_atomic (0076): GREATEST floors the counter
      -- at zero, and a sponsor pushed back under their cap becomes fundable again.
      UPDATE sponsors
         SET funding_used_cents = GREATEST(funding_used_cents - v_released, 0),
             status = CASE
               WHEN status = 'inactive'
                AND GREATEST(funding_used_cents - v_released, 0) < funding_cap_cents
               THEN 'active'::sponsor_status ELSE status END
       WHERE id = v_f.sponsor_id;
    END IF;
  END IF;

  INSERT INTO funding_fulfillment_events
    (fulfillment_id, from_status, to_status, actor_profile_id, actor_role, note, metadata)
  VALUES (p_fulfillment_id, v_f.status, p_to_status, v_actor, v_actor_role, p_note,
          jsonb_build_object('payment_method', COALESCE(p_payment_method, v_f.payment_method), 'occurred_on', v_occurred::date));

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor, 'fulfillment_transition', 'funding_fulfillments', p_fulfillment_id,
          jsonb_build_object('from', v_f.status, 'to', p_to_status, 'actor_role', v_actor_role,
                             'amount_cents', v_f.amount_cents, 'sponsor_id', v_f.sponsor_id,
                             'capacity_released_cents', COALESCE(v_released, 0)));

  RETURN jsonb_build_object('ok', true, 'status', p_to_status, 'from_status', v_f.status,
                            'capacity_released_cents', COALESCE(v_released, 0));
END;
$function$;
