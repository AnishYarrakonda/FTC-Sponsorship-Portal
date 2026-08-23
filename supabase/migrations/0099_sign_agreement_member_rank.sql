-- 0099 — require approver rank to sign a sponsorship agreement (audit B-02-01, P0)
--
-- sign_agreement_atomic checked that the signer BELONGS to the sponsor org
-- (sponsor_ids_for_profile) but never what rank they hold in it. Combined with
-- signAgreement() checking only profiles.role, and agreement-status-row.tsx rendering
-- "Sign now" for any sponsor, a `viewer` — an account deliberately provisioned with
-- read-only access, and the default rank for every SSO/JIT first login (jitMemberRole)
-- — could execute a legally binding sponsorship agreement for the company.
--
-- The rank is resolved from p_signer_profile_id, NOT current_sponsor_member_role(),
-- because this RPC is invoked through the admin client (service_role) in
-- lib/agreements/in-house-provider.ts:128, where current_profile_id() is NULL.
-- The COALESCE below deliberately mirrors current_sponsor_member_role() (0083): a legacy
-- sponsor linked only by profiles.sponsor_id, with no sponsor_members row, resolves to
-- 'org_admin' and can still sign. That fallback MUST stay in step with
-- LEGACY_MEMBER_ROLE in lib/sponsor-roles.ts.
--
-- Body below is the LIVE definition dumped with pg_get_functiondef, with step 4 amended
-- and nothing else touched.

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
END $function$

;
