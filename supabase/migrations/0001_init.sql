-- =============================================================================
-- Migration: 0001_init.sql
-- Project:   FTC Sponsorship Portal ("FTC Pitfund")
-- Purpose:   Initial schema — tables, enums, indexes, triggers, RLS policies,
--            helper functions, and analytics views.
-- Idempotent: enums are dropped and recreated; tables use IF NOT EXISTS.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- for gen_random_uuid() on older PG

-- ---------------------------------------------------------------------------
-- 1. Custom Enum Types
--    Drop + recreate pattern to keep the migration idempotent.
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  -- 'sponsor' is declared up front (later added idempotently by 0030/0040 via
  -- ADD VALUE IF NOT EXISTS) so a fresh replay has it before 0030 references it.
  CREATE TYPE user_role AS ENUM ('coach', 'admin', 'sponsor');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE team_status AS ENUM ('existing', 'incubator');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE sponsor_status AS ENUM ('active', 'inactive', 'pending_review');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE sponsor_source AS ENUM ('admin_added', 'public_optin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE pitch_status AS ENUM (
    'draft', 'submitted', 'under_review',
    'changes_requested', 'approved', 'rejected', 'dispatched'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE dispatch_status AS ENUM ('pending', 'sent', 'failed', 'bounced', 'opened');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE application_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------

-- 2a. profiles (extends auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id                    uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role                  user_role   NOT NULL DEFAULT 'coach',
  full_name             text        NOT NULL CHECK (char_length(full_name) <= 200),
  email                 text        NOT NULL,
  coach_verified        boolean     NOT NULL DEFAULT false,
  coach_credentials_url text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
  -- COPPA compliance: this table intentionally contains zero student PII columns.
  -- Only adult coach/admin data is stored. See SECURITY.md for the full policy.
);

-- 2b. teams
CREATE TABLE IF NOT EXISTS teams (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status           team_status NOT NULL DEFAULT 'existing',
  ftc_team_number  integer,
  team_name        text        NOT NULL,
  organization     text,
  city             text,
  state            text,
  mission_statement text,
  is_501c3         boolean     NOT NULL DEFAULT false,
  logo_url         text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- Existing teams must have an FTC team number
  CONSTRAINT existing_team_requires_number CHECK (
    status != 'existing' OR ftc_team_number IS NOT NULL
  )
);

-- 2c. team_achievements
CREATE TABLE IF NOT EXISTS team_achievements (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     uuid        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  season      text,
  event_name  text        NOT NULL,
  award       text,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now()
  -- No updated_at: achievements are effectively append-only
);

-- 2d. sponsors
CREATE TABLE IF NOT EXISTS sponsors (
  id                  uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name        text           NOT NULL,
  industry            text,
  website             text,
  logo_url            text,
  contact_name        text           NOT NULL,
  contact_email       text           NOT NULL,
  contact_title       text,
  funding_cap_cents   bigint         NOT NULL DEFAULT 0 CHECK (funding_cap_cents >= 0),
  funding_used_cents  bigint         NOT NULL DEFAULT 0 CHECK (funding_used_cents >= 0),
  status              sponsor_status NOT NULL DEFAULT 'pending_review',
  source              sponsor_source NOT NULL DEFAULT 'admin_added',
  notes               text,          -- admin-only field (enforced by RLS)
  created_at          timestamptz    NOT NULL DEFAULT now(),
  updated_at          timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT funding_used_lte_cap CHECK (funding_used_cents <= funding_cap_cents)
);

-- 2e. pitches
CREATE TABLE IF NOT EXISTS pitches (
  id                   uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id              uuid         NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  title                text         NOT NULL,
  summary              text,
  financial_ask_cents  bigint       NOT NULL DEFAULT 0 CHECK (financial_ask_cents >= 0),
  cost_explanation     text,
  line_items           jsonb        NOT NULL DEFAULT '[]'::jsonb,
  media_urls           jsonb        NOT NULL DEFAULT '[]'::jsonb,
  status               pitch_status NOT NULL DEFAULT 'draft',
  admin_feedback       text,
  reviewed_by          uuid         REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at          timestamptz,
  created_at           timestamptz  NOT NULL DEFAULT now(),
  updated_at           timestamptz  NOT NULL DEFAULT now(),
  -- reviewed_by and reviewed_at must both be set or both be null
  CONSTRAINT reviewed_fields_consistent CHECK (
    (reviewed_by IS NULL AND reviewed_at IS NULL) OR
    (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);

-- 2f. pitch_sponsor_targets (M:N junction — one row per pitch×sponsor pairing)
CREATE TABLE IF NOT EXISTS pitch_sponsor_targets (
  id                uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  pitch_id          uuid            NOT NULL REFERENCES pitches(id) ON DELETE CASCADE,
  sponsor_id        uuid            NOT NULL REFERENCES sponsors(id) ON DELETE CASCADE,
  dispatch_status   dispatch_status NOT NULL DEFAULT 'pending',
  resend_message_id text,
  sent_at           timestamptz,
  created_at        timestamptz     NOT NULL DEFAULT now(),
  updated_at        timestamptz     NOT NULL DEFAULT now(),
  -- Prevents double-dispatch to the same sponsor for the same pitch
  UNIQUE (pitch_id, sponsor_id)
);

-- 2g. sponsor_applications (public opt-in queue)
CREATE TABLE IF NOT EXISTS sponsor_applications (
  id                  uuid               PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name        text               NOT NULL,
  contact_email       text               NOT NULL,
  proposed_cap_cents  bigint             NOT NULL DEFAULT 0 CHECK (proposed_cap_cents >= 0),
  message             text,
  status              application_status NOT NULL DEFAULT 'pending',
  reviewed_by         uuid               REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at         timestamptz,
  created_at          timestamptz        NOT NULL DEFAULT now(),
  updated_at          timestamptz        NOT NULL DEFAULT now()
);

-- 2h. audit_log (append-only — no updated_at by design)
CREATE TABLE IF NOT EXISTS audit_log (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  action      text        NOT NULL,
  entity_type text        NOT NULL,
  entity_id   uuid,
  metadata    jsonb       DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
  -- No updated_at: this table is append-only
);

-- ---------------------------------------------------------------------------
-- 3. Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_teams_owner_id
  ON teams(owner_id);

CREATE INDEX IF NOT EXISTS idx_teams_ftc_number
  ON teams(ftc_team_number)
  WHERE ftc_team_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pitches_team_id
  ON pitches(team_id);

CREATE INDEX IF NOT EXISTS idx_pitches_status
  ON pitches(status);

CREATE INDEX IF NOT EXISTS idx_pitch_sponsor_targets_pitch_id
  ON pitch_sponsor_targets(pitch_id);

CREATE INDEX IF NOT EXISTS idx_pitch_sponsor_targets_sponsor_id
  ON pitch_sponsor_targets(sponsor_id);

CREATE INDEX IF NOT EXISTS idx_sponsors_status
  ON sponsors(status);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor_id
  ON audit_log(actor_id);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity
  ON audit_log(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at
  ON audit_log(created_at DESC);

-- ---------------------------------------------------------------------------
-- 4. updated_at Trigger Function + Triggers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Prevent coaches from modifying their own role or coach_verified status
CREATE OR REPLACE FUNCTION prevent_role_elevation()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.role <> OLD.role AND NOT is_admin() THEN
    RAISE EXCEPTION 'role elevation not permitted';
  END IF;
  IF NEW.coach_verified <> OLD.coach_verified AND NOT is_admin() THEN
    RAISE EXCEPTION 'coach_verified modification not permitted';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS enforce_profile_immutable_fields ON profiles;
CREATE TRIGGER enforce_profile_immutable_fields
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION prevent_role_elevation();

-- Drop triggers before recreating so the migration stays idempotent
DROP TRIGGER IF EXISTS set_updated_at_profiles             ON profiles;
DROP TRIGGER IF EXISTS set_updated_at_teams                ON teams;
DROP TRIGGER IF EXISTS set_updated_at_sponsors             ON sponsors;
DROP TRIGGER IF EXISTS set_updated_at_pitches              ON pitches;
DROP TRIGGER IF EXISTS set_updated_at_pitch_sponsor_targets ON pitch_sponsor_targets;
DROP TRIGGER IF EXISTS set_updated_at_sponsor_applications ON sponsor_applications;

CREATE TRIGGER set_updated_at_profiles
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_teams
  BEFORE UPDATE ON teams
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_sponsors
  BEFORE UPDATE ON sponsors
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_pitches
  BEFORE UPDATE ON pitches
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_pitch_sponsor_targets
  BEFORE UPDATE ON pitch_sponsor_targets
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_sponsor_applications
  BEFORE UPDATE ON sponsor_applications
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Auto-create profile on Supabase signup
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(LEFT(NEW.raw_user_meta_data->>'full_name', 200), ''),
    'coach'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ---------------------------------------------------------------------------
-- 6. Row Level Security — Enable on all tables
-- ---------------------------------------------------------------------------

ALTER TABLE profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_achievements     ENABLE ROW LEVEL SECURITY;
ALTER TABLE sponsors              ENABLE ROW LEVEL SECURITY;
ALTER TABLE pitches               ENABLE ROW LEVEL SECURITY;
ALTER TABLE pitch_sponsor_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE sponsor_applications  ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log             ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 7. RLS Helper Functions
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

CREATE OR REPLACE FUNCTION is_coach_verified()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'coach' AND coach_verified = true
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

-- ---------------------------------------------------------------------------
-- 8. RLS Policies
-- ---------------------------------------------------------------------------

-- ── profiles ────────────────────────────────────────────────────────────────

-- Drop existing policies before recreating (idempotent)
DROP POLICY IF EXISTS "profiles_select"         ON profiles;
DROP POLICY IF EXISTS "profiles_update_own"     ON profiles;
DROP POLICY IF EXISTS "profiles_update_admin"   ON profiles;
DROP POLICY IF EXISTS "profiles_insert_trigger" ON profiles;

-- Users can read their own profile; admins can read all
CREATE POLICY "profiles_select" ON profiles FOR SELECT
  USING (id = auth.uid() OR is_admin());

-- Users can update their own profile; role/coach_verified immutability enforced by trigger
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE
  USING (id = auth.uid());

-- Admins can update any profile (e.g., to flip coach_verified)
CREATE POLICY "profiles_update_admin" ON profiles FOR UPDATE
  USING (is_admin());

-- Insert is handled by the handle_new_user trigger (service role).
-- This policy covers the edge case where a user row must match their own auth.uid,
-- and prevents self-granting of admin role.
DROP POLICY IF EXISTS "profiles_insert_trigger" ON profiles;
CREATE POLICY "profiles_insert_trigger" ON profiles FOR INSERT
  WITH CHECK (id = auth.uid() AND role = 'coach');

-- ── teams ───────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "teams_select" ON teams;
DROP POLICY IF EXISTS "teams_insert" ON teams;
DROP POLICY IF EXISTS "teams_update" ON teams;
DROP POLICY IF EXISTS "teams_delete" ON teams;

-- Coaches can see their own team; admins can see all
CREATE POLICY "teams_select" ON teams FOR SELECT
  USING (owner_id = auth.uid() OR is_admin());

-- Only verified coaches can create a team and must be the owner
CREATE POLICY "teams_insert" ON teams FOR INSERT
  WITH CHECK (owner_id = auth.uid() AND is_coach_verified());

-- Owners and admins can update; WITH CHECK prevents owner_id hijacking
DROP POLICY IF EXISTS "teams_update" ON teams;
CREATE POLICY "teams_update" ON teams FOR UPDATE
  USING (owner_id = auth.uid() OR is_admin())
  WITH CHECK (owner_id = auth.uid() OR is_admin());

-- Only admins can delete teams
CREATE POLICY "teams_delete" ON teams FOR DELETE
  USING (is_admin());

-- ── team_achievements ───────────────────────────────────────────────────────

DROP POLICY IF EXISTS "achievements_select" ON team_achievements;
DROP POLICY IF EXISTS "achievements_insert" ON team_achievements;
DROP POLICY IF EXISTS "achievements_update" ON team_achievements;
DROP POLICY IF EXISTS "achievements_delete" ON team_achievements;

CREATE POLICY "achievements_select" ON team_achievements FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM teams
      WHERE id = team_id AND (owner_id = auth.uid() OR is_admin())
    )
  );

CREATE POLICY "achievements_insert" ON team_achievements FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM teams
      WHERE id = team_id AND owner_id = auth.uid() AND is_coach_verified()
    )
  );

