-- 0059_fix_gen_random_bytes_search_path.sql
-- =====================================================================================
-- Live E2E verification caught EVERY admin approval failing with
-- "function gen_random_bytes(integer) does not exist" (42883): pgcrypto is installed
-- in the `extensions` schema on Supabase, but approve_submission_atomic (0047) pins
-- SECURITY DEFINER search_path to `public` only, so token generation can't resolve
-- gen_random_bytes. Dispatch has therefore never worked against this database.
-- Fix: ensure pgcrypto exists and widen the search_path of every $$ function that
-- generates tokens. Idempotent.
-- =====================================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

ALTER FUNCTION approve_submission_atomic(uuid, uuid, bigint) SET search_path = public, extensions;
