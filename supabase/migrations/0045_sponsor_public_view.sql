-- 0045_sponsor_public_view.sql
-- Coach-safe projection of sponsors that omits PII columns (contact_name,
-- contact_email, contact_title, notes). Admin pages keep reading from the
-- base sponsors table directly.

DROP VIEW IF EXISTS v_sponsors_public;
CREATE OR REPLACE VIEW v_sponsors_public WITH (security_invoker = true) AS
SELECT
  id,
  company_name,
  industry,
  website,
  logo_url,
  funding_cap_cents,
  funding_used_cents,
  status,
  created_at
FROM sponsors;

GRANT SELECT ON v_sponsors_public TO authenticated;
