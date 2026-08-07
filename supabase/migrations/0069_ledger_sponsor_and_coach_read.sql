-- 0069_ledger_sponsor_and_coach_read.sql
-- =====================================================================================
-- P1 (report §2 item 7): transactions_ledger has no sponsor RLS policy.
--
-- 0017_transactions_ledger.sql:23 creates exactly one policy, `ledger_select_admin`
-- (USING is_admin()), and RLS denies by default. app/(sponsor)/sponsor/funding/page.tsx
-- reads the ledger with the sponsor's own RLS-respecting client, so the Funding page can
-- never display a single transaction and always reads $0 — including the "Total Funds
-- Distributed" headline the sponsor uses to confirm their money was recorded.
--
-- A sponsor reading their own settled funding rows is exactly the intended disclosure.
-- Scoped to their own sponsor_id, so no sponsor can see another's book.
--
-- INSERT/UPDATE/DELETE remain policy-less and therefore denied for every non-service
-- role: the ledger stays append-only, written solely by the SECURITY DEFINER RPCs.
--
-- APPLY WITH:  psql "$DATABASE_URL" -f supabase/migrations/0069_ledger_sponsor_and_coach_read.sql
-- Idempotent.
-- =====================================================================================

DROP POLICY IF EXISTS "ledger_select_sponsor" ON transactions_ledger;
CREATE POLICY "ledger_select_sponsor" ON transactions_ledger FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
       WHERE p.id = current_profile_id()
         AND p.role = 'sponsor'
         AND p.sponsor_id IS NOT NULL
         AND p.sponsor_id = transactions_ledger.sponsor_id
    )
  );

-- NOTE: this policy's sublink on `teams` is only safe because 0066 keeps every policy on
-- `teams` sublink-free (its sponsor predicate is wrapped in sponsor_can_view_team()). If a
-- future policy on `teams` gains an inline sublink back to `submissions` or to this table,
-- every read here fails 42P17. Apply 0066 before this file.
--
-- A coach seeing the funding their own team actually received is the same class of
-- legitimate self-disclosure, and the coach dashboard has no other source of truth for
-- "did this get funded, and for how much". Scoped to teams they own.
-- NOTE: team_id is nullable since 0061 (ON DELETE SET NULL). A ledger row whose team was
-- deleted has team_id NULL and is matched by neither branch — correct, since the coach
-- who owned it no longer exists.
DROP POLICY IF EXISTS "ledger_select_coach" ON transactions_ledger;
CREATE POLICY "ledger_select_coach" ON transactions_ledger FOR SELECT
  USING (
    transactions_ledger.team_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM teams t
       WHERE t.id = transactions_ledger.team_id
         AND t.owner_id = current_profile_id()
    )
  );

-- =====================================================================================
-- VERIFICATION
-- 1. As a sponsor with at least one settled acceptance: /sponsor/funding must list the
--    transaction and show a non-zero total.        (before: always empty, always $0)
-- 2. As a DIFFERENT sponsor: that row must not appear.
-- 3. As a coach: only rows for teams they own.
-- 4. As anon: GET /rest/v1/transactions_ledger?select=* -> []
-- 5. Append-only still holds — as a sponsor:
--      PATCH /rest/v1/transactions_ledger?id=eq.<id> {"amount_cents":1}  -> 0 rows
--      DELETE /rest/v1/transactions_ledger?id=eq.<id>                    -> 0 rows
--
--    SELECT policyname, cmd FROM pg_policies
--     WHERE schemaname='public' AND tablename='transactions_ledger' ORDER BY 1;
--    -- expect exactly: ledger_select_admin, ledger_select_coach, ledger_select_sponsor
-- =====================================================================================