CREATE POLICY "achievements_update" ON team_achievements FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM teams
      WHERE id = team_id AND (owner_id = auth.uid() OR is_admin())
    )
  );

CREATE POLICY "achievements_delete" ON team_achievements FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM teams
      WHERE id = team_id AND (owner_id = auth.uid() OR is_admin())
    )
  );

-- ── sponsors ─────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "sponsors_select_coach" ON sponsors;
DROP POLICY IF EXISTS "sponsors_insert"       ON sponsors;
DROP POLICY IF EXISTS "sponsors_update"       ON sponsors;
DROP POLICY IF EXISTS "sponsors_delete"       ON sponsors;

-- Verified coaches can see active sponsors that are not fully funded; admins see all
DROP POLICY IF EXISTS "sponsors_select_coach" ON sponsors;
CREATE POLICY "sponsors_select_coach" ON sponsors FOR SELECT
  USING (
    (is_coach_verified() AND status = 'active' AND funding_used_cents < funding_cap_cents)
    OR is_admin()
  );

-- Only admins can write sponsor records
CREATE POLICY "sponsors_insert" ON sponsors FOR INSERT
  WITH CHECK (is_admin());

CREATE POLICY "sponsors_update" ON sponsors FOR UPDATE
  USING (is_admin());

CREATE POLICY "sponsors_delete" ON sponsors FOR DELETE
  USING (is_admin());

