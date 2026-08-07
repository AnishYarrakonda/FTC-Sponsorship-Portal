-- 0065_fix_sponsor_decide_double_debit.sql
-- =====================================================================================
-- P0-5: accepting a pitch through the SPONSOR PORTAL debits the sponsor's cap twice.
--
-- ── Settled from source; no DB query needed to write this fix ────────────────────────
-- The two-phase funding model (0047 header) is: RESERVE at admin approval, SETTLE at
-- the sponsor decision. approve_submission_atomic reserves —
--   0047:82-86 (now 0062:181-186)  funding_used_cents = funding_used_cents + v_ask_cents
-- — and 0047:229 states the contract for the settle side verbatim:
--   "SETTLE. Funds are already reserved, so we never debit again".
-- 0047's own sponsor_decide_submission_atomic (0047:269-370) honours that: it only ever
-- SUBTRACTS, to release the unfunded difference on a partial.
--
-- 0053_remove_amount_required_guard.sql is the LAST CREATE OR REPLACE of that function
-- in migration order, and 0053:83-87 re-adds the increment unconditionally:
--     IF v_amount > 0 THEN
--       UPDATE sponsors SET funding_used_cents = funding_used_cents + v_amount ...
-- with v_amount := reserved_amount_cents (0053:70) — the exact figure already added at
-- approval. Every portal acceptance therefore debits twice: the books read 2x reality,
-- or the next approval hard-fails 'insufficient_sponsor_capacity' against a cap that is
-- not really full. This breaks the Capacity Integrity mandate.
--
-- 0053 also silently regressed three other things while removing the guard:
--   * partial funding: p_amount_cents is read but never used, v_decision_type is
--     hard-coded 'full' at 0053:90, so a partial settlement is recorded in
--     transactions_ledger as a full one at the wrong amount.
--   * the release of the unfunded difference on a partial (0047:346-353) is gone, so a
--     partially-funded pitch leaves the remainder reserved forever.
--   * 0053's premise — "sponsors no longer have budget caps" — contradicts both
--     approve_submission_atomic, which still enforces the cap at 0047:68, and the
--     Capacity Integrity mandate in CLAUDE.md. The cap is real; 0053 was wrong.
--
-- This migration restores 0047's settle semantics, keeps 0053's one good change (no
-- hard RAISE on a zero amount — that case is now caught upstream at submission time,
-- app/actions/submission.ts:58, and by 'invalid_amount' in approve_submission_atomic),
-- and adds the P0-1 actor hardening from §16 "new issues" item 1.
--
-- ── !! PRE-APPLY CHECK FOR THE HUMAN !! ──────────────────────────────────────────────
-- This file REPLACES the whole function body. That is deterministic regardless of which
-- version is live, which is why it is safe to write without DB access. The one residual
-- risk is a hand-edit made directly in the Supabase SQL editor that exists in no
-- migration file. Before applying, run:
--
--   SELECT pg_get_functiondef(p.oid)
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname='public' AND p.proname='sponsor_decide_submission_atomic';
--
-- If the body is 0053's, apply as-is. If it differs from 0053 in any way other than
-- whitespace, STOP and report the diff before applying.
--
-- Also run the corruption audit (report §8 item 3) — if any acceptance has already
-- happened, funding_used_cents is already inflated and needs a data repair separate
-- from this code fix:
--
--   SELECT s.id, s.company_name, s.funding_cap_cents, s.funding_used_cents,
--          COALESCE(SUM(sub.reserved_amount_cents),0) AS expected
--     FROM sponsors s
--     LEFT JOIN submissions sub ON sub.sponsor_id = s.id
--      AND sub.status IN ('dispatched','delivered','opened')
--    GROUP BY 1,2,3,4;
--
-- (Per the audit's re-verified row counts, transactions_ledger and submissions are both
--  empty, so no acceptance has occurred yet and no repair is expected to be needed.)
--
-- APPLY WITH:  psql "$DATABASE_URL" -f supabase/migrations/0065_fix_sponsor_decide_double_debit.sql
-- Idempotent: CREATE OR REPLACE.
-- =====================================================================================

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
BEGIN
  -- ── actor resolution (P0-1 defence in depth, §16 "new issues" item 1) ─────────────
  -- p_sponsor_user_id was a caller-supplied identity that nothing bound to the session.
  -- As with approve_submission_atomic, asserting current_profile_id() unconditionally
  -- would break the only real caller (the service-role admin client carries no Clerk
  -- JWT), so the check is context-aware.
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

  -- ── RELEASE paths (decline / send back for changes) ───────────────────────────────
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

  -- Defence in depth against double-settle across the token + portal paths.
  IF EXISTS (
    SELECT 1 FROM transactions_ledger tl
     WHERE tl.submission_id = p_submission_id AND tl.actor_type = 'sponsor'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_decided');
  END IF;

  -- ── SETTLE ────────────────────────────────────────────────────────────────────────
  -- Clamp a partial to the reserved ask (a sponsor cannot fund more than was reserved).
  -- Fall back to requested_amount_cents when nothing was reserved, preserving 0053's
  -- tolerance for legacy rows created before the two-phase model.
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

  -- *** THE P0-5 FIX ***
  -- NO `funding_used_cents = funding_used_cents + v_amount` here. The full reserved
  -- amount was already debited by approve_submission_atomic. On a PARTIAL settlement we
  -- RELEASE the difference; on a FULL settlement the reservation simply becomes the
  -- settlement and the sponsor's balance does not move at all.
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
  VALUES (v_profile.sponsor_id, v_submission.team_id, p_submission_id, v_amount, v_decision_type, 'sponsor');

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor_id, 'sponsor_approve_submission', 'submissions', p_submission_id,
          jsonb_build_object('sponsor_id', v_profile.sponsor_id,
                             'amount_cents', v_amount,
                             'decision_type', v_decision_type));

  RETURN jsonb_build_object('ok', true, 'amount_cents', v_amount);
END;
$$;

-- =====================================================================================
-- VERIFICATION (run after applying — on the scratch project, not production)
--
-- 1. Record the baseline:  SELECT funding_used_cents FROM sponsors WHERE id = '<x>';
-- 2. Admin-approve one pending pitch with ask A. funding_used_cents must be baseline + A.
-- 3. Accept it in the SPONSOR PORTAL (not the email link).
--    funding_used_cents must STILL be baseline + A.   <-- before this fix it was baseline + 2A
--    transactions_ledger gets exactly one row, amount_cents = A, decision_type='full'.
-- 4. Repeat with a partial acceptance of P < A:
--    funding_used_cents must settle at baseline + P, ledger decision_type='partial'.
-- 5. Invariant from the 0047 header must hold:
--      SELECT s.id, s.funding_used_cents,
--             COALESCE((SELECT SUM(reserved_amount_cents) FROM submissions
--                        WHERE sponsor_id=s.id AND status IN ('dispatched','delivered','opened')),0)
--           + COALESCE((SELECT SUM(amount_cents) FROM transactions_ledger WHERE sponsor_id=s.id),0)
--               AS expected
--        FROM sponsors s;
--    funding_used_cents must equal expected for every row.
-- =====================================================================================
