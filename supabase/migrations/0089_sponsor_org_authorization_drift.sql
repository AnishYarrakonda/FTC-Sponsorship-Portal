-- 0089_sponsor_org_authorization_drift.sql
--
-- Closes the last four sponsor-authorization sites that still key off the PRE-0082
-- `profiles.sponsor_id` column instead of org membership.
--
-- 0082 moved sponsor identity from a single column on `profiles` to the `sponsor_members`
-- join table, and introduced `current_sponsor_ids()` as the one true resolver. Most call
-- sites were converted; these four were not, and they were found by sweeping pg_policies
-- and pg_proc for `profiles` + `sponsor_id` without `current_sponsor_ids`:
--
--   1. policy  agreement_signatures_select_sponsor
--   2. function can_read_fulfillment(uuid)
--   3. function sign_agreement_atomic(...)
--   4. function sponsor_decide_submission_atomic(...)
--
-- Every one of them FAILS CLOSED: an org-member sponsor whose `profiles.sponsor_id` is
-- NULL is denied rather than over-served, so nothing leaked. But it means a sponsor
-- invited into an organisation could not read their own agreements or fulfilments, could
-- not sign, and could not decide a pitch — the multi-user sponsor feature is inert for
-- exactly the users it was built for. There are zero `sponsor_members` rows in production
-- today, so this is latent, not live.
--
-- ## Why a second resolver
--
-- `current_sponsor_ids()` reads the caller from the JWT via `current_profile_id()`. That
-- is right inside an RLS policy, and WRONG inside these two RPCs: both are invoked through
-- the ADMIN client (service_role), where there is no JWT at all, so `current_profile_id()`
-- is NULL and `current_sponsor_ids()` would return '{}' — converting a latent denial into
-- a total one. The RPCs already carry the actor as a parameter they have independently
-- verified, so they need the same resolution keyed off a profile id instead of the JWT.
--
-- `sponsor_ids_for_profile(uuid)` is therefore the primitive, and `current_sponsor_ids()`
-- is redefined as `sponsor_ids_for_profile(current_profile_id())` so the two can never
-- drift apart. The role gate (`profiles.role = 'sponsor'`) moves with it: a coach or admin
-- handed a membership row still resolves to '{}'.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The primitive, and current_sponsor_ids() delegating to it.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sponsor_ids_for_profile(p_profile_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(array_agg(DISTINCT sid), '{}'::uuid[])
    FROM (
      -- new path: organisation membership (0082)
      SELECT m.sponsor_id AS sid
        FROM sponsor_members m
       WHERE m.profile_id = p_profile_id
      UNION
      -- legacy path: the single-column link, kept as a fallback for every sponsor that
      -- predates organisations or whose membership row lagged behind the webhook.
      SELECT p.sponsor_id
        FROM profiles p
       WHERE p.id = p_profile_id
         AND p.sponsor_id IS NOT NULL
    ) s
   WHERE sid IS NOT NULL
     -- Role stays authoritative in profiles.role: a coach or admin who somehow acquires a
     -- membership row must not inherit sponsor access.
     AND EXISTS (SELECT 1 FROM profiles p2
                  WHERE p2.id = p_profile_id AND p2.role = 'sponsor');
$function$;

-- Evaluated inside RLS policies, so it must NOT be revoked from anon/authenticated: a
-- policy that calls a function the caller cannot execute raises 42501 instead of
-- filtering, turning an empty read into an error. Same reason current_sponsor_ids() is
-- executable by anon.
GRANT EXECUTE ON FUNCTION public.sponsor_ids_for_profile(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.current_sponsor_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.sponsor_ids_for_profile(current_profile_id());
$function$;

GRANT EXECUTE ON FUNCTION public.current_sponsor_ids() TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. agreement_signatures_select_sponsor — org-aware, role gate preserved by the helper.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS agreement_signatures_select_sponsor ON public.agreement_signatures;
CREATE POLICY agreement_signatures_select_sponsor ON public.agreement_signatures
  FOR SELECT
  USING (sponsor_id IS NOT NULL AND sponsor_id = ANY (current_sponsor_ids()));

-- ---------------------------------------------------------------------------
-- 3. can_read_fulfillment — the sponsor branch only; admin and coach branches unchanged.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_read_fulfillment(p_fulfillment_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM funding_fulfillments f
     WHERE f.id = p_fulfillment_id
       AND (
         is_admin()
         OR (f.sponsor_id IS NOT NULL AND f.sponsor_id = ANY (current_sponsor_ids()))
         OR (f.team_id IS NOT NULL AND EXISTS (
               SELECT 1 FROM teams t WHERE t.id = f.team_id AND t.owner_id = current_profile_id()))
       )
  );
$function$;

GRANT EXECUTE ON FUNCTION public.can_read_fulfillment(uuid) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4 & 5. The two atomic RPCs. Bodies below are the live definitions with ONLY the sponsor
-- entitlement check rewritten; in the decide path every subsequent use of
-- `v_profile.sponsor_id` (capacity update, ledger row, fulfilment row, audit metadata)
-- becomes `v_submission.sponsor_id`, which the gate immediately above has just proven the
-- actor is entitled to. Under the legacy single-column model the two are identical; under
-- organisations only the submission's value is non-NULL.
-- ---------------------------------------------------------------------------

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
       OR NOT (v_submission.sponsor_id = ANY (sponsor_ids_for_profile(v_actor_id))) THEN
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
END $function$

;

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

  IF v_amount < COALESCE(v_submission.reserved_amount_cents, 0) THEN
    UPDATE sponsors
       SET funding_used_cents =
             GREATEST(funding_used_cents - (v_submission.reserved_amount_cents - v_amount), 0),
           status = CASE
             WHEN status = 'inactive'
              AND (funding_used_cents - (v_submission.reserved_amount_cents - v_amount)) < funding_cap_cents
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

COMMIT;
