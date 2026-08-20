-- Cache for FTC team data from FIRST public roster
CREATE TABLE IF NOT EXISTS ftc_teams_cache (
  team_number integer PRIMARY KEY,
  team_name   text NOT NULL,
  city        text,
  state       text,
  country     text,
  last_synced timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS (though this is a cache, we want it protected)
ALTER TABLE ftc_teams_cache ENABLE ROW LEVEL SECURITY;

-- Allow verified coaches and admins to read the cache
DROP POLICY IF EXISTS "cache_select" ON ftc_teams_cache;
CREATE POLICY "cache_select" ON ftc_teams_cache FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Allow system/admin to insert/update (using service role)
-- No public write policy.
