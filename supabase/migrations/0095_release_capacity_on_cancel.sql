-- 0095_release_capacity_on_cancel.sql
--
-- Closes audit finding F-01 (`prompts/_AUDIT-01-10.md`): cancelling a funding fulfillment
-- consumed the sponsor's capacity forever.
--
-- `record_fulfillment_transition`'s `cancelled` branch updated `funding_fulfillments.status`,
-- `cancelled_at` and `cancelled_reason` and nothing else. `sponsors.funding_used_cents` was
-- never decremented, so every cancellation permanently burned that much of the sponsor's cap.
-- A sponsor who pledged $10k, cancelled, and wanted to fund a different team could not — the
-- money was accounted for against a commitment that no longer exists. Reachable today by any
-- sponsor or admin on a `pledged` fulfillment.
--
-- WHY A SEPARATE TABLE AND NOT A REVERSING LEDGER ROW
--
-- `transactions_ledger` is append-only with `CHECK (amount_cents > 0)` (0017:9), and
-- `detect_capacity_drift()` (0084) defines health as
--
--     funding_used_cents = SUM(open reservations) + SUM(every ledger row)
--
-- A negative reversal row would need that CHECK relaxed, and every consumer that SUMs the
-- ledger as money committed — receipts, the impact report, `/sponsor/funding`,
-- `/reconciliation` — would silently start netting cancellations into totals it presents as
-- gross. That is a much larger blast radius than the bug. Instead the release is recorded in
-- its own table and the invariant grows a third term:
--
--     funding_used_cents = open reservations + settled ledger - released capacity
--
-- The ledger keeps its full, unedited history of what was committed; the releases table says
-- what was handed back. Neither erases the other.
--
-- IDEMPOTENCE / REPLAY SAFETY
--
-- `funding_capacity_releases.fulfillment_id` is UNIQUE and the decrement is guarded on the
-- insert actually having happened, so replaying this file, or a retried RPC call, cannot
-- release the same capacity twice. The function's pre-existing `already_cancelled` guard
-- (0094) already refuses a second cancel before reaching here; the UNIQUE constraint is the
-- belt to that suspenders.
--
-- APPLY WITH:  psql "$DATABASE_URL" -f supabase/migrations/0095_release_capacity_on_cancel.sql
-- (contains $$-quoted function bodies — the Supabase CLI splitter mishandles those)

-- -------------------------------------------------------------------------------------
-- 1. The releases table
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS funding_capacity_releases (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  fulfillment_id uuid        NOT NULL UNIQUE REFERENCES funding_fulfillments(id) ON DELETE CASCADE,
  sponsor_id     uuid        NOT NULL REFERENCES sponsors(id) ON DELETE RESTRICT,
  submission_id  uuid        REFERENCES submissions(id) ON DELETE SET NULL,
  amount_cents   bigint      NOT NULL CHECK (amount_cents > 0),
  released_by    uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  reason         text,
  created_at     timestamptz NOT NULL DEFAULT now()
  -- No updated_at: this table is append-only, like transactions_ledger.
);

COMMENT ON TABLE funding_capacity_releases IS
  'One row per cancelled funding fulfillment, recording the sponsor capacity handed back. '
  'Append-only. The third term of the capacity invariant: funding_used_cents = open '
  'reservations + settled ledger - released capacity. Written only by '
  'record_fulfillment_transition().';

CREATE INDEX IF NOT EXISTS idx_capacity_releases_sponsor    ON funding_capacity_releases(sponsor_id);
CREATE INDEX IF NOT EXISTS idx_capacity_releases_submission ON funding_capacity_releases(submission_id);

-- `submission_id` is SET NULL while `fulfillment_id` is CASCADE. Both parents can be reached
-- from a profile deletion, so the two actions must not race inside one statement — same trap
-- documented for the ledger FKs in 0061.
ALTER TABLE funding_capacity_releases
  DROP CONSTRAINT IF EXISTS funding_capacity_releases_submission_id_fkey;
