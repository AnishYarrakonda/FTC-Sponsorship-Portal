-- 0055_coach_denial_and_throttle.sql
-- =====================================================================================
-- 1) Coach denial visibility: denyCoach previously emailed a reason but left no trace
--    the coach's UI could render. denial_reason + denied_at make the denied state
--    first-class (denied = coach_verified = false AND denied_at IS NOT NULL);
--    re-uploading credentials or verifying clears both.
-- 2) request_throttle: Postgres-backed rate limiting for unauthenticated surfaces
--    (public sponsor application form). Replaces the removed Upstash/Redis limiter.
--
-- RLS: request_throttle is deny-all (pattern from 00211 sat_deny_all) — it is only
-- ever touched via check_throttle(), whose EXECUTE is restricted to service_role
-- (the admin client). No client role can read or write throttle state.
-- =====================================================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS denial_reason text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS denied_at timestamptz;

CREATE TABLE IF NOT EXISTS request_throttle (
  key text NOT NULL,
  window_start timestamptz NOT NULL,
  count int NOT NULL DEFAULT 1,
  PRIMARY KEY (key, window_start)
);

CREATE INDEX IF NOT EXISTS idx_request_throttle_window ON request_throttle (window_start);

ALTER TABLE request_throttle ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rt_deny_all ON request_throttle;
CREATE POLICY rt_deny_all ON request_throttle FOR ALL USING (false) WITH CHECK (false);

-- Sliding-bucket throttle: returns true when the caller is within p_limit for the
-- current p_window bucket, false when over. Cleans up buckets older than 4 windows.
CREATE OR REPLACE FUNCTION check_throttle(p_key text, p_limit int, p_window interval)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_start timestamptz;
  v_count int;
BEGIN
  v_window_start := to_timestamp(
    floor(extract(epoch FROM now()) / extract(epoch FROM p_window)) * extract(epoch FROM p_window)
  );

  INSERT INTO request_throttle AS rt (key, window_start, count)
  VALUES (p_key, v_window_start, 1)
  ON CONFLICT (key, window_start)
  DO UPDATE SET count = rt.count + 1
  RETURNING rt.count INTO v_count;

  DELETE FROM request_throttle WHERE window_start < now() - (p_window * 4);

  RETURN v_count <= p_limit;
END;
$$;

-- Only the service role (admin client) may call this; PostgREST must not expose it
-- to anon/authenticated callers, or the deny-all RLS would be moot via SECURITY DEFINER.
REVOKE EXECUTE ON FUNCTION check_throttle(text, int, interval) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION check_throttle(text, int, interval) FROM anon;
REVOKE EXECUTE ON FUNCTION check_throttle(text, int, interval) FROM authenticated;
GRANT EXECUTE ON FUNCTION check_throttle(text, int, interval) TO service_role;
