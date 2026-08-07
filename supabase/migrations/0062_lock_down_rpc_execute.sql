-- 0062_lock_down_rpc_execute.sql
-- =====================================================================================
-- P0-1: every privileged SECURITY DEFINER function is executable by PUBLIC.
--
-- Postgres grants EXECUTE to PUBLIC on new functions by default. Across migrations
-- 0001-0061 there are exactly three REVOKE EXECUTE statements, all in
-- 0055_coach_denial_and_throttle.sql:61-63, all for check_throttle. Every other
-- privileged function — including every function that moves money — was left open,
-- and PostgREST exposes all of them at /rest/v1/rpc/<name> to the anon key.
--
-- Verified live against production on 2026-08-06 (nil UUID, anon key, no auth header):
--   approve_submission_atomic   -> {"ok":false,"error":"submission_not_found"}  (body RAN)
--   expire_overdue_submissions  -> {"ok":true,"expired":0}                      (body RAN)
-- A permission failure returns 42501. These are business-logic returns.
--
-- Zero-risk claim, re-verified at HEAD: all 10 RPC call sites in the app use the
-- service-role admin client (createAdminClient()), which bypasses these grants:
--   app/actions/moderation.ts:32,131,192   app/actions/sponsor-decision.ts:60,137
--   app/actions/sponsor.ts:25              app/actions/auth.ts:275,280
--   app/api/cron/expire-submissions/route.ts:39 (createAdminClient, :32)
--   app/api/webhooks/resend/route.ts:106        (createAdminClient, :65)
-- increment_sponsor_funding has ZERO call sites in app code (only in the generated
-- lib/supabase/types.ts). Revoking cannot break a single code path.
--
-- Two parts:
--   1. Revoke EXECUTE from PUBLIC/anon/authenticated on the 7 privileged RPCs.
--   2. Defence in depth: stop approve_submission_atomic trusting a caller-supplied
--      actor id (§16 "new issues" item 1).
--
-- DELIBERATELY NOT REVOKED: current_profile_id(), is_admin(), is_coach_verified().
-- These are SECURITY DEFINER too, but they are invoked *inside RLS policy
-- expressions*, which evaluate as the calling role. Revoking them from
-- anon/authenticated would make every policy on every table raise 42501 and lock
-- out every user. They disclose nothing (each returns only facts about the caller's
-- own session).
--
-- APPLY WITH:  psql "$DATABASE_URL" -f supabase/migrations/0062_lock_down_rpc_execute.sql
-- (This file defines a $$-quoted DO block and a $$-quoted function; the Supabase CLI
--  statement splitter mishandles those — see .claude/rules/workflows.md.)
--
-- Idempotent: REVOKE/GRANT are naturally idempotent; the function uses CREATE OR REPLACE.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1. Revoke EXECUTE on every overload of each privileged RPC.
--    Iterating pg_proc by NAME (rather than hardcoding signatures as the audit report
--    proposed) covers overloads and any signature drift between the migration files and
--    what is actually deployed. A hardcoded signature that does not match raises 42883
--    and aborts; this form cannot silently miss a live overload.
-- -------------------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  v_count int := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN (
         'approve_submission_atomic',
         'admin_terminal_decision_atomic',
         'sponsor_decide_submission_atomic',
         'record_sponsor_decision_atomic',
         'release_submission_reservation',
         'expire_overdue_submissions',
         'increment_sponsor_funding'
       )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', r.sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', r.sig);
    EXECUTE format('GRANT  EXECUTE ON FUNCTION %s TO service_role', r.sig);
    v_count := v_count + 1;
    RAISE NOTICE 'locked down %', r.sig;
  END LOOP;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'refusing to continue: matched 0 privileged functions in schema public';
  END IF;
  RAISE NOTICE 'locked down % function(s)', v_count;
END $$;

