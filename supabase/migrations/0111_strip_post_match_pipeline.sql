-- 0111_strip_post_match_pipeline.sql
-- APPLY WITH: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0111_strip_post_match_pipeline.sql
-- Contains $$-quoted function bodies -- the Supabase CLI splitter mishandles them. psql -f only.
-- Idempotent (IF EXISTS / CREATE OR REPLACE / guarded DO blocks); replaying is a no-op.
--
-- ============================================================================================
-- WHAT THIS DOES
--
-- The platform never touches funds. Everything downstream of "sponsor says yes" -- the
-- e-signature layer, the payment state machine, W-9 collection, tax receipts and the
-- recognition-tier ladder -- was bookkeeping about a transaction happening somewhere else.
-- It is removed here. The product becomes: coach pitches, admin moderates, sponsor accepts
-- (in full or for less), both sides get each other's contact details, and the app is done.
--
-- The immediate trigger was that 0079 seeds a sponsorship_agreement template carrying an
-- unresolved `TODO(legal): jurisdiction to be set by counsel.` clause, and 0106 makes
-- sign_agreement_atomic refuse ANY signature while needs_legal_review is set. Because
-- payment_sent was gated on both signatures, one unwritten clause froze the whole money path.
--
-- ============================================================================================
-- HOW THE TWO REDEFINED FUNCTIONS WERE PRODUCED  -- READ THIS BEFORE EDITING
--
-- sponsor_decide_submission_atomic and refresh_public_platform_stats below were dumped LIVE
-- with pg_get_functiondef and patched in place. They were NOT rebuilt from an older migration.
--
-- This is not ceremony. The live sponsor_decide_submission_atomic differs from its apparent
-- source (0100) by an entire authorization branch: the `ELSIF is_trusted_server_context()`
-- guard added by 0101 to close A-02-02, where a JWT-less caller could name any sponsor
-- profile and act as it. Anyone who had "helpfully" rebuilt this body from 0100 would have
-- silently reverted a P0 tenant-takeover fix. That failure mode has occurred three times in
-- this repository. Dump the live body; diff it; patch it; never retype it.
--
-- record_sponsor_decision_atomic (the emailed-token twin) needed NO change -- its live body
-- never inserted into funding_fulfillments. Only the portal path did. It is untouched here.
--
-- ============================================================================================
-- PRE-FLIGHT PERFORMED (2026-08-24, production)
--
--   agreement_signatures            2   -- both "Dev Coach"/"Dev Sponsor" @example.com seeds
--   agreement_templates             1   -- the unreviewed TODO(legal) seed from 0079
--   funding_fulfillments            1   -- orphaned (submission_id NULL) in agreement_signed
--   funding_fulfillment_events      2
--   recognition_tiers               4   -- seeded ladder
--   sponsor_recognition_awards      1
--   recognition_benefit_deliveries  2
--   funding_receipts                0
--   team_payout_profiles            0
--   funding_capacity_releases       0
--   submissions                     0
--   profiles                        1   -- admin+clerk_test@example.com; there are no real users
--
-- storage: executed-agreements held 4 objects (2 of them prepared-*.html, uploaded on mere
-- VISITS to a sign page, before anyone signed). Both buckets were emptied through the Storage
-- API before this migration ran -- a raw DELETE FROM storage.objects drops the metadata row
-- without telling the storage backend to remove the file, orphaning the blob permanently.
-- ============================================================================================

BEGIN;

-- --------------------------------------------------------------------------------------------
-- 1. The belt-and-braces trigger goes FIRST.
--
-- guard_fulfillment_requires_signed_agreement is a BEFORE UPDATE on funding_fulfillments whose
-- body calls agreement_is_signed(). It has to stop firing before step 3 rewrites a row and
-- before step 6 removes its callee.
--
-- create_recognition_award is the OTHER trigger on this table -- recognition awards were minted
-- from fulfillment transitions. It is dropped with the table in step 7; its functions in step 6.
-- --------------------------------------------------------------------------------------------
-- `DROP TRIGGER IF EXISTS ... ON funding_fulfillments` still errors if the TABLE is gone, so
-- this is guarded on the relation rather than the trigger -- otherwise a replay dies here.
DO $$
BEGIN
  IF to_regclass('public.funding_fulfillments') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_fulfillment_requires_signed_agreement ON funding_fulfillments';
  END IF;
