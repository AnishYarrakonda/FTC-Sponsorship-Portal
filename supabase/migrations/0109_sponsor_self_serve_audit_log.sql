-- 0109_sponsor_self_serve_audit_log.sql
-- APPLY WITH: psql "$DATABASE_URL" -f supabase/migrations/0109_sponsor_self_serve_audit_log.sql
-- Contains a $$-quoted function body -- psql -f only.
-- Idempotent (CREATE OR REPLACE + guarded GRANT/REVOKE).
--
-- A-12-05. A sponsor org admin could not see who in their own organisation proposed a
-- funding decision, confirmed one, invited a teammate or changed the approval threshold.
-- Every one of those events is already in `audit_log` with the org id in
-- `metadata->>'sponsor_id'`; the only SELECT policy on that table is `is_admin()`, so the
-- answer was "email platform support".
--
-- WHY THIS IS A FUNCTION AND NOT AN RLS POLICY ON audit_log
--
-- The finding's suggested direction was to add a policy letting org admins read rows where
-- metadata->>'sponsor_id' matches. That would work, and it would also hand them the whole
-- `metadata` jsonb of every matching row. That column is free-form and written by ~40
-- different actions. Today it carries, among other things, admin moderation reasoning,
-- coach profile ids, rejection reasons, and file paths. Tomorrow it carries whatever the
-- next action decides to put there, with no review step that considers this audience.
--
-- COPPA is Core Mandate #1 and "no student PII to non-admins" is not a property you get by
-- hoping every future writer of an audit row remembers who can read it. So the projection
-- is an ALLOWLIST, enforced in the database:
--
--   * only the actions in the list below are visible at all;
--   * only three metadata values are ever returned, each read by name;
--   * the actor is returned as a NAME ONLY IF that actor is a member of the same org.
--     An admin or coach actor is reported as their role, never their identity.
--
-- Anything not on the list is invisible rather than redacted, because a redacted row still
-- tells the reader that something happened, and that is itself information about another
-- party's activity.

-- The org-scoped events a sponsor may legitimately audit for themselves. Deliberately does
-- NOT include coach-side or admin-moderation actions, which are not this org's business
-- even when they mention its id.
CREATE OR REPLACE FUNCTION public.sponsor_auditable_actions()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT ARRAY[
    'propose_sponsor_funding',
    'confirm_sponsor_funding',
    'withdraw_sponsor_funding',
    'sponsor_approve_submission',
    'sponsor_decline_submission',
    'invite_sponsor_member',
    'remove_sponsor_member',
    'update_sponsor_member_role',
    'update_org_approval_settings',
    'fulfillment_transition',
    'export_impact_report',
    'proposal_no_eligible_approver'
  ]::text[];
$function$;

CREATE OR REPLACE FUNCTION public.sponsor_audit_log(p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
RETURNS TABLE (
  id           uuid,
  created_at   timestamptz,
  action       text,
  actor_label  text,
  amount_cents bigint,
  entity_type  text,
  entity_id    uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_profile uuid;
  v_orgs    uuid[];
BEGIN
  v_profile := current_profile_id();
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Rank gate. Reading who in the org made which funding decision is an org-admin act;
  -- a viewer or submitter seat does not carry it.
  IF sponsor_member_role_rank(
       COALESCE(
         (SELECT m.role FROM sponsor_members m WHERE m.profile_id = v_profile ORDER BY sponsor_member_role_rank(m.role) DESC LIMIT 1),
         (SELECT 'org_admin' FROM profiles p WHERE p.id = v_profile AND p.role = 'sponsor' AND p.sponsor_id IS NOT NULL)
       )
     ) < sponsor_member_role_rank('org_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_orgs := current_sponsor_ids();
  IF v_orgs IS NULL OR array_length(v_orgs, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    a.id,
    a.created_at,
    a.action,
    -- Identity is returned ONLY for a fellow member of one of the caller's orgs. An admin
    -- or a coach who touched this row is reported by role. Anonymous/system stays 'System'.
    COALESCE(
      (SELECT p.full_name
         FROM profiles p
         JOIN sponsor_members m ON m.profile_id = p.id AND m.sponsor_id = ANY (v_orgs)
        WHERE p.id = a.actor_id
        LIMIT 1),
      (SELECT p.full_name
         FROM profiles p
        WHERE p.id = a.actor_id AND p.sponsor_id = ANY (v_orgs)
        LIMIT 1),
      (SELECT CASE p.role WHEN 'admin' THEN 'Platform administrator' ELSE 'Team coach' END
         FROM profiles p WHERE p.id = a.actor_id),
      'System'
    )::text AS actor_label,
    -- The only metadata value returned as a value. Read by name, never as a blob.
    NULLIF(a.metadata ->> 'amount_cents', '')::bigint AS amount_cents,
    a.entity_type,
    a.entity_id
  FROM audit_log a
  WHERE a.action = ANY (sponsor_auditable_actions())
    AND (a.metadata ->> 'sponsor_id')::uuid = ANY (v_orgs)
  ORDER BY a.created_at DESC
  LIMIT GREATEST(LEAST(COALESCE(p_limit, 100), 500), 1)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$function$;

-- SECURITY DEFINER: revoke from PUBLIC first, then grant only to the roles that carry a
-- real session. anon must never reach it -- the function derives its whole scope from
-- current_profile_id(), which is NULL for anon, and the guard above raises rather than
-- returning everything, but the grant is the belt to that braces.
REVOKE ALL ON FUNCTION public.sponsor_audit_log(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sponsor_audit_log(integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.sponsor_audit_log(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_audit_log(integer, integer) TO service_role;

REVOKE ALL ON FUNCTION public.sponsor_auditable_actions() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sponsor_auditable_actions() FROM anon;
GRANT EXECUTE ON FUNCTION public.sponsor_auditable_actions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_auditable_actions() TO service_role;

-- audit_log's own RLS is UNCHANGED and stays admin-only. Nothing above loosens it.
