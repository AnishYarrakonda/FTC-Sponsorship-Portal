-- =============================================================================
-- Migration: 0074_purge_coach_credentials.sql
-- Project:   FTC Sponsorship Portal ("FTC Pitfund")
-- Purpose:   Retention control for coach photo IDs.
--
--            A government photo ID is evidence for exactly one decision: "is this
--            a verified adult?". Once an admin answers that, the document has no
--            further purpose. But it stayed in the `coach-credentials` bucket
--            forever — denyCoach() removed the file, verifyCoach() never did.
--            So the coaches who were APPROVED, the ones who stick around, were
--            precisely the ones whose IDs accumulated indefinitely.
--
--            Nulling `coach_credentials_url` on its own is ambiguous: it is
--            byte-identical to "never uploaded", which the admin queue renders as
--            "Awaiting Upload" and would put a fully verified coach back in the
--            unreviewed pile. This column disambiguates the two.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.
-- =============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS coach_credentials_purged_at timestamptz;

COMMENT ON COLUMN public.profiles.coach_credentials_purged_at IS
  'When the coach photo ID was destroyed after a verification decision. '
  'url NULL + this NULL = never uploaded. url NULL + this NOT NULL = reviewed, then purged. '
  'A retention marker, not a soft delete — the bytes are gone from storage and are not recoverable.';

-- Rows still awaiting purge: a verification that ran before this migration, or one
-- whose storage delete failed and needs the nightly sweep to retry. The sweep polls
-- exactly this predicate.
--
-- Partial on purpose. The steady state is ZERO matching rows, so the index stays
-- empty and costs effectively nothing to carry — unlike a plain index on
-- coach_verified, which would hold a row for every coach on the platform forever.
CREATE INDEX IF NOT EXISTS idx_profiles_credentials_pending_purge
  ON public.profiles (id)
  WHERE coach_verified = true AND coach_credentials_url IS NOT NULL;