END $$;

-- --------------------------------------------------------------------------------------------
-- 2. Redefine sponsor_decide_submission_atomic (live dump, patched).
--
-- Exactly two things were removed from the dumped body: the INSERT INTO funding_fulfillments
-- and the INSERT INTO funding_fulfillment_events that followed the transactions_ledger insert,
-- plus the now-unused v_fulfillment_id declaration.
--
-- Everything else is byte-for-byte the live body, including:
--   * the 0101 `ELSIF is_trusted_server_context()` actor branch (A-02-02, see header)
--   * the 0100 signed-delta capacity reconciliation (v_prior_reserved / v_delta), which is
--     what makes a partial offer release the unfunded remainder back to the sponsor's cap
--   * the already_decided guard against transactions_ledger
--   * the GREATEST(x - n, 0) floor and the inactive -> active reactivation idiom
--
-- transactions_ledger remains the single source of truth for settled funding. It is append-only
-- and is now the ONLY record of a match, which is why step 4 teaches it about voids.
-- --------------------------------------------------------------------------------------------
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
  v_prior_reserved bigint;
  v_delta      bigint;
  v_sponsor    sponsors%ROWTYPE;
BEGIN
  IF (auth.jwt() ->> 'sub') IS NOT NULL THEN
    v_actor_id := current_profile_id();
    IF v_actor_id IS NULL OR v_actor_id <> p_sponsor_user_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
    END IF;
  ELSIF is_trusted_server_context() THEN
    -- A-02-02. The ELSE branch used to be a bare `v_actor_id := p_sponsor_user_id`,
    -- which trusts a caller-supplied profile id whenever there is no JWT `sub`. anon
    -- also has no `sub`, so an anon caller could name any sponsor profile and act as
    -- it. Only EXECUTE having been revoked from PUBLIC/anon in 0062 kept that from
    -- being reachable -- one loosened grant away from a tenant takeover.
    -- is_trusted_server_context() is FALSE for anon (it carries role='anon'), TRUE only
    -- for service_role or a JWT-less direct connection, which is the real caller here.
    v_actor_id := p_sponsor_user_id;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
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

  -- Capacity reconciliation against what this submission ALREADY holds. Note this reads
  -- v_submission.reserved_amount_cents (the true prior reservation), NOT v_reserved, which
  -- has been overwritten with the requested amount by the fallback above.
  v_prior_reserved := COALESCE(v_submission.reserved_amount_cents, 0);
  v_delta := v_amount - v_prior_reserved;

  IF v_delta > 0 THEN
    -- Committing MORE than is reserved. For a legacy row (reserved 0/NULL) that is the
    -- entire amount, and nothing has checked it against the cap yet.
    SELECT * INTO v_sponsor FROM sponsors WHERE id = v_submission.sponsor_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'submission_not_found');
    END IF;

    IF (v_sponsor.funding_used_cents + v_delta) > v_sponsor.funding_cap_cents THEN
      RETURN jsonb_build_object('ok', false, 'error', 'insufficient_capacity');
    END IF;

    UPDATE sponsors
       SET funding_used_cents = funding_used_cents + v_delta,
           status = CASE WHEN funding_used_cents + v_delta >= funding_cap_cents
                         THEN 'inactive'::sponsor_status ELSE status END
     WHERE id = v_submission.sponsor_id;

  ELSIF v_delta < 0 THEN
    -- Funded less than reserved: release the unused remainder. Unchanged behaviour.
    UPDATE sponsors
       SET funding_used_cents =
             GREATEST(funding_used_cents - (v_prior_reserved - v_amount), 0),
           status = CASE
             WHEN status = 'inactive'
              AND (funding_used_cents - (v_prior_reserved - v_amount)) < funding_cap_cents
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

  -- 0111: the two pledge-row inserts that stood here (into the fulfillment table and its
  -- event log) are gone with those tables. transactions_ledger is now the complete record of
  -- a match. Deliberately not naming the dropped tables here -- a post-condition check that
  -- greps this body for them should find nothing, including in a comment.

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor_id, 'sponsor_approve_submission', 'submissions', p_submission_id,
          jsonb_build_object('sponsor_id', v_submission.sponsor_id,
                             'amount_cents', v_amount,
                             'decision_type', v_decision_type,
                             'transaction_id', v_txn_id));

  RETURN jsonb_build_object('ok', true, 'amount_cents', v_amount);
