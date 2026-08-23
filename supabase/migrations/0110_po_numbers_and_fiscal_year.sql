-- 0110_po_numbers_and_fiscal_year.sql
-- APPLY WITH: psql "$DATABASE_URL" -f supabase/migrations/0110_po_numbers_and_fiscal_year.sql
-- Idempotent (ADD COLUMN IF NOT EXISTS + guarded constraints).
--
-- A-12-04. An enterprise finance department cannot process a payment without tying it to a
-- purchase order, and reports against a fiscal year that is usually not the calendar year.
--
-- ============================================================================
-- WHAT THIS DELIBERATELY DOES **NOT** DO, AND WHY
-- ============================================================================
--
-- The finding's direction was to "migrate funding caps to be bucketed by year". This does
-- not do that, on purpose.
--
-- `sponsors.funding_cap_cents` is the enforcement point for Capacity Integrity — a Core
-- Mandate. Every reserve, release and settle path is written against it, and the invariant
--
--     funding_used_cents = open reservations + settled ledger
--
-- is asserted by scripts/verify-capacity-invariant.mjs and by detect_capacity_drift().
-- Introducing a SECOND budget number that also constrains funding would put money state in
-- two shapes, which is precisely the failure the audit prompt warned about for this item:
-- two numbers that can disagree, with nothing to say which one is right.
--
-- So the cap stays the single source of truth, and the fiscal year is a REPORTING AND
-- RESET BOUNDARY rather than a second budget:
--
--   * `fiscal_year_start_month` says when this sponsor's year turns over. CSR reporting and
--     the impact snapshot group by it.
--   * Nothing resets `funding_used_cents` automatically. A silent reset would free capacity
--     — that is money state changing with no actor and no audit row, which this codebase
--     has been bitten by before. Rolling a sponsor into a new year is an explicit admin act
--     against the existing cap, and it is already audited as one.
--
-- If a genuine per-year cap is wanted later, it belongs in the same table as
-- funding_used_cents with the reserve/settle functions rewritten around it in one change —
-- not bolted alongside.

-- ── PO number ───────────────────────────────────────────────────────────────────────────
-- On funding_fulfillments, not transactions_ledger: the ledger is the immutable record of
-- what was decided, while the PO is administrative metadata the sponsor's AP department
-- adds and corrects afterwards. Writing it to the ledger would make an immutable row
-- mutable, which is the property the ledger exists to have.
ALTER TABLE funding_fulfillments
  ADD COLUMN IF NOT EXISTS po_number text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'funding_fulfillments_po_number_len') THEN
    ALTER TABLE funding_fulfillments
      ADD CONSTRAINT funding_fulfillments_po_number_len
      CHECK (po_number IS NULL OR length(btrim(po_number)) BETWEEN 1 AND 64);
  END IF;
END $$;

COMMENT ON COLUMN funding_fulfillments.po_number IS
  'A-12-04. Sponsor AP purchase-order reference for this commitment. Administrative only — it constrains nothing and is never used in capacity arithmetic.';

-- ── Fiscal year ─────────────────────────────────────────────────────────────────────────
-- 1-12, defaulting to January so every existing sponsor keeps calendar-year behaviour.
ALTER TABLE sponsors
  ADD COLUMN IF NOT EXISTS fiscal_year_start_month smallint NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sponsors_fiscal_year_start_month_range') THEN
    ALTER TABLE sponsors
      ADD CONSTRAINT sponsors_fiscal_year_start_month_range
      CHECK (fiscal_year_start_month BETWEEN 1 AND 12);
  END IF;
END $$;

COMMENT ON COLUMN sponsors.fiscal_year_start_month IS
  'A-12-04. Month (1-12) this sponsor''s fiscal year begins. A reporting boundary only: it does not reset funding_used_cents and does not participate in the capacity cap.';

/**
 * Which fiscal year a moment falls in, for a sponsor whose year starts in
 * `p_start_month`. Labelled by the calendar year the fiscal year ENDS in, which is the
 * convention finance departments use ("FY26" for a year starting July 2025).
 */
CREATE OR REPLACE FUNCTION public.fiscal_year_of(p_at timestamptz, p_start_month smallint)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE
    WHEN p_start_month IS NULL OR p_start_month = 1
      THEN EXTRACT(YEAR FROM p_at)::int
    WHEN EXTRACT(MONTH FROM p_at)::int >= p_start_month
      THEN EXTRACT(YEAR FROM p_at)::int + 1
    ELSE EXTRACT(YEAR FROM p_at)::int
  END;
$function$;

REVOKE ALL ON FUNCTION public.fiscal_year_of(timestamptz, smallint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fiscal_year_of(timestamptz, smallint) TO authenticated, service_role;
