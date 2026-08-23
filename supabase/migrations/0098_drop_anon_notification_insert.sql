-- 0098 — close anonymous notification forgery (audit A-02-01, P0)
--
-- `service_insert_notifications` was created in 0022_inbox_and_portfolio.sql as
-- INSERT / PERMISSIVE / TO PUBLIC / WITH CHECK (true), intended as a "service role can
-- always write" escape hatch. It is both redundant and dangerous:
--
--   * redundant — service_role carries rolbypassrls, so it never consults a policy;
--   * dangerous — a policy with no TO clause defaults to PUBLIC, which includes `anon`,
--     and Supabase's blanket grant gives `anon` INSERT on every public table. The two
--     together let anyone holding the (public by design) anon key forge a notification
--     to any user.
--
-- Verified against a local stack before writing this migration: an unauthenticated
-- POST /rest/v1/notifications returned 201 and created the row. (It only appears to fail
-- when the caller sends `Prefer: return=representation`, because the RETURNING clause is
-- then additionally checked against the SELECT policy — which masked this in casual testing.)
--
-- Safe to drop: the only INSERT path in the application is createInAppNotification()
-- at lib/notify.ts, which uses createAdminClient() (service_role, bypasses RLS).
-- app/actions/notifications.ts performs UPDATEs only, covered by notifications_update_own.

DROP POLICY IF EXISTS service_insert_notifications ON public.notifications;

-- Defence in depth: `anon` has no legitimate interaction with this table in any flow.
-- Left intact for `authenticated`, whose reads/updates are gated by the remaining
-- policies (coaches_read_own_notifications, notifications_update_own).
-- TRUNCATE is included because RLS does not restrict it at all — only the grant does.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.notifications FROM anon;