END;
$function$;

-- CREATE OR REPLACE does not preserve REVOKEs that were issued separately. Re-issue them.
REVOKE EXECUTE ON FUNCTION public.sponsor_decide_submission_atomic(uuid, uuid, text, text, bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sponsor_decide_submission_atomic(uuid, uuid, text, text, bigint) FROM anon;
REVOKE EXECUTE ON FUNCTION public.sponsor_decide_submission_atomic(uuid, uuid, text, text, bigint) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.sponsor_decide_submission_atomic(uuid, uuid, text, text, bigint) TO service_role;

-- --------------------------------------------------------------------------------------------
-- 3. Normalise the one row still sitting in a retired fulfillment state.
--
-- Runs before the drops purely so the audit trail records what was there. The table goes in
-- step 7 regardless; this exists so the disposition is written down rather than inferred.
-- --------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.funding_fulfillments') IS NOT NULL THEN
    EXECUTE $q$
      INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata)
      SELECT NULL, 'fulfillment_dropped_by_0111', 'funding_fulfillments', f.id,
             jsonb_build_object('status', f.status, 'amount_cents', f.amount_cents,
                                'sponsor_id', f.sponsor_id, 'submission_id', f.submission_id,
                                'migration', '0111')
        FROM funding_fulfillments f
    $q$;
  END IF;
END $$;

-- --------------------------------------------------------------------------------------------
-- 4. Teach transactions_ledger about voids.
--
-- Removing funding_fulfillments removes the ONLY path that could release a sponsor's capacity
-- after they said yes: cancelling a fulfillment (0095). release_submission_reservation is
-- guarded to pre-decision statuses (dispatched/delivered/opened) and cannot help here. Without
-- a replacement, a match that falls through burns that sponsor's cap permanently and they
-- silently go 'inactive' with no recourse but a hand-edit -- a Capacity Integrity violation.
--
-- The ledger is append-only, so a void is a COMPENSATING NEGATIVE ROW, never a delete. That
-- keeps SUM(amount_cents) per sponsor correct by construction and leaves both halves of the
-- history readable.
--
-- This requires widening amount_cents_check, which was CHECK (amount_cents > 0). The paired
-- constraint below keeps the sign and the decision_type from ever disagreeing: a void is
-- negative, a real match is positive, and neither can be written the other way round.
-- --------------------------------------------------------------------------------------------
ALTER TABLE transactions_ledger DROP CONSTRAINT IF EXISTS transactions_ledger_amount_cents_check;
ALTER TABLE transactions_ledger DROP CONSTRAINT IF EXISTS transactions_ledger_decision_type_check;
ALTER TABLE transactions_ledger DROP CONSTRAINT IF EXISTS transactions_ledger_void_sign_check;

ALTER TABLE transactions_ledger
  ADD CONSTRAINT transactions_ledger_amount_cents_check CHECK (amount_cents <> 0);
ALTER TABLE transactions_ledger
  ADD CONSTRAINT transactions_ledger_decision_type_check
  CHECK (decision_type = ANY (ARRAY['full'::text, 'partial'::text, 'void'::text]));
ALTER TABLE transactions_ledger
  ADD CONSTRAINT transactions_ledger_void_sign_check
  CHECK ((decision_type = 'void') = (amount_cents < 0));

COMMENT ON COLUMN transactions_ledger.decision_type IS
  'full | partial | void. A ''void'' row is the compensating reversal of an earlier match: '
  'its amount_cents is NEGATIVE and equal in magnitude to the row it reverses, so SUM() over '
  'a sponsor stays correct without mutating history. Written only by void_match_atomic (0111).';

