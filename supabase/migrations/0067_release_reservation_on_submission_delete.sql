-- 0067_release_reservation_on_submission_delete.sql
-- =====================================================================================
-- P0-6 (downgraded to P1 by the adversarial pass, but the mechanism is confirmed and
-- worse than originally described): deleting a coach account permanently burns the
-- sponsor capacity their in-flight pitch reserved.
--
-- app/api/webhooks/clerk/route.ts:36-39 is the whole deletion handler — a single
-- .from('profiles').delete(). The chain submissions.team_id -> teams.owner_id ->
-- profiles.id is ON DELETE CASCADE (0008_submissions_pivot.sql:31), so the submission
-- row disappears carrying a live reserved_amount_cents. Nothing calls
-- release_submission_reservation. sponsors.funding_used_cents stays inflated FOREVER,
-- with no row left to explain it and no code path that can release it. Enough deletions
-- and a sponsor's cap is silently exhausted.
--
-- !! DO NOT "FIX" THIS BY REVERTING 0061 !!
-- 0061 made the transactions_ledger FKs nullable ON DELETE SET NULL precisely so that
-- account deletion stops failing with 23503 for any coach whose team has settled
-- funding. Before 0061 the cascade aborted, which is what masked this bug. Reverting
-- re-breaks account deletion. The adversarial pass calls this out explicitly (§16
-- "new issues" item 2).
--
-- A trigger rather than app code, deliberately: the deletion arrives via a Postgres
-- CASCADE, so no application code runs at all. Only the database can see it. This also
-- covers every other deletion path — the admin client, a manual psql DELETE, a future
-- action — none of which can bypass it.
--
-- APPLY WITH:  psql "$DATABASE_URL" -f supabase/migrations/0067_release_reservation_on_submission_delete.sql
-- Idempotent: CREATE OR REPLACE + DROP TRIGGER IF EXISTS.
-- =====================================================================================

CREATE OR REPLACE FUNCTION release_reservation_before_submission_delete()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_released bigint;
BEGIN
  v_released := COALESCE(OLD.reserved_amount_cents, 0);

  -- Only LIVE reservations. A settled ('approved') row's money is recorded in
  -- transactions_ledger and is not a reservation to give back; a terminal row
  -- ('declined','expired','bounced','changes_requested') was already released by
  -- release_submission_reservation, which zeroes reserved_amount_cents. Matching the
  -- guarded state list in 0047:124 keeps this from ever double-refunding.
  IF v_released > 0 AND OLD.status IN ('dispatched', 'delivered', 'opened') THEN
    UPDATE sponsors
       SET funding_used_cents = GREATEST(funding_used_cents - v_released, 0),
           -- Mirror release_submission_reservation (0047:133-135): a sponsor parked at
           -- 'inactive' because it hit its cap becomes bookable again once freed.
           status = CASE
             WHEN status = 'inactive'
              AND (funding_used_cents - v_released) < funding_cap_cents
             THEN 'active'::sponsor_status ELSE status END
     WHERE id = OLD.sponsor_id;

    -- Leave a trace. Without this the release is as invisible as the leak it fixes.
    -- audit_log.entity_id has no FK (0001:180), so logging a row that is being deleted
    -- in this same statement is safe.
    INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata)
    VALUES (NULL, 'release_reservation_on_delete', 'submissions', OLD.id,
            jsonb_build_object('released_cents', v_released,
                               'sponsor_id', OLD.sponsor_id,
                               'team_id', OLD.team_id,
                               'prior_status', OLD.status));
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_release_reservation_on_delete ON submissions;
CREATE TRIGGER trg_release_reservation_on_delete
  BEFORE DELETE ON submissions
  FOR EACH ROW EXECUTE FUNCTION release_reservation_before_submission_delete();

-- =====================================================================================
-- VERIFICATION (on the scratch project)
--
-- 1. Note sponsors.funding_used_cents = B.
-- 2. Admin-approve a pitch with ask A -> funding_used_cents = B + A, submission is
--    'dispatched' with reserved_amount_cents = A.
-- 3. Delete that coach's Clerk user (fires the user.deleted webhook -> profiles delete
--    -> cascade to teams -> submissions).
-- 4. funding_used_cents must be back to B.       <-- before this trigger it stayed B + A
-- 5. audit_log has one 'release_reservation_on_delete' row with released_cents = A.
-- 6. No double-refund: repeat with a submission already 'declined'
--    (reserved_amount_cents = 0) — funding_used_cents must not move.
-- =====================================================================================