-- ── pitches ──────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "pitches_select"       ON pitches;
DROP POLICY IF EXISTS "pitches_insert"       ON pitches;
DROP POLICY IF EXISTS "pitches_update_coach" ON pitches;
DROP POLICY IF EXISTS "pitches_update_admin" ON pitches;
DROP POLICY IF EXISTS "pitches_delete"       ON pitches;

-- Coaches see pitches for their own teams; admins see all
CREATE POLICY "pitches_select" ON pitches FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM teams WHERE id = team_id AND owner_id = auth.uid())
    OR is_admin()
  );

-- Verified coaches can create pitches for their own teams
CREATE POLICY "pitches_insert" ON pitches FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM teams WHERE id = team_id AND owner_id = auth.uid())
    AND is_coach_verified()
  );

-- Coaches can update their own pitches only when in editable states;
-- WITH CHECK prevents status escalation beyond 'submitted'
DROP POLICY IF EXISTS "pitches_update_coach" ON pitches;
CREATE POLICY "pitches_update_coach" ON pitches FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM teams WHERE id = team_id AND owner_id = auth.uid())
    AND status IN ('draft', 'changes_requested')
  )
  WITH CHECK (
    status IN ('draft', 'changes_requested', 'submitted')
  );

-- Admins can update any pitch (e.g., status transitions, feedback)
CREATE POLICY "pitches_update_admin" ON pitches FOR UPDATE
  USING (is_admin());