-- --------------------------------------------------------------------------------------------
-- 5. void_match_atomic -- the admin reversal path.
--
-- Mirrors the release half of sponsor_decide_submission_atomic deliberately: same GREATEST()
-- floor, same inactive -> active reactivation rule. If you change one, change both.
--
-- The submission lands in 'withdrawn' (added by 0107). That matters beyond tidiness: the
-- decision RPCs only accept dispatched/delivered/opened, so a voided submission cannot be
-- re-decided, and the already_decided guard still sees the original ledger row.
-- --------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.void_match_atomic(p_submission_id uuid, p_admin_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id   uuid;
  v_submission submissions%ROWTYPE;
  v_net        bigint;
  v_txn_id     uuid;
BEGIN
  -- Actor resolution copied from sponsor_decide_submission_atomic, including the A-02-02
  -- shape: a JWT-less caller is trusted ONLY when is_trusted_server_context() holds, which
  -- is false for anon. Do not collapse this into a bare assignment.
  IF (auth.jwt() ->> 'sub') IS NOT NULL THEN
    v_actor_id := current_profile_id();
    IF v_actor_id IS NULL OR v_actor_id <> p_admin_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
    END IF;
  ELSIF is_trusted_server_context() THEN
    v_actor_id := p_admin_id;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = v_actor_id AND p.role = 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'reason_required');
  END IF;

  SELECT * INTO v_submission FROM submissions WHERE id = p_submission_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'submission_not_found');
  END IF;
  IF v_submission.status <> 'approved' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_approved',
                              'current_status', v_submission.status);
  END IF;

  -- Net of every ledger row for this submission, so a second void is a no-op rather than a
  -- double credit. This is the idempotency guard; do not replace it with a bare lookup of
  -- the original row.
  SELECT COALESCE(SUM(tl.amount_cents), 0) INTO v_net
    FROM transactions_ledger tl
   WHERE tl.submission_id = p_submission_id AND tl.actor_type = 'sponsor';

  IF v_net <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_voided');
  END IF;

  INSERT INTO transactions_ledger (sponsor_id, team_id, submission_id, amount_cents, decision_type, actor_type)
  VALUES (v_submission.sponsor_id, v_submission.team_id, p_submission_id, -v_net, 'void', 'admin')
  RETURNING id INTO v_txn_id;

  -- Same idiom as the release half of sponsor_decide_submission_atomic and as 0095.
  UPDATE sponsors
     SET funding_used_cents = GREATEST(funding_used_cents - v_net, 0),
         status = CASE
           WHEN status = 'inactive' AND GREATEST(funding_used_cents - v_net, 0) < funding_cap_cents
           THEN 'active'::sponsor_status ELSE status END
   WHERE id = v_submission.sponsor_id;

  UPDATE submissions
     SET status = 'withdrawn', reserved_amount_cents = 0, reviewed_by = v_actor_id
   WHERE id = p_submission_id;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor_id, 'void_match', 'submissions', p_submission_id,
          jsonb_build_object('sponsor_id', v_submission.sponsor_id,
                             'team_id', v_submission.team_id,
                             'released_cents', v_net,
                             'reason', p_reason,
                             'transaction_id', v_txn_id));

  RETURN jsonb_build_object('ok', true, 'released_cents', v_net, 'transaction_id', v_txn_id);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.void_match_atomic(uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.void_match_atomic(uuid, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.void_match_atomic(uuid, uuid, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.void_match_atomic(uuid, uuid, text) TO service_role;

-- --------------------------------------------------------------------------------------------
-- 6. Drop the functions, before the tables they read.
-- --------------------------------------------------------------------------------------------
-- The view first: it selects from team_payout_profiles.
DROP VIEW IF EXISTS v_team_payout_public;

-- NOTE ON ORDER: only functions with NO trigger still attached can go here. A trigger is a
-- hard dependency -- `DROP FUNCTION guard_agreement_signature_append_only()` fails while
-- trg_agreement_signature_append_only exists on agreement_signatures. The guard/trigger
-- functions therefore drop in step 8, after their tables have taken their triggers with them.
-- CASCADE would paper over this and is deliberately not used: it would also silently drop
-- anything else that happened to depend on these, which is exactly what we want to be told about.

-- Agreements
DROP FUNCTION IF EXISTS sign_agreement_atomic(uuid, uuid, text, uuid, text, text, text, text, text, text, jsonb);
DROP FUNCTION IF EXISTS publish_agreement_version(uuid, uuid);

-- Receipts (issue_funding_receipt calls record_fulfillment_transition, so it goes first)
DROP FUNCTION IF EXISTS issue_funding_receipt(uuid, uuid, receipt_variant, text, text, text, text, text, text, bigint, text, text, text, timestamptz, uuid);
DROP FUNCTION IF EXISTS void_funding_receipt(uuid, uuid, text);

-- Fulfillment
DROP FUNCTION IF EXISTS record_fulfillment_transition(uuid, uuid, fulfillment_status, fulfillment_payment_method, text, date, text);

-- Recognition
DROP FUNCTION IF EXISTS create_recognition_award_for_fulfillment(uuid);
DROP FUNCTION IF EXISTS admin_upsert_recognition_tier(uuid, uuid, text, integer, bigint, bigint, recognition_benefit_type[], text);
DROP FUNCTION IF EXISTS admin_archive_recognition_tier(uuid, uuid);
DROP FUNCTION IF EXISTS recognition_tier_for_amount(bigint);
DROP FUNCTION IF EXISTS recognition_tier_ladder();
-- Named for the benefit, not the subsystem, so it does not appear in a `%recognition%` sweep.
-- Found by asking pg_proc which functions take a doomed enum in their signature, which is the
-- only reliable way to enumerate these -- a name-pattern search will miss one.
DROP FUNCTION IF EXISTS record_benefit_delivery(uuid, uuid, recognition_delivery_status, text, boolean, text);
DROP FUNCTION IF EXISTS void_benefit_proof(uuid, uuid, text);

-- Payout / W-9
-- Both signatures verified against pg_proc. `DROP FUNCTION IF EXISTS` matches on the ARGUMENT
-- LIST as well as the name, so a wrong arity here is a silent no-op that leaves the function
-- behind -- which is exactly what happened to set_payout_ein on the first pass (it takes five
-- arguments, not four). Do not hand-count these; read them off pg_get_function_identity_arguments.
DROP FUNCTION IF EXISTS get_payout_ein(uuid, text, text);
DROP FUNCTION IF EXISTS set_payout_ein(uuid, uuid, text, text, text);

-- Fiscal-year helper: only ever used with sponsors.fiscal_year_start_month, dropped in step 9.
DROP FUNCTION IF EXISTS fiscal_year_of(timestamptz, smallint);

-- --------------------------------------------------------------------------------------------
-- 7. Drop the tables, in FK dependency order.
--
-- DROP TABLE takes the table's RLS policies, indexes and attached triggers with it. They are
-- deliberately not listed one by one -- enumerating them invites the list to drift.
-- --------------------------------------------------------------------------------------------
DROP TABLE IF EXISTS agreement_signatures;            -- FK -> agreement_templates (ON DELETE RESTRICT)
DROP TABLE IF EXISTS agreement_templates;

DROP TABLE IF EXISTS recognition_benefit_deliveries;  -- FK -> sponsor_recognition_awards
DROP TABLE IF EXISTS sponsor_recognition_awards;      -- FK -> recognition_tiers
DROP TABLE IF EXISTS recognition_tiers;

DROP TABLE IF EXISTS funding_receipts;                -- FK -> funding_fulfillments
DROP TABLE IF EXISTS funding_receipt_counters;
DROP TABLE IF EXISTS funding_capacity_releases;       -- FK -> funding_fulfillments
DROP TABLE IF EXISTS funding_fulfillment_events;      -- FK -> funding_fulfillments
DROP TABLE IF EXISTS funding_fulfillments;            -- FK -> transactions_ledger (RESTRICT)

DROP TABLE IF EXISTS team_payout_profiles;

-- NOT DROPPED: pending_storage_deletions. It looks like W-9 machinery and is not --
-- lib/credentials-retention.ts uses it at seven call sites to retry failed COACH PHOTO-ID
-- purges, which this migration keeps. Dropping it would break PII retention.

-- --------------------------------------------------------------------------------------------
-- 8. Functions that were depended on by a TRIGGER or an RLS POLICY, now that step 7 has taken
--    both with the tables. Postgres treats each as a hard dependency, which is why none of
--    these could go in step 6.
-- --------------------------------------------------------------------------------------------
-- Referenced by RLS policies (e.g. fulfillment_events_select on funding_fulfillment_events).
DROP FUNCTION IF EXISTS can_read_fulfillment(uuid);
DROP FUNCTION IF EXISTS can_read_recognition_award(uuid);

-- Referenced by BEFORE INSERT/UPDATE/DELETE triggers.
DROP FUNCTION IF EXISTS guard_agreement_signature_append_only();
DROP FUNCTION IF EXISTS guard_agreement_template_immutable();
DROP FUNCTION IF EXISTS guard_agreement_template_no_delete();
DROP FUNCTION IF EXISTS guard_payout_profile_writable_columns();
DROP FUNCTION IF EXISTS trg_create_recognition_award();

-- Last, because steps 1, 6 and 8 held its only callers.
DROP FUNCTION IF EXISTS guard_fulfillment_requires_signed_agreement();
DROP FUNCTION IF EXISTS agreement_is_signed(uuid);

-- --------------------------------------------------------------------------------------------
-- 9. Drop the enum types.
--
-- Every one of these was used only by the tables dropped above (verified against pg_attribute
-- before writing this), so they now drop cleanly rather than leaving retired values behind.
-- --------------------------------------------------------------------------------------------
DROP TYPE IF EXISTS fulfillment_status;
DROP TYPE IF EXISTS fulfillment_payment_method;
DROP TYPE IF EXISTS receipt_status;
DROP TYPE IF EXISTS receipt_variant;
DROP TYPE IF EXISTS recognition_benefit_type;
DROP TYPE IF EXISTS recognition_delivery_status;

-- Column that existed solely to drive receipt fiscal-year reporting (0110).
ALTER TABLE sponsors DROP COLUMN IF EXISTS fiscal_year_start_month;

-- --------------------------------------------------------------------------------------------
-- 9. Storage: policies, then rows, then buckets (storage.objects FKs storage.buckets).
--
-- Both buckets were emptied through the Storage API first -- see the pre-flight note in the
-- header. The DELETE below is a belt-and-braces no-op that also covers a replay.
-- --------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "executed_agreements_select_own"             ON storage.objects;
DROP POLICY IF EXISTS "executed_agreements_select_admin"           ON storage.objects;
DROP POLICY IF EXISTS "Coaches can upload their own tax documents" ON storage.objects;
DROP POLICY IF EXISTS "Coaches can see their own tax documents"    ON storage.objects;
DROP POLICY IF EXISTS "Coaches can delete their own tax documents" ON storage.objects;
DROP POLICY IF EXISTS "Admins can see all tax documents"           ON storage.objects;

-- Supabase installs a trigger that REFUSES both `DELETE FROM storage.objects` AND
-- `DELETE FROM storage.buckets`:
--   "Direct deletion from storage tables is not allowed. Use the Storage API instead."
-- The guard exists for the same reason the pre-flight used the API: a SQL delete drops the
-- metadata row and orphans the file in the storage backend forever.
--
-- So THE BUCKETS THEMSELVES CANNOT BE DROPPED BY THIS MIGRATION. Removing their RLS policies
-- above is all the SQL layer can do. Deleting the two now-empty buckets is a Storage API call
-- and lives in scripts/drop-retired-buckets.mjs, which the runbook sequences AFTER this file.
-- All this block does is assert the operator emptied them, so a half-done pre-flight fails
-- loudly here rather than leaving orphaned blobs nobody ever looks at again.
DO $$
DECLARE v_left int;
BEGIN
  SELECT count(*) INTO v_left FROM storage.objects
   WHERE bucket_id IN ('executed-agreements', 'tax-documents');
  IF v_left > 0 THEN
    RAISE EXCEPTION
      'PRE-FLIGHT NOT DONE: % object(s) still in executed-agreements/tax-documents. Empty them '
      'through the Storage API first (see the pre-flight note in this file''s header); a SQL '
      'delete is blocked and would orphan the blobs anyway.', v_left;
  END IF;
END $$;

-- --------------------------------------------------------------------------------------------
-- 9b. Repair detect_capacity_drift -- it reads funding_capacity_releases, which step 7 dropped.
--
-- THIS ONE NEARLY GOT MISSED, AND THE REASON IS INSTRUCTIVE. Reading 0084 (where the function
-- is introduced) shows a body over `submissions` and `transactions_ledger` only -- nothing this
-- migration touches. But 0095 later added a THIRD term, funding_capacity_releases, to account
-- for capacity handed back when a fulfillment was cancelled. Only the live pg_get_functiondef
-- shows that. Judging a function by its introducing migration is the same mistake the header
-- warns about, and here it would have shipped a drift detector that throws on every call --
-- silently disabling the Capacity Integrity check rather than failing it.
--
-- The releases term is not replaced by anything, because it no longer has a job: capacity given
-- back by a void is recorded AS A NEGATIVE LEDGER ROW (step 4), so SUM(tl.amount_cents) already
-- nets it out. The invariant returns to its original, simpler 0084 form:
--
--     funding_used_cents = open_reservations + net_ledger
--
-- The RETURNS TABLE loses released_capacity_cents, so this is a DROP + CREATE; CREATE OR REPLACE
-- cannot change a function's return type. Callers that select that column must be updated:
-- app/actions/capacity-audit.ts, scripts/verify-capacity-invariant.mjs,
-- lib/__tests__/capacity-invariant.test.ts.
-- --------------------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS detect_capacity_drift();

CREATE FUNCTION public.detect_capacity_drift()
 RETURNS TABLE(sponsor_id uuid, company_name text, funding_cap_cents bigint, funding_used_cents bigint, open_reservations_cents bigint, settled_ledger_cents bigint, expected_used_cents bigint, drift_cents bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT s.id, s.company_name, s.funding_cap_cents, s.funding_used_cents,
         r.open_cents, l.settled_cents,
         r.open_cents + l.settled_cents AS expected_used_cents,
         s.funding_used_cents - (r.open_cents + l.settled_cents) AS drift_cents
    FROM sponsors s
    CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(sub.reserved_amount_cents), 0)::bigint AS open_cents
        FROM submissions sub
       WHERE sub.sponsor_id = s.id
         AND sub.status IN ('dispatched', 'delivered', 'opened')
    ) r
    CROSS JOIN LATERAL (
      -- Nets voids automatically: a 'void' row is negative (see transactions_ledger_void_sign_check).
      SELECT COALESCE(SUM(tl.amount_cents), 0)::bigint AS settled_cents
        FROM transactions_ledger tl
       WHERE tl.sponsor_id = s.id
    ) l
   WHERE s.funding_used_cents <> r.open_cents + l.settled_cents;
$function$;

COMMENT ON FUNCTION detect_capacity_drift() IS
  'Capacity Integrity verification: funding_used_cents = open reservations + net ledger. '
  'Returns one row per sponsor that violates it; an empty result is the passing state. '
  'The funding_capacity_releases term added by 0095 was removed by 0111 along with the '
  'fulfillment layer -- released capacity is now a negative transactions_ledger row instead.';

REVOKE EXECUTE ON FUNCTION detect_capacity_drift() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION detect_capacity_drift() FROM anon;
REVOKE EXECUTE ON FUNCTION detect_capacity_drift() FROM authenticated;
GRANT  EXECUTE ON FUNCTION detect_capacity_drift() TO service_role;

-- --------------------------------------------------------------------------------------------
-- 10. Reshape public_platform_stats, THEN re-source the function that writes it.
--
-- Order matters: the redefined body below references dollars_matched_cents, so the rename has
-- to land first. (A plpgsql body is not column-checked at creation time, so getting this
-- backwards would still "work" -- and then fail at 04:00 UTC inside the cron. Do not reorder.)
-- --------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'public_platform_stats' AND column_name = 'dollars_pledged_cents') THEN
    ALTER TABLE public_platform_stats RENAME COLUMN dollars_pledged_cents TO dollars_matched_cents;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'public_platform_stats' AND column_name = 'dollars_received_cents') THEN
    ALTER TABLE public_platform_stats DROP COLUMN dollars_received_cents;
  END IF;
