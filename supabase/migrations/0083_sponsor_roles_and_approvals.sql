-- 0083_sponsor_roles_and_approvals.sql
-- =====================================================================================
-- Prompt 09 — org roles & the two-step approver workflow.
--
-- Widens sponsor_members.role from {member, org_admin} to a strict ladder
-- {viewer, submitter, approver, org_admin}, adds a per-org
-- sponsors.approval_required_above_cents threshold (NULL = off, today's behavior), and
-- adds sponsor_decision_proposals — a pending funding decision that sits IN FRONT of the
-- two settle RPCs and never replaces them.
--
-- sponsor_decide_submission_atomic (0065) and record_sponsor_decision_atomic (0071) are
-- NOT edited by this migration. confirm_sponsor_decision_proposal calls
-- sponsor_decide_submission_atomic unchanged, with the CONFIRMING APPROVER as the actor
-- of record. Capacity integrity (the P0-5 no-double-debit fix) is inherited, not
-- re-implemented: a proposal reserves nothing and writes nothing to sponsors,
-- submissions.reserved_amount_cents, or transactions_ledger.
--
-- ── Deliberate deviation from the prompt's own migration text ─────────────────────────
-- The prompt's "Tighten submissions_update_sponsor" section assumes that policy exists
-- today at `= ANY(current_sponsor_ids())`. It does not: 0064_submissions_policy_hardening
-- (P0-3) DROPPED it outright and 0082 deliberately did NOT recreate it (see 0082's own
-- header note) because a sponsor writing status/reserved_amount_cents directly over
-- PostgREST bypasses sponsor_decide_submission_atomic entirely — no ledger row, no
-- capacity check, no audit. Recreating it here, even scoped to has_sponsor_permission(),
-- would reopen that exact Capacity Integrity hole. The code wins over the prompt: this
-- migration does NOT create submissions_update_sponsor. A viewer already cannot PATCH
-- submissions directly (RLS denies by default with no policy), so the intended
-- protection already holds.
--
-- APPLY WITH:  psql "$DATABASE_URL" -f supabase/migrations/0083_sponsor_roles_and_approvals.sql
-- (defines $$-quoted functions and DO blocks — must not go through the Supabase CLI
-- splitter, same reason as 0051/0064/0066/0082)
-- Idempotent: IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS throughout.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1. Widen the role ladder: viewer < submitter < approver < org_admin.
--    Drop the old constraint BEFORE remapping 'member' -> 'submitter', or the UPDATE
--    fails against the two-value CHECK.
-- -------------------------------------------------------------------------------------
ALTER TABLE sponsor_members DROP CONSTRAINT IF EXISTS sponsor_members_role_check;

UPDATE sponsor_members SET role = 'submitter' WHERE role = 'member';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sponsor_members_role_check') THEN
    ALTER TABLE sponsor_members ADD CONSTRAINT sponsor_members_role_check
      CHECK (role IN ('viewer', 'submitter', 'approver', 'org_admin'));
  END IF;
END $$;

ALTER TABLE sponsor_members ALTER COLUMN role SET DEFAULT 'viewer';

-- -------------------------------------------------------------------------------------
-- 2. Per-org approval threshold. NULL = two-step approval disabled (today's behavior for
--    every sponsor that exists when this migration lands). The boundary is `>`, not
--    `>=` — a commitment exactly AT the threshold auto-approves.
-- -------------------------------------------------------------------------------------
ALTER TABLE sponsors
  ADD COLUMN IF NOT EXISTS approval_required_above_cents bigint;

ALTER TABLE sponsors DROP CONSTRAINT IF EXISTS sponsors_approval_threshold_nonneg;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sponsors_approval_threshold_nonneg') THEN
    ALTER TABLE sponsors ADD CONSTRAINT sponsors_approval_threshold_nonneg
      CHECK (approval_required_above_cents IS NULL OR approval_required_above_cents >= 0);
  END IF;
END $$;

COMMENT ON COLUMN sponsors.approval_required_above_cents IS
  'NULL = two-step approval disabled (the pre-0083 behavior: a funding decision commits '
  'immediately). When set to N, a commitment of N cents or less auto-approves and anything '
  'STRICTLY ABOVE N requires a second person with role >= approver to confirm. 0 means '
  'every funding decision needs a second signature.';

-- -------------------------------------------------------------------------------------
-- 3. sponsor_decision_proposals — a pending funding decision awaiting a second person.
--    Only 'approved' (money-committing) decisions are ever gated; see the prompt's
--    "Which decisions are gated" table. A decline releases capacity rather than
--    consuming it, so it never becomes a proposal.
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sponsor_decision_proposals (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id        uuid NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  sponsor_id           uuid NOT NULL REFERENCES sponsors(id)    ON DELETE CASCADE,

  decision             text   NOT NULL DEFAULT 'approved' CHECK (decision = 'approved'),
  amount_cents         bigint NOT NULL CHECK (amount_cents > 0),
  feedback             text,

  status               text NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','confirmed','rejected','withdrawn','expired')),
  -- 'portal' = an authenticated submitter pressed Approve.
  -- 'token'  = the emailed /sponsor-view/[token] link, where no person is authenticated.
  origin               text NOT NULL DEFAULT 'portal' CHECK (origin IN ('portal','token')),

  -- SET NULL, deliberately, NOT RESTRICT. Deleting a Clerk account cascades straight into
  -- profiles with no application code in the loop (trg_release_reservation_on_delete /
  -- the user.deleted arm of app/api/webhooks/clerk/route.ts). A RESTRICT here would make
  -- that DELETE fail, the webhook 500 forever, and the account never delete.
  proposed_by          uuid REFERENCES profiles(id) ON DELETE SET NULL,
  proposed_at          timestamptz NOT NULL DEFAULT now(),

  decided_by           uuid REFERENCES profiles(id) ON DELETE SET NULL,
  decided_at           timestamptz,
  decision_note        text,
  closed_reason        text,            -- 'already_decided' | 'invalid_status' | 'window_elapsed' | ...
  settled_amount_cents bigint,          -- copied from the RPC's ok payload on confirm

  -- Never later than submissions.expires_at, and never more than 7 days out. Stamped by
  -- create_sponsor_decision_proposal.
  expires_at           timestamptz NOT NULL,

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- At most ONE pending proposal per submission. Same partial-unique idiom as
-- idx_single_active_submission_per_sponsor (0073).
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_pending_proposal_per_submission
  ON sponsor_decision_proposals (submission_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_proposals_sponsor_status
  ON sponsor_decision_proposals (sponsor_id, status);
CREATE INDEX IF NOT EXISTS idx_proposals_submission
  ON sponsor_decision_proposals (submission_id);
CREATE INDEX IF NOT EXISTS idx_proposals_pending_expiry
  ON sponsor_decision_proposals (expires_at)
  WHERE status = 'pending';

ALTER TABLE sponsor_decision_proposals ENABLE ROW LEVEL SECURITY;

-- Reuse the existing generic updated_at trigger function (trigger_set_updated_at, 0001) —
-- the same idiom 0082 used for sponsor_members.
DROP TRIGGER IF EXISTS set_updated_at_sponsor_decision_proposals ON sponsor_decision_proposals;
CREATE TRIGGER set_updated_at_sponsor_decision_proposals
  BEFORE UPDATE ON sponsor_decision_proposals
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- RLS: readable by the org (visibility is the point of the control; the gate is on
-- ACTING, not on seeing) and by admins. No INSERT/UPDATE/DELETE policy — RLS denies by
-- default, so the table is service-role-write-only, exactly like sponsor_members (0082),
-- audit_log, and transactions_ledger. Every write goes through the two RPCs below or the
-- admin client.
DROP POLICY IF EXISTS "proposals_select_admin" ON sponsor_decision_proposals;
CREATE POLICY "proposals_select_admin" ON sponsor_decision_proposals FOR SELECT
  USING (is_admin());

DROP POLICY IF EXISTS "proposals_select_org" ON sponsor_decision_proposals;
CREATE POLICY "proposals_select_org" ON sponsor_decision_proposals FOR SELECT
  USING (sponsor_id = ANY(current_sponsor_ids()));

-- -------------------------------------------------------------------------------------
-- 4. Permission helpers.
-- -------------------------------------------------------------------------------------

-- Pure lookup. IMMUTABLE so it can appear in index/policy expressions freely.
CREATE OR REPLACE FUNCTION sponsor_member_role_rank(p_role text)
RETURNS int
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_role
           WHEN 'viewer'    THEN 1
           WHEN 'submitter' THEN 2
           WHEN 'approver'  THEN 3
           WHEN 'org_admin' THEN 4
           ELSE 0
         END;
$$;

-- The caller's role inside one org.
--
-- The COALESCE fallback is not cosmetic. 0082 deliberately did NOT backfill
-- sponsor_members for existing sponsors: current_sponsor_ids() unions profiles.sponsor_id
-- so the legacy one-person shape keeps working with no membership row at all. Without the
-- fallback, every sponsor that exists on the day 0083 lands would have rank 0 and
-- instantly lose the ability to fund anything. The legacy pointer holder IS the account
-- owner, so they get org_admin.
CREATE OR REPLACE FUNCTION current_sponsor_member_role(p_sponsor_id uuid)
RETURNS text
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  -- Both branches gate on profiles.role = 'sponsor', matching current_sponsor_ids()
  -- (0082): a coach or admin who somehow acquires a stray sponsor_members row must not
  -- get a role string back. Not reachable today (is_sponsor_org_member(), called from
  -- has_sponsor_permission(), independently enforces the same gate via
  -- current_sponsor_ids(), and requireSponsor() throws Forbidden on role <> 'sponsor'
  -- before this function's return value is ever consulted) — added for defense in depth
  -- since this SECURITY DEFINER function is directly callable by any authenticated user.
  SELECT COALESCE(
    (SELECT m.role
       FROM sponsor_members m
      WHERE m.profile_id = current_profile_id()
        AND m.sponsor_id = p_sponsor_id
        AND EXISTS (SELECT 1 FROM profiles p2
                     WHERE p2.id = current_profile_id() AND p2.role = 'sponsor')),
    (SELECT 'org_admin'
       FROM profiles p
      WHERE p.id = current_profile_id()
        AND p.role = 'sponsor'
        AND p.sponsor_id = p_sponsor_id)
  );
$$;

CREATE OR REPLACE FUNCTION has_sponsor_permission(p_sponsor_id uuid, p_min_role text)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT is_sponsor_org_member(p_sponsor_id)
     AND sponsor_member_role_rank(current_sponsor_member_role(p_sponsor_id))
       >= sponsor_member_role_rank(p_min_role);
$$;

-- Grants — the two-rule split (_CONTEXT.md §8.4, 0082's own grants note).
-- These three are POLICY HELPERS, evaluated inside RLS quals as the querying role.
-- Revoking them from `authenticated` makes every sponsor read fail 42501 (0062's
-- warning). The two RPCs below are invoked over PostgREST and get the strict treatment.
REVOKE ALL ON FUNCTION sponsor_member_role_rank(text)             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION current_sponsor_member_role(uuid)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION has_sponsor_permission(uuid, text)         FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION sponsor_member_role_rank(text)          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION current_sponsor_member_role(uuid)       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION has_sponsor_permission(uuid, text)      TO authenticated, service_role;

-- -------------------------------------------------------------------------------------
-- 5. create_sponsor_decision_proposal — writes ONE row. Moves no money. Does not touch
--    submissions, sponsors, or transactions_ledger.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_sponsor_decision_proposal(
  p_submission_id uuid,
  p_proposed_by   uuid,       -- NULL for origin='token' (no authenticated person)
  p_amount_cents  bigint,     -- 0 means "the full reserved amount"
  p_origin        text DEFAULT 'portal',
  p_feedback      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor    uuid;
  v_sub      submissions%ROWTYPE;
  v_reserved bigint;
  v_amount   bigint;
  v_expires  timestamptz;
  v_rank     text;
  v_id       uuid;
BEGIN
  -- Actor resolution — the three-branch form, closed against anon (0072). Do not copy
  -- 0065's bare ELSE into new code.
  IF (auth.jwt() ->> 'sub') IS NOT NULL THEN
    v_actor := current_profile_id();
    IF v_actor IS NULL OR v_actor IS DISTINCT FROM p_proposed_by THEN
      RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
    END IF;
  ELSIF is_trusted_server_context() THEN
    v_actor := p_proposed_by;          -- may be NULL for the token origin
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  IF p_origin NOT IN ('portal', 'token') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  IF p_origin = 'portal' AND p_proposed_by IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  SELECT * INTO v_sub FROM submissions WHERE id = p_submission_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'submission_not_found');
  END IF;
  IF v_sub.status NOT IN ('dispatched', 'delivered', 'opened') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status', 'current_status', v_sub.status);
  END IF;

  IF p_origin = 'portal' THEN
    -- Resolve the proposer's rank directly against sponsor_members, joined to
    -- p_proposed_by — the caller here is the service role, so current_profile_id() is
    -- NULL and current_sponsor_member_role() cannot be used. Apply the same legacy
    -- fallback as that function.
    SELECT COALESCE(
      (SELECT m.role FROM sponsor_members m
        WHERE m.profile_id = p_proposed_by AND m.sponsor_id = v_sub.sponsor_id),
      (SELECT 'org_admin' FROM profiles p
        WHERE p.id = p_proposed_by AND p.role = 'sponsor' AND p.sponsor_id = v_sub.sponsor_id)
    ) INTO v_rank;
    IF sponsor_member_role_rank(v_rank) < sponsor_member_role_rank('submitter') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
    END IF;
  END IF;

  v_reserved := COALESCE(v_sub.reserved_amount_cents, v_sub.requested_amount_cents, 0);
  v_amount := CASE WHEN p_amount_cents > 0 AND p_amount_cents < v_reserved
                    THEN p_amount_cents ELSE v_reserved END;
  IF v_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'amount_required');
  END IF;

  v_expires := LEAST(COALESCE(v_sub.expires_at, now() + interval '7 days'), now() + interval '7 days');
  IF v_expires <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'reservation_expiring');
  END IF;

  IF EXISTS (
    SELECT 1 FROM sponsor_decision_proposals
     WHERE submission_id = p_submission_id AND status = 'pending'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'proposal_pending');
  END IF;

  INSERT INTO sponsor_decision_proposals (
    submission_id, sponsor_id, amount_cents, feedback, origin, proposed_by, expires_at
  ) VALUES (
    p_submission_id, v_sub.sponsor_id, v_amount, NULLIF(p_feedback, ''), p_origin, p_proposed_by, v_expires
  ) RETURNING id INTO v_id;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor, 'propose_sponsor_funding', 'sponsor_decision_proposals', v_id,
          jsonb_build_object('submission_id', p_submission_id, 'sponsor_id', v_sub.sponsor_id,
                             'amount_cents', v_amount, 'origin', p_origin));

  RETURN jsonb_build_object('ok', true, 'proposal_id', v_id, 'amount_cents', v_amount, 'expires_at', v_expires);
END;
$$;

-- -------------------------------------------------------------------------------------
-- 6. confirm_sponsor_decision_proposal — invokes sponsor_decide_submission_atomic (0065)
--    UNCHANGED, with the CONFIRMING APPROVER as the actor of record.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION confirm_sponsor_decision_proposal(
  p_proposal_id uuid,
  p_approver_id uuid,
  p_note        text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor  uuid;
  v_p      sponsor_decision_proposals%ROWTYPE;
  v_rank   text;
  v_result jsonb;
BEGIN
  IF p_approver_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  -- Same three-branch actor resolution as create_sponsor_decision_proposal.
  IF (auth.jwt() ->> 'sub') IS NOT NULL THEN
    v_actor := current_profile_id();
    IF v_actor IS NULL OR v_actor IS DISTINCT FROM p_approver_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
    END IF;
  ELSIF is_trusted_server_context() THEN
    v_actor := p_approver_id;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  SELECT * INTO v_p FROM sponsor_decision_proposals WHERE id = p_proposal_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'proposal_not_found');
  END IF;
  IF v_p.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'proposal_not_pending', 'current_status', v_p.status);
  END IF;

  IF v_p.expires_at <= now() THEN
    UPDATE sponsor_decision_proposals
       SET status = 'expired', closed_reason = 'window_elapsed', decided_at = now()
     WHERE id = p_proposal_id;
    RETURN jsonb_build_object('ok', false, 'error', 'proposal_expired');
  END IF;

  -- Resolve the approver's rank the same service-role-safe way as the proposer check,
  -- with the same legacy org_admin fallback.
  SELECT COALESCE(
    (SELECT m.role FROM sponsor_members m
      WHERE m.profile_id = p_approver_id AND m.sponsor_id = v_p.sponsor_id),
    (SELECT 'org_admin' FROM profiles p
      WHERE p.id = p_approver_id AND p.role = 'sponsor' AND p.sponsor_id = v_p.sponsor_id)
  ) INTO v_rank;
  IF sponsor_member_role_rank(v_rank) < sponsor_member_role_rank('approver') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  -- Self-approval is refused: the second signature has to be a second person, or the
  -- control is decoration. origin='token' proposals have proposed_by IS NULL (nobody is
  -- authenticated on that path), so any approver may confirm them — intended.
  IF v_p.proposed_by IS NOT NULL AND v_p.proposed_by = p_approver_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'self_approval');
  END IF;

  -- Invoke the untouched RPC. Every branch of 0065 that returns ok:false does so BEFORE
  -- any write, so on failure here nothing was written — no savepoint needed.
  SELECT sponsor_decide_submission_atomic(
           v_p.submission_id, p_approver_id, 'approved', v_p.feedback, v_p.amount_cents
         ) INTO v_result;

  IF NOT COALESCE((v_result ->> 'ok')::boolean, false) THEN
    UPDATE sponsor_decision_proposals
       SET status = 'expired', closed_reason = v_result ->> 'error',
           decided_by = p_approver_id, decided_at = now()
     WHERE id = p_proposal_id;
    RETURN jsonb_build_object('ok', false, 'error', v_result ->> 'error');
  END IF;

  UPDATE sponsor_decision_proposals
     SET status = 'confirmed', decided_by = p_approver_id, decided_at = now(),
         decision_note = p_note, settled_amount_cents = (v_result ->> 'amount_cents')::bigint
   WHERE id = p_proposal_id;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor, 'confirm_sponsor_funding', 'sponsor_decision_proposals', p_proposal_id,
          jsonb_build_object('submission_id', v_p.submission_id, 'sponsor_id', v_p.sponsor_id,
                             'amount_cents', (v_result ->> 'amount_cents')::bigint,
                             'proposed_by', v_p.proposed_by, 'approver_id', p_approver_id));

  RETURN jsonb_build_object('ok', true, 'amount_cents', (v_result ->> 'amount_cents')::bigint,
                            'submission_id', v_p.submission_id);
