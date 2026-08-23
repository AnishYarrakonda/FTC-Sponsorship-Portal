-- 0103_pending_storage_deletions.sql
-- A-06-02 (P1): a superseded government ID or W-9 is orphaned forever when its
-- best-effort delete fails.
--
-- Both supersede paths (app/actions/credentials.ts, app/actions/payout.ts) overwrite the
-- pointer column FIRST and then delete the old object with a .catch(console.error). Once
-- the pointer is overwritten, nothing in the system knows the old path — so the object is
-- invisible to sweepUnpurgedCredentials(), which only walks live pointers. A single
-- transient storage error retains a photo of someone's driver's licence indefinitely, and
-- no alarm is raised.
--
-- This is the durable work queue the nightly sweep retries from. It is deliberately NOT
-- a generic job table: bucket+path is unique, so re-enqueueing the same object is a no-op
-- and the queue cannot grow unbounded from retries.
--
-- Idempotent: IF NOT EXISTS throughout.

CREATE TABLE IF NOT EXISTS public.pending_storage_deletions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket          text NOT NULL,
  path            text NOT NULL,
  reason          text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  attempts        integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  last_error      text,
  deleted_at      timestamptz,
  CONSTRAINT pending_storage_deletions_bucket_path_key UNIQUE (bucket, path)
);

-- The sweep's predicate. Partial, because the steady state is that almost every row is
-- already settled and only the unsettled ones are ever scanned.
CREATE INDEX IF NOT EXISTS idx_pending_storage_deletions_outstanding
  ON public.pending_storage_deletions (created_at)
  WHERE deleted_at IS NULL;

ALTER TABLE public.pending_storage_deletions ENABLE ROW LEVEL SECURITY;

-- No coach or sponsor has any business reading this: the paths themselves identify
-- who uploaded a government ID. Admins can read it so the queue is observable; every
-- write goes through the admin client (service_role, which bypasses RLS entirely).
DROP POLICY IF EXISTS pending_storage_deletions_admin_select ON public.pending_storage_deletions;
CREATE POLICY pending_storage_deletions_admin_select
  ON public.pending_storage_deletions
  FOR SELECT
  USING (is_admin());

REVOKE ALL ON public.pending_storage_deletions FROM anon;
GRANT SELECT ON public.pending_storage_deletions TO authenticated;
