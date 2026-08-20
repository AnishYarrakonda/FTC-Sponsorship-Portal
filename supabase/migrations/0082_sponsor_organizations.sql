-- 0082_sponsor_organizations.sql
-- =====================================================================================
-- Prompt 08 — multi-user sponsor accounts on Clerk Organizations.
--
-- Today a sponsor company is exactly one profiles row (profiles.sponsor_id). This slice
-- adds sponsor_members, a Postgres mirror of Clerk Organization membership, so more than
-- one person at a company can sign in, see the same pitches/funding/inbox, and be
-- offboarded without a support ticket.
--
-- ── Design: profiles.sponsor_id STAYS as the denormalized "primary org" pointer ───────
-- Every sponsor_members insert also writes profiles.sponsor_id for that member when it is
-- currently NULL (via the admin/service-role client — prevent_role_elevation (0073) blocks
-- everyone else). Consequence: sponsor_decide_submission_atomic (0065),
-- record_sponsor_decision_atomic (0071), lib/dispatch.ts, every sponsor page, and
-- agreement_signatures_select_sponsor (0080) keep working with ZERO changes for every
-- member of an org — none of them need to learn about sponsor_members, because by the
-- time a new member's session can query anything, the webhook has already stamped their
-- profiles.sponsor_id synchronously.
--
-- current_sponsor_ids() UNIONs sponsor_members with profiles.sponsor_id, so every sponsor
-- that exists today (zero sponsor_members rows) keeps full access with no backfill, and a
-- missed webhook cannot lock anyone out.
--
-- ── Objects actually rewritten to current_sponsor_ids() (verified against the live code,
-- not the prompt's summary) ────────────────────────────────────────────────────────────
--   1. sponsors_select_own              (0051:188-197)
--   2. submissions_select_sponsor       (0064:55-66, latest)
--   3. ledger_select_sponsor            (0069:21-32)
--   4. sponsor_can_view_team(uuid)      (0066:95-110) — function body only; the two
--      policies that call it (teams_select_sponsor, achievements_select) are UNCHANGED,
--      because inlining the predicate into either one is a 42P17 policy-cycle outage
--      (0066's header explains why in full).
--
-- ── Deliberate deviation from the prompt's own "objects to migrate" table ─────────────
-- The prompt lists a 5th item, `submissions_update_sponsor`, "latest at 0051:246-264",
-- to be rewritten the same way. That is stale: 0064_submissions_policy_hardening.sql
-- (§5, "P0-3 — sponsors have no legitimate direct write to submissions") DROPPED that
-- policy outright and never recreated it, in every migration since, through 0081.
-- `grep -n "submissions_update_sponsor" supabase/migrations/*.sql` confirms the DROP is
-- the last thing written for that name. Recreating it here — even rescoped to
-- current_sponsor_ids() — would reopen the exact P0-3 hole 0064 closed: a sponsor could
-- PATCH status/reserved_amount_cents directly over PostgREST, bypassing
-- sponsor_decide_submission_atomic entirely (no ledger row, no capacity check, no audit).
-- That is a Capacity Integrity Core Mandate violation and this slice's own guardrail
-- ("nothing in this slice may change how money is reserved or settled"). The code wins
-- over the prompt: this migration does NOT recreate submissions_update_sponsor.
--
-- APPLY WITH:  psql "$DATABASE_URL" -f supabase/migrations/0082_sponsor_organizations.sql
-- (defines $$-quoted functions and a DO block — must not go through the Supabase CLI
-- splitter, same reason as 0051/0064/0066)
-- Idempotent: IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS throughout.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1. One Clerk org <-> one sponsors row.
-- -------------------------------------------------------------------------------------
ALTER TABLE sponsors ADD COLUMN IF NOT EXISTS clerk_org_id text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sponsors_clerk_org_id_key') THEN
    ALTER TABLE sponsors ADD CONSTRAINT sponsors_clerk_org_id_key UNIQUE (clerk_org_id);
  END IF;
END $$;   -- ADD CONSTRAINT has no IF NOT EXISTS; this DO block is the idempotent form.

COMMENT ON COLUMN sponsors.clerk_org_id IS
  'Clerk Organization id backing this sponsor company (0082). NULL for a sponsor whose '
  'org creation failed at approval time or has not yet been created via the admin retry '
  'action — current_sponsor_ids() falls back to profiles.sponsor_id in that case, so the '
  'sponsor still works with a single seat.';

-- -------------------------------------------------------------------------------------
-- 2. sponsor_members — Postgres mirror of Clerk Organization membership.
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sponsor_members (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_id          uuid NOT NULL REFERENCES sponsors(id) ON DELETE CASCADE,
  profile_id          uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  clerk_org_id        text NOT NULL,
  clerk_membership_id text UNIQUE,          -- NULL while an invitation is outstanding
  role                text NOT NULL DEFAULT 'member'
                        CHECK (role IN ('member', 'org_admin')),
  invited_by          uuid REFERENCES profiles(id) ON DELETE SET NULL,
  invited_at          timestamptz,
  joined_at           timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sponsor_id, profile_id)
);

COMMENT ON TABLE sponsor_members IS
  'Postgres mirror of Clerk Organization membership (0082), kept in sync by '
  'app/api/webhooks/clerk/route.ts organizationMembership.* handlers. One org per profile '
  'is enforced at the application layer (invite action + webhook both refuse a second '
  'membership); the schema permits multi-org rows for a future org switcher.';

CREATE INDEX IF NOT EXISTS idx_sponsor_members_profile ON sponsor_members (profile_id);
CREATE INDEX IF NOT EXISTS idx_sponsor_members_sponsor ON sponsor_members (sponsor_id);
CREATE INDEX IF NOT EXISTS idx_sponsor_members_org     ON sponsor_members (clerk_org_id);

ALTER TABLE sponsor_members ENABLE ROW LEVEL SECURITY;

-- Reuse the existing generic updated_at trigger function (trigger_set_updated_at, 0001).
DROP TRIGGER IF EXISTS set_updated_at_sponsor_members ON sponsor_members;
CREATE TRIGGER set_updated_at_sponsor_members
  BEFORE UPDATE ON sponsor_members
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- -------------------------------------------------------------------------------------
-- 3. Helper functions — the new "which sponsor(s) is this caller" resolvers.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION current_sponsor_ids()
RETURNS uuid[]
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT sid), '{}'::uuid[])
    FROM (
      -- new path
      SELECT m.sponsor_id AS sid
        FROM sponsor_members m
       WHERE m.profile_id = current_profile_id()
      UNION
      -- legacy path: every sponsor that exists today, and the belt-and-braces
      -- fallback if the membership row is missing or the webhook lagged.
      SELECT p.sponsor_id
        FROM profiles p
       WHERE p.id = current_profile_id()
         AND p.sponsor_id IS NOT NULL
    ) s
   WHERE sid IS NOT NULL
     -- Role gate: a coach or admin who somehow acquires a membership row must not
     -- inherit sponsor reads. Role stays authoritative in profiles.role.
     AND EXISTS (SELECT 1 FROM profiles p2
                  WHERE p2.id = current_profile_id() AND p2.role = 'sponsor');
