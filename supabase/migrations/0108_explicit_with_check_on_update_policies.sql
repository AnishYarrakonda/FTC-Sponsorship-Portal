-- 0108_explicit_with_check_on_update_policies.sql
-- APPLY WITH: psql "$DATABASE_URL" -f supabase/migrations/0108_explicit_with_check_on_update_policies.sql
-- Idempotent (DROP POLICY IF EXISTS + CREATE POLICY).
--
-- A-02-04. Four UPDATE policies carried a USING clause and no WITH CHECK:
--
--   public.profiles          profiles_update_admin
--   public.submissions       submissions_update_admin
--   public.team_achievements achievements_update
--   storage.objects          "Coaches can update their own team logo"
--
-- (The finding named three. The fourth came out of sweeping pg_policies rather than
-- spot-checking the migrations, which is why the sweep was done that way.)
--
-- HONEST SCOPE. This is NOT a live privilege escalation. Postgres defaults an omitted
-- WITH CHECK to the USING expression, so the post-image is already being checked against
-- the same predicate today. Nothing can currently be updated out of scope through these.
--
-- What it buys is that the guarantee stops being implicit. The failure mode being closed
-- is editorial: someone later widens a USING clause to fix a read, and the write check
-- silently widens with it, in four policies where the read and write rules genuinely
-- should move together but nothing says so. Writing both makes any future divergence a
-- visible diff instead of a side effect. The project's RLS checklist mandates explicit
-- per-role policies for exactly this reason.
--
-- Every WITH CHECK below is a byte-for-byte mirror of the live USING clause, dumped from
-- pg_policies rather than retyped from the original migration files.

-- profiles: admin may update any row (0096 owns the self-update policy separately).
DROP POLICY IF EXISTS profiles_update_admin ON public.profiles;
CREATE POLICY profiles_update_admin ON public.profiles
  FOR UPDATE
  USING (is_admin())
  WITH CHECK (is_admin());

-- submissions: admin moderation writes.
DROP POLICY IF EXISTS submissions_update_admin ON public.submissions;
CREATE POLICY submissions_update_admin ON public.submissions
  FOR UPDATE
  USING (is_admin())
  WITH CHECK (is_admin());

-- team_achievements: the owning VERIFIED coach, or an admin. The verified-coach half is
-- the part that most needs an explicit post-image check -- it is the same shape 0102 had
-- to add to teams_update, where the omission was real.
DROP POLICY IF EXISTS achievements_update ON public.team_achievements;
CREATE POLICY achievements_update ON public.team_achievements
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM teams
       WHERE teams.id = team_achievements.team_id
         AND (((teams.owner_id = current_profile_id()) AND is_coach_verified()) OR is_admin())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM teams
       WHERE teams.id = team_achievements.team_id
         AND (((teams.owner_id = current_profile_id()) AND is_coach_verified()) OR is_admin())
    )
  );

-- storage.objects: team logos are partitioned by the Clerk user id in the first path
-- segment. Without an explicit WITH CHECK the implicit default already prevents moving an
-- object into another coach's folder; this states it.
DROP POLICY IF EXISTS "Coaches can update their own team logo" ON storage.objects;
CREATE POLICY "Coaches can update their own team logo" ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'team-logos'
    AND (auth.jwt() ->> 'sub') = (storage.foldername(name))[1]
  )
  WITH CHECK (
    bucket_id = 'team-logos'
    AND (auth.jwt() ->> 'sub') = (storage.foldername(name))[1]
  );
