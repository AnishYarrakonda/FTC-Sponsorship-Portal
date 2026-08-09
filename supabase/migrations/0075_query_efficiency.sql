-- =============================================================================
-- Migration: 0075_query_efficiency.sql
-- Project:   FTC Sponsorship Portal ("FTC Pitfund")
-- Purpose:   Three scale fixes, none of which change behaviour.
--
--            1. Drop a duplicate index. `submissions` carried TWO byte-identical
--               btrees on `resend_message_id` (idx_submissions_resend_message_id
--               and idx_submissions_resend_msg). Every insert and every update of
--               that column paid to maintain both, and both occupied disk, for
--               exactly one index worth of benefit.
--
--            2. Make the audit-log filter dropdown stop reading the whole table.
--               The page fetched `action` for EVERY audit row and de-duplicated in
--               JavaScript, to render a list of ~15 values. audit_log is the
--               fastest-growing table on the platform (one row per admin action,
--               plus one per nightly cron run, forever), so that transfer grows
--               without bound while the rendered output stays the same size.
--
--            3. Replace transactions_ledger's single-column sponsor index with the
--               composite the sponsor funding page actually needs. That page filters
--               on sponsor_id AND sorts by created_at; with only the single-column
--               index Postgres had to sort the matched rows every time.
--
-- Idempotent: DROP/CREATE ... IF [NOT] EXISTS, CREATE OR REPLACE.
-- =============================================================================

-- 1. Redundant duplicate. Keep the descriptively-named one.
DROP INDEX IF EXISTS public.idx_submissions_resend_msg;

-- 2. Supports the DISTINCT below as an index-only scan.
CREATE INDEX IF NOT EXISTS idx_audit_log_action
  ON public.audit_log (action);

-- Returns the ~15 distinct action names instead of N rows. The scan still happens,
-- but it happens in Postgres against a compact index rather than by shipping every
-- row of the largest table over the wire to be de-duplicated in a browser-bound
-- JavaScript Set.
CREATE OR REPLACE FUNCTION public.distinct_audit_actions()
RETURNS TABLE (action text)
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
  SELECT DISTINCT a.action FROM public.audit_log a ORDER BY 1
$fn$;

-- SECURITY INVOKER (the default) on purpose: audit_log is RLS-protected and the only
-- caller is the admin page's service-role client, which bypasses RLS already. A
-- SECURITY DEFINER here would hand every authenticated role a read primitive over the
-- audit log's shape for no benefit.
REVOKE ALL ON FUNCTION public.distinct_audit_actions() FROM public;
REVOKE ALL ON FUNCTION public.distinct_audit_actions() FROM anon;
REVOKE ALL ON FUNCTION public.distinct_audit_actions() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.distinct_audit_actions() TO service_role;

-- 3. Serves `WHERE sponsor_id = ? ORDER BY created_at DESC` as a single index scan.
CREATE INDEX IF NOT EXISTS idx_transactions_sponsor_created
  ON public.transactions_ledger (sponsor_id, created_at DESC);

-- Now redundant: a btree on (sponsor_id, created_at) serves every query the
-- sponsor_id-only index served, because sponsor_id is the leading column. Dropped
-- second so the replacement is in place before the original goes away.
DROP INDEX IF EXISTS public.idx_transactions_sponsor;