$$;

COMMENT ON FUNCTION current_sponsor_ids() IS
  'All sponsor company ids the caller may act as (0082): sponsor_members rows UNIONed '
  'with the legacy profiles.sponsor_id pointer, gated on role=''sponsor''. Every RLS '
  'policy and SECURITY DEFINER helper that used to compare profiles.sponsor_id directly '
  'now compares against ANY(current_sponsor_ids()).';

CREATE OR REPLACE FUNCTION is_sponsor_org_member(p_sponsor_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$ SELECT p_sponsor_id = ANY(current_sponsor_ids()); $$;

-- Grants — these are POLICY HELPERS, not RPCs invoked over PostgREST. Policy quals
-- evaluate as the querying role, so revoking EXECUTE from `authenticated` (the usual
-- SECURITY DEFINER lockdown, _CONTEXT.md §8.4 / 0062) makes every sponsor read fail
-- 42501. Same treatment as sponsor_can_view_team (0066:118) and for the same reason.
REVOKE ALL ON FUNCTION current_sponsor_ids()          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION is_sponsor_org_member(uuid)    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION current_sponsor_ids()       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION is_sponsor_org_member(uuid) TO authenticated, service_role;

-- -------------------------------------------------------------------------------------
-- 4. RLS policies on sponsor_members.
--
--    No INSERT / UPDATE / DELETE policy — RLS denies by default, so the table is
--    service-role-write-only, exactly like audit_log and transactions_ledger. Membership
--    must never be self-writable: an INSERT policy here is a one-line path to joining
--    another company's org.
-- -------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "sponsor_members_select_admin" ON sponsor_members;
CREATE POLICY "sponsor_members_select_admin" ON sponsor_members FOR SELECT
  USING (is_admin());

-- The predicate is the FUNCTION CALL current_sponsor_ids(), never an inline
-- `EXISTS (SELECT 1 FROM sponsor_members ...)` — that would be self-referential policy
-- recursion (RLS evaluates the policy's own table inside its own qual).
DROP POLICY IF EXISTS "sponsor_members_select_own_org" ON sponsor_members;
CREATE POLICY "sponsor_members_select_own_org" ON sponsor_members FOR SELECT
  USING (
    profile_id = current_profile_id()
    OR sponsor_id = ANY(current_sponsor_ids())
  );

-- -------------------------------------------------------------------------------------
-- 5. Repoint the four verified sponsor-resolution objects at current_sponsor_ids().
-- -------------------------------------------------------------------------------------

-- 5a. sponsors_select_own (0051:188-197)
DROP POLICY IF EXISTS "sponsors_select_own" ON sponsors;
CREATE POLICY "sponsors_select_own" ON sponsors FOR SELECT
  USING (sponsors.id = ANY(current_sponsor_ids()));

-- 5b. submissions_select_sponsor (0064:55-66, latest). The `sent_at IS NOT NULL`
-- admin-gate marker MUST survive verbatim — it is the P0-2 fix; dropping it lets a
-- sponsor org member read pitches that never cleared moderation.
DROP POLICY IF EXISTS "submissions_select_sponsor" ON submissions;
CREATE POLICY "submissions_select_sponsor" ON submissions FOR SELECT
  USING (
    deleted_at IS NULL
    AND sent_at IS NOT NULL          -- stamped only by approve_submission_atomic
    AND submissions.sponsor_id = ANY(current_sponsor_ids())
  );

-- (submissions_update_sponsor: intentionally NOT recreated. See header note.)

-- 5c. ledger_select_sponsor (0069:21-32). ledger_select_coach / ledger_select_admin
-- are untouched.
DROP POLICY IF EXISTS "ledger_select_sponsor" ON transactions_ledger;
CREATE POLICY "ledger_select_sponsor" ON transactions_ledger FOR SELECT
  USING (transactions_ledger.sponsor_id = ANY(current_sponsor_ids()));

-- 5d. sponsor_can_view_team(uuid) (0066:95-110) — body only. teams_select_sponsor and
-- achievements_select call this function and are NOT touched; rewriting either one
-- inline reopens the teams<->submissions policy cycle (42P17) 0066 exists to avoid.
CREATE OR REPLACE FUNCTION sponsor_can_view_team(p_team_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM submissions s
     WHERE s.team_id = p_team_id
       AND s.sponsor_id = ANY(current_sponsor_ids())
       AND s.sent_at IS NOT NULL          -- same admin-gate marker as 0064
       AND s.deleted_at IS NULL
  );
$$;

COMMENT ON FUNCTION sponsor_can_view_team(uuid) IS
  'True when the caller is a sponsor (any org member, 0082) holding an admin-dispatched '
  'submission from this team. MUST stay a function: inlining it into an RLS policy closes '
  'a teams<->submissions policy cycle and every read of either table fails 42P17.';

GRANT EXECUTE ON FUNCTION sponsor_can_view_team(uuid) TO authenticated, service_role;

-- v_sponsors_public (0063:68-112): verified unchanged. It is a SECURITY DEFINER view
-- whose three branches are is_admin(), is_coach_verified()+geo/capacity, and "a sponsor
-- this coach already pitched" — it has NO reference to profiles.sponsor_id and no
-- sponsor-facing branch (sponsors read their own company through sponsors_select_own on
-- the base table, not through this view). Left as-is, per the prompt's own instruction.

-- =====================================================================================
-- VERIFICATION (run after applying)
--
-- 1. THE CYCLE CHECK — run this first (0066:158-160 / prompt 08's own guardrail):
--      SET ROLE authenticated;
--      SELECT count(*) FROM submissions;        -- must return a number, not 42P17
--      SELECT count(*) FROM teams;
--      SELECT count(*) FROM team_achievements;
--      SELECT count(*) FROM transactions_ledger;
--      RESET ROLE;
--
-- 2. A sponsor with no sponsor_members row (the legacy shape, every sponsor that exists
--    pre-0082) keeps full access with no backfill:
--      SELECT current_sponsor_ids();   -- as that sponsor: {<their sponsor id>}
--
-- 3. sponsor_members is not writable by anyone but service_role:
--      POST/PATCH/DELETE /rest/v1/sponsor_members as an authenticated sponsor -> denied
--
-- 4. A coach or anon caller reads 0 rows from sponsor_members and 0 rows from another
--    sponsor's sponsors/submissions/transactions_ledger rows.
--
-- 5. Non-regression: sign in as the seeded sponsor, confirm /sponsor/dashboard,
--    /sponsor/submissions, /sponsor/funding and /sponsor/members all still render, and
--    sponsor_decide_submission_atomic still succeeds end to end (the money path is
--    untouched by this migration — no RPC body here was modified).
--
--    SELECT policyname, cmd, qual FROM pg_policies
--     WHERE schemaname='public' AND tablename IN ('sponsors','submissions',
--       'transactions_ledger','sponsor_members') ORDER BY tablename, policyname;
-- =====================================================================================