ALTER TABLE funding_capacity_releases
  ADD  CONSTRAINT funding_capacity_releases_submission_id_fkey
  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;

-- -------------------------------------------------------------------------------------
-- 2. RLS — read-only to everyone, written only by the SECURITY DEFINER RPC
-- -------------------------------------------------------------------------------------
ALTER TABLE funding_capacity_releases ENABLE ROW LEVEL SECURITY;

-- No INSERT/UPDATE/DELETE policy anywhere: absent policy = denied under RLS. Same shape as
-- `appeals` (0086) and `submission_messages` (0085).

DROP POLICY IF EXISTS capacity_releases_select_admin ON funding_capacity_releases;
CREATE POLICY capacity_releases_select_admin ON funding_capacity_releases
  FOR SELECT USING (is_admin());

-- Sponsor resolution goes through current_sponsor_ids() (0089), never profiles.sponsor_id —
-- that column is NULL forever for a teammate invited through a Clerk Organization.
DROP POLICY IF EXISTS capacity_releases_select_sponsor ON funding_capacity_releases;
CREATE POLICY capacity_releases_select_sponsor ON funding_capacity_releases
  FOR SELECT USING (
    sponsor_id IS NOT NULL AND sponsor_id = ANY (current_sponsor_ids())
  );

-- The coach on the other side of the cancelled commitment can see that it was released.
DROP POLICY IF EXISTS capacity_releases_select_coach ON funding_capacity_releases;
CREATE POLICY capacity_releases_select_coach ON funding_capacity_releases
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM funding_fulfillments f
      JOIN teams t ON t.id = f.team_id
     WHERE f.id = funding_capacity_releases.fulfillment_id
       AND t.owner_id = current_profile_id()
  ));

-- -------------------------------------------------------------------------------------
-- 3. record_fulfillment_transition — release capacity on cancel
--
-- Body copied verbatim from 0094 (which is itself 0091 plus the sponsor_ids_for_profile
-- fix). The ONLY change is the block marked `0095` after the funding_fulfillments UPDATE.
-- Copying rather than patching is deliberate: this repo has been bitten by a CREATE OR
-- REPLACE that silently reverted a later migration's fix (see 0094's header on 0091).
-- -------------------------------------------------------------------------------------
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
$$;

-- Replacing a function does not preserve a REVOKE you did not re-issue.
REVOKE EXECUTE ON FUNCTION record_fulfillment_transition(uuid, uuid, fulfillment_status, fulfillment_payment_method, text, date, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION record_fulfillment_transition(uuid, uuid, fulfillment_status, fulfillment_payment_method, text, date, text) FROM anon;
REVOKE EXECUTE ON FUNCTION record_fulfillment_transition(uuid, uuid, fulfillment_status, fulfillment_payment_method, text, date, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION record_fulfillment_transition(uuid, uuid, fulfillment_status, fulfillment_payment_method, text, date, text) TO service_role;

-- -------------------------------------------------------------------------------------
-- 4. detect_capacity_drift() — teach the invariant about releases
--
-- Body copied from 0084 with a third LATERAL. Without this the fix above would itself
-- register as drift of exactly the released amount, which is the detector correctly
-- reporting that its model of health no longer matches reality.
-- -------------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS detect_capacity_drift();
CREATE FUNCTION detect_capacity_drift()
RETURNS TABLE (
  sponsor_id uuid,
  company_name text,
  funding_cap_cents bigint,
  funding_used_cents bigint,
  open_reservations_cents bigint,
  settled_ledger_cents bigint,
  released_capacity_cents bigint,
  expected_used_cents bigint,
  drift_cents bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT s.id, s.company_name, s.funding_cap_cents, s.funding_used_cents,
         r.open_cents, l.settled_cents, c.released_cents,
         r.open_cents + l.settled_cents - c.released_cents AS expected_used_cents,
         s.funding_used_cents - (r.open_cents + l.settled_cents - c.released_cents) AS drift_cents
    FROM sponsors s
    CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(sub.reserved_amount_cents), 0)::bigint AS open_cents
        FROM submissions sub
       WHERE sub.sponsor_id = s.id
         AND sub.status IN ('dispatched', 'delivered', 'opened')
    ) r
    CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(tl.amount_cents), 0)::bigint AS settled_cents
        FROM transactions_ledger tl
       WHERE tl.sponsor_id = s.id
    ) l
    CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(cr.amount_cents), 0)::bigint AS released_cents
        FROM funding_capacity_releases cr
       WHERE cr.sponsor_id = s.id
    ) c
   WHERE s.funding_used_cents <> r.open_cents + l.settled_cents - c.released_cents;
