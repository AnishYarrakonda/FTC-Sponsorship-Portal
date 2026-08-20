-- 0081_ftc_official_verification.sql
-- =====================================================================================
-- Official FIRST Events API as the primary team-verification source, with the existing
-- FTCScout query kept as fallback, plus a cross-check of the coach-supplied team name
-- and organization against the official record. Records every check in
-- team_verification_records with an admin override path.
--
-- No new SECURITY DEFINER function is required by this slice (prompts/07 §"Data model").
-- Every write to team_verification_records and to ftc_teams_cache goes through the
-- admin (service-role) client — same append-only idiom as audit_log / transactions_ledger.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS carries its inline CHECK (the whole clause is
-- skipped once the column exists), CREATE TABLE/INDEX IF NOT EXISTS, DROP POLICY IF
-- EXISTS before each CREATE POLICY.
-- =====================================================================================

-- ── 1. ftc_teams_cache: official fields, provenance, freshness ────────────────
ALTER TABLE ftc_teams_cache ADD COLUMN IF NOT EXISTS official_team_name text;
ALTER TABLE ftc_teams_cache ADD COLUMN IF NOT EXISTS organization       text;
ALTER TABLE ftc_teams_cache ADD COLUMN IF NOT EXISTS rookie_year        integer;
ALTER TABLE ftc_teams_cache ADD COLUMN IF NOT EXISTS region_code        text;
ALTER TABLE ftc_teams_cache ADD COLUMN IF NOT EXISTS district_code      text;
ALTER TABLE ftc_teams_cache ADD COLUMN IF NOT EXISTS source             text NOT NULL DEFAULT 'ftcscout'
  CHECK (source IN ('first_api', 'ftcscout', 'manual'));
ALTER TABLE ftc_teams_cache ADD COLUMN IF NOT EXISTS verified_at        timestamptz;

CREATE INDEX IF NOT EXISTS idx_ftc_cache_stale
  ON ftc_teams_cache (last_synced);

COMMENT ON COLUMN ftc_teams_cache.source IS
  'Where this row came from. first_api = official FIRST Events API (authoritative); '
  'ftcscout = community mirror fallback; manual = admin-entered override.';

-- ── 2. team_verification_records ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_verification_records (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nullable: a check runs BEFORE the teams row exists (createTeam, verifyCoach
  -- provisioning). Backfilled by the caller once the row is inserted.
  team_id               uuid REFERENCES teams(id)    ON DELETE CASCADE,
  profile_id            uuid REFERENCES profiles(id) ON DELETE SET NULL,
  ftc_team_number       integer NOT NULL,
  claimed_team_name     text    NOT NULL,
  claimed_organization  text,
  official_team_name    text,
  official_organization text,
  source                text NOT NULL
    CHECK (source IN ('first_api', 'ftcscout', 'cache', 'manual', 'none')),
  name_score            numeric(4,3) NOT NULL DEFAULT 0,
  organization_score    numeric(4,3),
  confidence            numeric(4,3) NOT NULL DEFAULT 0,
  outcome               text NOT NULL
    CHECK (outcome IN ('auto_pass', 'needs_review', 'rejected', 'overridden', 'unavailable')),
  override_reason       text,
  overridden_by         uuid REFERENCES profiles(id) ON DELETE SET NULL,
  overridden_at         timestamptz,
  checked_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT override_requires_reason CHECK (
    outcome <> 'overridden' OR (override_reason IS NOT NULL AND overridden_by IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_tvr_team_id       ON team_verification_records (team_id);
CREATE INDEX IF NOT EXISTS idx_tvr_needs_review  ON team_verification_records (checked_at DESC)
  WHERE outcome = 'needs_review';
CREATE INDEX IF NOT EXISTS idx_tvr_ftc_number    ON team_verification_records (ftc_team_number);

ALTER TABLE team_verification_records ENABLE ROW LEVEL SECURITY;

-- Admins see every record.
DROP POLICY IF EXISTS "tvr_select_admin" ON team_verification_records;
CREATE POLICY "tvr_select_admin" ON team_verification_records FOR SELECT
  USING (is_admin());

-- A coach sees only checks about their own claim/team. The sublink on `teams` is safe:
-- the 42P17 hazard (0066) applies to sublinks written INSIDE a policy on `teams` itself;
-- every `teams` policy stays sublink-free, and this policy is on a different table.
DROP POLICY IF EXISTS "tvr_select_own" ON team_verification_records;
CREATE POLICY "tvr_select_own" ON team_verification_records FOR SELECT
  USING (
    profile_id = current_profile_id()
    OR EXISTS (
      SELECT 1 FROM teams t
       WHERE t.id = team_verification_records.team_id
         AND t.owner_id = current_profile_id()
    )
  );

-- No INSERT / UPDATE / DELETE policies. RLS denies by default, so the table is
-- service-role-write-only — the same append-only idiom as audit_log (0001) and
-- transactions_ledger (0017/0069). Every write in this slice goes through the admin
-- client (createAdminClient()).

-- ftc_teams_cache keeps its existing cache_select policy unchanged (0051); the new
-- columns inherit it. No write policy is added — the roster writer is the admin client.