-- -------------------------------------------------------------------------------------
-- 2. approve_submission_atomic — stop trusting the caller-supplied actor.
--
--    Original (0047:33-99) takes p_admin_id as a parameter and NEVER checks it, then
--    writes it into submissions.reviewed_by AND audit_log.actor_id. With PUBLIC EXECUTE
--    that let any caller forge an audit row with an attacker-chosen actor_id.
--
--    The obvious hardening — "derive the actor from current_profile_id() and assert
--    is_admin()" — WOULD BREAK EVERY LEGITIMATE CALL. The only caller is the
--    service-role admin client, which carries no Clerk JWT, so auth.jwt() is NULL,
--    current_profile_id() returns NULL and is_admin() returns false. Every approval
--    would fail 'forbidden'.
--
--    So the check is context-aware, mirroring the pattern prevent_role_elevation()
--    already uses in 0051:66-81:
--      * Interactive caller (a Clerk 'sub' is present): ignore p_admin_id entirely and
--        derive the actor from the session; require is_admin().
--      * Trusted server context (no 'sub' — service role): p_admin_id must resolve to a
--        real profiles row with role='admin'. A forged/nil/coach id is now rejected.
--    Either way the value written to audit_log.actor_id is one the database verified.
--
--    Body is otherwise byte-for-byte 0047:41-98.
--
--    !! search_path MUST stay `public, extensions` !!
--    0059 widened it via ALTER FUNCTION because pgcrypto lives in the `extensions`
--    schema on Supabase and gen_random_bytes() at :92 cannot resolve otherwise.
--    Writing `SET search_path = public` here would silently re-break EVERY approval
--    dispatch with 42883 — the exact regression 0059 exists to fix.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION approve_submission_atomic(
  p_submission_id uuid,
  p_admin_id      uuid,
  p_amount_cents  bigint DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_submission  submissions%ROWTYPE;
  v_sponsor     sponsors%ROWTYPE;
  v_team        teams%ROWTYPE;
  v_ask_cents   bigint;
  v_token_plain text;
  v_token_hash  text;
  v_actor_id    uuid;
  v_actor_role  text;
  v_now     timestamptz := now();
  v_expires timestamptz := now() + interval '14 days';
BEGIN
  -- ── actor resolution (P0-1 defence in depth) ──────────────────────────────────
  IF (auth.jwt() ->> 'sub') IS NOT NULL THEN
    -- Interactive caller. The session is the identity; p_admin_id is ignored.
    v_actor_id := current_profile_id();
    IF v_actor_id IS NULL OR NOT is_admin() THEN
      RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
    END IF;
  ELSE
    -- Trusted server context (service role). Validate the id it supplied.
    SELECT id, role INTO v_actor_id, v_actor_role FROM profiles WHERE id = p_admin_id;
    IF v_actor_id IS NULL OR v_actor_role <> 'admin' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
    END IF;
  END IF;

  SELECT * INTO v_submission FROM submissions WHERE id = p_submission_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'submission_not_found'); END IF;
  IF v_submission.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'submission_not_pending');
  END IF;

  SELECT * INTO v_sponsor FROM sponsors WHERE id = v_submission.sponsor_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'sponsor_not_found'); END IF;

  SELECT * INTO v_team FROM teams WHERE id = v_submission.team_id;
  v_ask_cents := CASE WHEN p_amount_cents > 0 THEN p_amount_cents
                      ELSE COALESCE(v_team.financial_ask_cents, 0) END;
  IF v_ask_cents <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;

  -- RESERVE: include all prior open reservations + settlements in the check.
  IF (v_sponsor.funding_used_cents + v_ask_cents) > v_sponsor.funding_cap_cents THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_sponsor_capacity');
  END IF;

  UPDATE submissions
     SET status = 'dispatched',
         reviewed_by = v_actor_id,
         reviewed_at = v_now,
         sent_at     = v_now,
         expires_at  = v_expires,
         requested_amount_cents = v_ask_cents,
         reserved_amount_cents  = v_ask_cents
   WHERE id = p_submission_id;

  UPDATE sponsors
     SET funding_used_cents = funding_used_cents + v_ask_cents,
         status = CASE WHEN funding_used_cents + v_ask_cents >= funding_cap_cents
                       THEN 'inactive'::sponsor_status ELSE status END
   WHERE id = v_sponsor.id;

  INSERT INTO audit_log(actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor_id, 'approve_submission', 'submissions', p_submission_id,
          jsonb_build_object('amount_cents', v_ask_cents, 'sponsor_id', v_sponsor.id, 'phase', 'reserve'));

  v_token_plain := encode(gen_random_bytes(32), 'hex');
  v_token_hash  := encode(digest(v_token_plain, 'sha256'), 'hex');
  INSERT INTO submission_access_tokens(submission_id, token_hash, expires_at)
  VALUES (p_submission_id, v_token_hash, v_expires);

  RETURN jsonb_build_object('ok', true, 'token', v_token_plain, 'amount_cents', v_ask_cents);
END;
$$;

-- Re-assert 0059's widened search_path explicitly, so this migration is safe to replay
-- in any order relative to 0059 on a from-scratch rebuild.
ALTER FUNCTION approve_submission_atomic(uuid, uuid, bigint) SET search_path = public, extensions;

-- =====================================================================================
-- VERIFICATION (run after applying)
--
-- 1. In the Supabase SQL editor — expect acl WITHOUT anon/authenticated, WITH service_role:
--
--    SELECT p.oid::regprocedure AS signature, p.proacl
--      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--     WHERE n.nspname='public' AND p.proname IN
--      ('approve_submission_atomic','admin_terminal_decision_atomic',
--       'sponsor_decide_submission_atomic','record_sponsor_decision_atomic',
--       'release_submission_reservation','expire_overdue_submissions',
--       'increment_sponsor_funding')
--     ORDER BY 1;
--
-- 2. From a shell — the single most important check in the remediation. Expect 42501:
--
--    curl -s -X POST "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/rpc/approve_submission_atomic" \
--      -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" -H 'Content-Type: application/json' \
--      -d '{"p_submission_id":"00000000-0000-0000-0000-000000000000",
--           "p_admin_id":"00000000-0000-0000-0000-000000000000","p_amount_cents":0}'
--    # BEFORE: {"ok":false,"error":"submission_not_found"}
--    # AFTER : {"code":"42501","message":"permission denied for function approve_submission_atomic"}
--
--    curl -s -X POST "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/rpc/expire_overdue_submissions" \
--      -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" -H 'Content-Type: application/json' -d '{}'
--    # BEFORE: {"ok":true,"expired":0}   AFTER: 42501
--
-- 3. Confirm the app still works: approve one pending submission from /moderation.
--    It must succeed (service_role retains EXECUTE) and audit_log.actor_id must equal
--    the approving admin's profiles.id.
-- =====================================================================================