END $$;

COMMENT ON COLUMN public_platform_stats.dollars_matched_cents IS
  'Net sum of transactions_ledger.amount_cents -- what sponsors COMMITTED TO at decision time. '
  'The platform never touches funds and nothing verifies the money arrived, so any user-facing '
  'label for this figure must say "matched", never "funded" or "received".';

--
-- Live dump, patched. The old body aggregated funding_fulfillments and reported two figures:
-- dollars_pledged (everything not cancelled) and dollars_received (only payment_received /
-- receipted). Nothing tracks receipt any more, so the honest shape is ONE number.
--
-- Sourcing from transactions_ledger makes voids self-cancelling: the negative row nets the
-- original out of both the money total and, via the HAVING, the team count. A team whose only
-- match was voided correctly stops being counted as supported.
--
-- The funded-teams-only rule for reach metrics is preserved verbatim from the original, and so
-- is the reason it exists: advertising the reach of teams nobody funded would be a lie.
-- --------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_public_platform_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_teams    int;
  v_sponsors int;
  v_matched  bigint;
  v_students int;
  v_events   int;
  v_hours    int;
BEGIN
  -- Teams with a POSITIVE net across the ledger. A voided match nets to zero and drops out.
  WITH per_team AS (
    SELECT tl.team_id, SUM(tl.amount_cents) AS net_cents
      FROM transactions_ledger tl
     WHERE tl.team_id IS NOT NULL
     GROUP BY tl.team_id
    HAVING SUM(tl.amount_cents) > 0
  )
  SELECT COUNT(*), COALESCE(SUM(net_cents), 0) INTO v_teams, v_matched FROM per_team;

  SELECT COUNT(*) INTO v_sponsors FROM sponsors WHERE status = 'active';

  -- Summed over the DISTINCT FUNDED teams only, never over every team on the platform.
  -- Advertising the reach of teams nobody funded would be a lie.
  SELECT COALESCE(SUM(t.students_reached), 0),
         COALESCE(SUM(t.events_hosted), 0),
         COALESCE(SUM(t.volunteer_hours), 0)
    INTO v_students, v_events, v_hours
    FROM teams t
   WHERE t.deleted_at IS NULL
     AND t.id IN (SELECT tl.team_id FROM transactions_ledger tl
                   WHERE tl.team_id IS NOT NULL
                   GROUP BY tl.team_id
                  HAVING SUM(tl.amount_cents) > 0);

  INSERT INTO public_platform_stats (
    id, teams_supported, sponsors_active, dollars_matched_cents,
    students_reached, events_hosted, volunteer_hours, refreshed_at
  ) VALUES (
    true, v_teams, v_sponsors, v_matched, v_students, v_events, v_hours, now()
  )
  ON CONFLICT (id) DO UPDATE SET
    teams_supported       = EXCLUDED.teams_supported,
    sponsors_active       = EXCLUDED.sponsors_active,
    dollars_matched_cents = EXCLUDED.dollars_matched_cents,
    students_reached      = EXCLUDED.students_reached,
    events_hosted         = EXCLUDED.events_hosted,
    volunteer_hours       = EXCLUDED.volunteer_hours,
    refreshed_at          = EXCLUDED.refreshed_at;

  RETURN jsonb_build_object(
    'ok', true, 'teams_supported', v_teams, 'sponsors_active', v_sponsors,
    'dollars_matched_cents', v_matched
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.refresh_public_platform_stats() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refresh_public_platform_stats() FROM anon;
REVOKE EXECUTE ON FUNCTION public.refresh_public_platform_stats() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.refresh_public_platform_stats() TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