END;
$$;

-- Grants — strict rule (_CONTEXT.md §8.4, 0071's precedent). This is what makes "a
-- viewer cannot approve funding" true at the database layer even if every line of
-- TypeScript is bypassed: an `authenticated` PostgREST caller cannot execute either
-- function at all.
REVOKE EXECUTE ON FUNCTION create_sponsor_decision_proposal(uuid, uuid, bigint, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION create_sponsor_decision_proposal(uuid, uuid, bigint, text, text)
  TO service_role;

REVOKE EXECUTE ON FUNCTION confirm_sponsor_decision_proposal(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION confirm_sponsor_decision_proposal(uuid, uuid, text)
  TO service_role;

-- -------------------------------------------------------------------------------------
-- 7. Close stale proposals when the pitch moves on. Deliberately excludes 'approved' —
--    the confirm path sets the submission to approved from inside
--    sponsor_decide_submission_atomic, in the SAME transaction, before this migration's
--    own code marks the proposal confirmed. If the trigger fired on 'approved' it would
--    flip our own row to 'expired' mid-flight. The token-path race is handled instead by
--    0065's already_decided guard and the confirm RPC's failure branch above.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION expire_proposals_on_submission_exit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE sponsor_decision_proposals
     SET status = 'expired', closed_reason = 'submission_' || NEW.status,
         decided_at = now()
   WHERE submission_id = NEW.id AND status = 'pending';
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS trg_expire_proposals_on_submission_exit ON submissions;
CREATE TRIGGER trg_expire_proposals_on_submission_exit
  AFTER UPDATE OF status ON submissions
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status
        AND NEW.status IN ('declined','changes_requested','expired','bounced'))
  EXECUTE FUNCTION expire_proposals_on_submission_exit();

-- -------------------------------------------------------------------------------------
-- 8. Time-based expiry — extends the existing cron (vercel.json schedules exactly one
--    route; no new cron slot is added here).
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION expire_stale_decision_proposals()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count int;
BEGIN
  WITH done AS (
    UPDATE sponsor_decision_proposals
       SET status = 'expired', closed_reason = 'window_elapsed', decided_at = now()
     WHERE status = 'pending' AND expires_at < now()
     RETURNING 1
  ) SELECT count(*) INTO v_count FROM done;
  RETURN jsonb_build_object('ok', true, 'expired', v_count);
END; $$;

REVOKE EXECUTE ON FUNCTION expire_stale_decision_proposals() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION expire_stale_decision_proposals() TO service_role;

-- -------------------------------------------------------------------------------------
-- 9. Prompt 01 interaction: markPaymentSent's fulfillments_select_sponsor policy still
--    keys off profiles.sponsor_id only (0076). Repoint it to current_sponsor_ids() so
--    every org member, not only the legacy pointer holder, can read their org's
--    fulfillments — guarded so 0083 applies cleanly whether or not prompt 01 has landed.
-- -------------------------------------------------------------------------------------
DO $$ BEGIN
  IF to_regclass('public.funding_fulfillments') IS NOT NULL THEN
    EXECUTE $p$ DROP POLICY IF EXISTS "fulfillments_select_sponsor" ON funding_fulfillments $p$;
    EXECUTE $p$ CREATE POLICY "fulfillments_select_sponsor" ON funding_fulfillments FOR SELECT
                  USING (funding_fulfillments.sponsor_id = ANY(current_sponsor_ids())) $p$;
  END IF;
END $$;