-- Only admins can delete pitches
CREATE POLICY "pitches_delete" ON pitches FOR DELETE
  USING (is_admin());

-- ── pitch_sponsor_targets ────────────────────────────────────────────────────

DROP POLICY IF EXISTS "pst_select" ON pitch_sponsor_targets;
DROP POLICY IF EXISTS "pst_insert" ON pitch_sponsor_targets;
DROP POLICY IF EXISTS "pst_update" ON pitch_sponsor_targets;
DROP POLICY IF EXISTS "pst_delete" ON pitch_sponsor_targets;

CREATE POLICY "pst_select" ON pitch_sponsor_targets FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM pitches p
      JOIN teams t ON t.id = p.team_id
      WHERE p.id = pitch_id AND (t.owner_id = auth.uid() OR is_admin())
    )
  );

-- Verified coaches can add sponsor targets while the pitch is still a draft
CREATE POLICY "pst_insert" ON pitch_sponsor_targets FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM pitches p
      JOIN teams t ON t.id = p.team_id
      WHERE p.id = pitch_id
        AND t.owner_id = auth.uid()
        AND p.status = 'draft'
    )
    AND is_coach_verified()
  );

-- Only admins can update dispatch status (records email outcomes)
CREATE POLICY "pst_update" ON pitch_sponsor_targets FOR UPDATE
  USING (is_admin());