$$;

COMMENT ON FUNCTION detect_capacity_drift() IS
  'Read-only detector for violations of the capacity invariant (0047 header, 0065 '
  'verification block, 0095 release term): funding_used_cents = open reservations + settled '
  'ledger - released capacity. Returns one row per drifting sponsor, zero rows when healthy. '
  'Reports only — never repairs; silent repair would erase the evidence of whatever caused '
  'the drift.';

REVOKE EXECUTE ON FUNCTION detect_capacity_drift() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION detect_capacity_drift() FROM anon;
REVOKE EXECUTE ON FUNCTION detect_capacity_drift() FROM authenticated;
GRANT  EXECUTE ON FUNCTION detect_capacity_drift() TO service_role;

-- -------------------------------------------------------------------------------------
-- 5. Backfill: fulfillments cancelled BEFORE this migration never released their capacity.
--
-- Each one gets a release row (so the invariant balances) and a matching decrement. The
-- ON CONFLICT makes this a no-op on every replay. `released_by` is NULL and the reason names
-- the migration, so a backfilled release is distinguishable from one a person drove.
-- -------------------------------------------------------------------------------------
DO $$
DECLARE
  v_row   record;
  v_count int := 0;
BEGIN
  FOR v_row IN
    SELECT f.id, f.sponsor_id, f.submission_id, f.amount_cents
      FROM funding_fulfillments f
     WHERE f.status = 'cancelled'
       AND f.amount_cents > 0
       AND NOT EXISTS (SELECT 1 FROM funding_capacity_releases cr WHERE cr.fulfillment_id = f.id)
  LOOP
    INSERT INTO funding_capacity_releases
      (fulfillment_id, sponsor_id, submission_id, amount_cents, released_by, reason)
    VALUES (v_row.id, v_row.sponsor_id, v_row.submission_id, v_row.amount_cents, NULL,
            'backfill: cancelled before 0095_release_capacity_on_cancel')
    ON CONFLICT (fulfillment_id) DO NOTHING;

    UPDATE sponsors
       SET funding_used_cents = GREATEST(funding_used_cents - v_row.amount_cents, 0),
           status = CASE
             WHEN status = 'inactive'
              AND GREATEST(funding_used_cents - v_row.amount_cents, 0) < funding_cap_cents
             THEN 'active'::sponsor_status ELSE status END
     WHERE id = v_row.sponsor_id;

    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE '0095 backfill: released capacity for % previously-cancelled fulfillment(s)', v_count;
END $$;

-- =====================================================================================
-- VERIFICATION (run after applying)
--
--   -- the invariant holds, including the new term
--   SELECT * FROM detect_capacity_drift();                   -- expect zero rows
--
--   -- the table is read-only to everyone
--   SELECT policyname, cmd FROM pg_policies
--    WHERE schemaname='public' AND tablename='funding_capacity_releases';
--   -- expect exactly three SELECT rows, no INSERT/UPDATE/DELETE
--
--   -- one release per cancelled fulfillment, never two
--   SELECT count(*) FROM funding_fulfillments WHERE status='cancelled';
--   SELECT count(*) FROM funding_capacity_releases;          -- expect equal
-- =====================================================================================
