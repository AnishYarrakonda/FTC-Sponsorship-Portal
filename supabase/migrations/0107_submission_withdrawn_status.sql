-- 0107_submission_withdrawn_status.sql
-- APPLY WITH: psql "$DATABASE_URL" -f supabase/migrations/0107_submission_withdrawn_status.sql
-- Contains a $$-quoted function body -- psql -f only.
-- Idempotent (ADD VALUE IF NOT EXISTS + CREATE OR REPLACE).
--
-- B-03-12. Once a pitch was 'dispatched' there was no coach-facing and no admin-facing way
-- to retract it. The only exits were a sponsor decision or the 14-day expiry cron, so a
-- coach who dispatched the wrong amount -- or text that breaches the no-student-information
-- rule -- could not pull it back, and could not free the sponsor's reserved capacity. On a
-- $5,000 cap a single mistaken $1,200 pitch locks 24% of a sponsor's annual capacity for a
-- fortnight.
--
-- Modelled as its own status rather than reusing 'changes_requested'. A withdrawal is the
-- coach's act; 'changes_requested' is an administrator's, and overloading it would make the
-- audit trail lie about who ended the pitch.
--
-- ALTER TYPE ... ADD VALUE must not share a transaction with anything that USES the new
-- label, so this file deliberately runs it as a standalone statement before the function.

ALTER TYPE submission_status ADD VALUE IF NOT EXISTS 'withdrawn';

CREATE OR REPLACE FUNCTION public.release_submission_reservation(p_submission_id uuid, p_new_status text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_submission submissions%ROWTYPE;
  v_released   bigint;
BEGIN
  -- B-03-12 adds 'withdrawn': a coach retracting their own dispatched pitch. It travels
  -- the same release path as expiry/bounce/decline, so the sponsor's reserved capacity is
  -- returned by exactly the code that is already proven by
  -- scripts/verify-capacity-invariant.mjs rather than by a second, parallel implementation.
  IF p_new_status NOT IN ('expired', 'bounced', 'declined', 'changes_requested', 'withdrawn') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status');
  END IF;

  SELECT * INTO v_submission FROM submissions WHERE id = p_submission_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'submission_not_found'); END IF;

  IF v_submission.status NOT IN ('dispatched', 'delivered', 'opened') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_releasable', 'current_status', v_submission.status);
  END IF;

  v_released := COALESCE(v_submission.reserved_amount_cents, 0);

  IF v_released > 0 THEN
    UPDATE sponsors
       SET funding_used_cents = GREATEST(funding_used_cents - v_released, 0),
           status = CASE WHEN status = 'inactive'
                          AND (funding_used_cents - v_released) < funding_cap_cents
                         THEN 'active'::sponsor_status ELSE status END
     WHERE id = v_submission.sponsor_id;
  END IF;

  UPDATE submissions
     SET status = p_new_status::submission_status,
         reserved_amount_cents = 0,
         reviewed_at = COALESCE(reviewed_at, now())
   WHERE id = p_submission_id;

  INSERT INTO audit_log(actor_id, action, entity_type, entity_id, metadata)
  VALUES (NULL, 'release_reservation', 'submissions', p_submission_id,
          jsonb_build_object('released_cents', v_released, 'new_status', p_new_status,
                             'reason', p_reason, 'sponsor_id', v_submission.sponsor_id));

  RETURN jsonb_build_object('ok', true, 'released_cents', v_released);
END;
$function$;