-- Admins can always delete; coaches can remove targets while pitch is draft
CREATE POLICY "pst_delete" ON pitch_sponsor_targets FOR DELETE
  USING (
    is_admin() OR
    EXISTS (
      SELECT 1 FROM pitches p
      JOIN teams t ON t.id = p.team_id
      WHERE p.id = pitch_id
        AND t.owner_id = auth.uid()
        AND p.status = 'draft'
    )
  );

-- ── sponsor_applications ─────────────────────────────────────────────────────

DROP POLICY IF EXISTS "sponsor_apps_insert_public"  ON sponsor_applications;
DROP POLICY IF EXISTS "sponsor_apps_select_admin"   ON sponsor_applications;
DROP POLICY IF EXISTS "sponsor_apps_update_admin"   ON sponsor_applications;
DROP POLICY IF EXISTS "sponsor_apps_delete_admin"   ON sponsor_applications;

-- Public opt-in page: anyone (including unauthenticated users) can submit
CREATE POLICY "sponsor_apps_insert_public" ON sponsor_applications FOR INSERT
  WITH CHECK (true);

-- Only admins can read, update, or delete applications
CREATE POLICY "sponsor_apps_select_admin" ON sponsor_applications FOR SELECT
  USING (is_admin());

CREATE POLICY "sponsor_apps_update_admin" ON sponsor_applications FOR UPDATE
  USING (is_admin());

CREATE POLICY "sponsor_apps_delete_admin" ON sponsor_applications FOR DELETE
  USING (is_admin());

-- ── audit_log ────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "audit_log_select" ON audit_log;

-- Only admins can read audit logs; nobody can UPDATE or DELETE (append-only)
-- Direct INSERT for authenticated users is intentionally blocked here;
-- inserts happen via SECURITY DEFINER functions (service role) only.
CREATE POLICY "audit_log_select" ON audit_log FOR SELECT
  USING (is_admin());

-- NOTE: audit_log has no authenticated INSERT policy.
-- All inserts MUST use the Supabase service-role client (which bypasses RLS).
-- Application server actions must use createAdminClient() from lib/supabase/admin.ts,
-- NOT the user-session client, for any audit_log writes.
-- This is enforced architecturally, not at the DB layer.

-- ---------------------------------------------------------------------------
-- 9. Analytics Views
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS v_sponsor_capacity;
CREATE OR REPLACE VIEW v_sponsor_capacity
  WITH (security_invoker = true)
AS
SELECT
  id,
  company_name,
  status,
  funding_cap_cents,
  funding_used_cents,
  (funding_cap_cents - funding_used_cents) AS remaining_cents,
  CASE
    WHEN funding_cap_cents = 0 THEN 0
    ELSE ROUND((funding_used_cents::numeric / funding_cap_cents) * 100, 1)
  END AS utilization_pct
FROM sponsors;

DROP VIEW IF EXISTS v_pitch_summary;
CREATE OR REPLACE VIEW v_pitch_summary
  WITH (security_invoker = true)
AS
SELECT
  p.id,
  p.title,
  p.status,
  p.financial_ask_cents,
  t.team_name,
  t.owner_id,
  COUNT(pst.id) AS target_count,
  COUNT(pst.id) FILTER (WHERE pst.dispatch_status = 'sent') AS sent_count,
  p.created_at,
  p.updated_at
FROM pitches p
JOIN teams t ON t.id = p.team_id
LEFT JOIN pitch_sponsor_targets pst ON pst.pitch_id = p.id
GROUP BY p.id, t.team_name, t.owner_id;

-- ---------------------------------------------------------------------------
-- 10. Additional Constraints (idempotent re-run safety)
-- ---------------------------------------------------------------------------

-- Ensure full_name length constraint exists even on pre-existing schemas
DO $$ BEGIN
  ALTER TABLE profiles ADD CONSTRAINT full_name_length CHECK (char_length(full_name) <= 200);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =============================================================================
-- End of migration 0001_init.sql
-- =============================================================================
