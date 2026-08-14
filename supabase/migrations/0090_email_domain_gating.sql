-- 0090_email_domain_gating.sql
--
-- Corporate email domain gating on the SPONSOR application path, plus the columns the
-- admin reviewer needs to see whether an applicant's email domain matches the company
-- website they claim.
--
-- Two things happen here:
--
--   1. `sponsor_applications` finally persists the `website` the signup wizard has always
--      collected (lib/schemas/sponsor-signup.ts) and always discarded, plus the derived
--      email/website apex domains and the comparison verdict.
--   2. `email_domain_rules` — a block/allow list of mail domains, in the DATABASE rather
--      than in code, so an admin can allowlist a small business's Gmail address without a
--      deploy and a compromised list can be emptied with one DELETE.
--
-- Scope fence: this gate is applied ONLY to createSponsorApplication. Coaches are unpaid
-- volunteers who legitimately sign up with personal mail; the coach path never reads this
-- table. See prompts/16 and lib/sponsor-domain-gate.ts.
--
-- Idempotent: `ADD COLUMN IF NOT EXISTS ... CHECK (...)` skips the whole clause when the
-- column exists (a bare ADD CONSTRAINT would not), and the seed uses ON CONFLICT DO
-- NOTHING so replaying this file cannot re-block a domain an admin allowlisted in between.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. sponsor_applications: persist the website and the domain verdict
-- ---------------------------------------------------------------------------

ALTER TABLE sponsor_applications ADD COLUMN IF NOT EXISTS website        text;
ALTER TABLE sponsor_applications ADD COLUMN IF NOT EXISTS email_domain   text;
ALTER TABLE sponsor_applications ADD COLUMN IF NOT EXISTS website_domain text;
ALTER TABLE sponsor_applications ADD COLUMN IF NOT EXISTS domain_match   text
  CHECK (domain_match IN ('match', 'related', 'mismatch', 'unknown'));

COMMENT ON COLUMN sponsor_applications.domain_match IS
  'Advisory only. A mismatch is a warning shown to a human reviewer, never an auto-rejection.';

-- Partial index: the admin queue only ever filters for the flagged ones.
CREATE INDEX IF NOT EXISTS idx_sponsor_apps_domain_mismatch
  ON sponsor_applications (created_at DESC) WHERE domain_match = 'mismatch';

-- ---------------------------------------------------------------------------
-- 2. email_domain_rules
-- ---------------------------------------------------------------------------
-- `domain` is the PK, so a domain is either blocked or allowed, never both, and an admin
-- flipping one is a plain upsert. Resolution order in the application code is still an
-- explicit "allow beats block" early return, because that is what the admin UI promises.

CREATE TABLE IF NOT EXISTS email_domain_rules (
  domain     text PRIMARY KEY,        -- lowercase apex, no scheme, no leading dot
  rule       text NOT NULL CHECK (rule IN ('block', 'allow')),
  category   text NOT NULL DEFAULT 'other'
    CHECK (category IN ('consumer', 'disposable', 'manual', 'other')),
  reason     text,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_edr_rule ON email_domain_rules (rule);

DROP TRIGGER IF EXISTS set_updated_at_email_domain_rules ON email_domain_rules;
CREATE TRIGGER set_updated_at_email_domain_rules
  BEFORE UPDATE ON email_domain_rules
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();   -- defined in 0001_init.sql:225

ALTER TABLE email_domain_rules ENABLE ROW LEVEL SECURITY;

-- Admins read the lists. There is deliberately NO insert/update/delete policy: RLS denies
-- by default, so the table is service-role-write-only, the same idiom as audit_log and
-- team_verification_records. Every write goes through adminSetEmailDomainRule /
-- adminDeleteEmailDomainRule, and every read inside checkSponsorEmailDomain goes through
-- the admin client too — that check runs for a caller who could never satisfy is_admin().
DROP POLICY IF EXISTS "edr_select_admin" ON email_domain_rules;
CREATE POLICY "edr_select_admin" ON email_domain_rules FOR SELECT
  USING (is_admin());

-- ---------------------------------------------------------------------------
-- 3. Seed
-- ---------------------------------------------------------------------------

INSERT INTO email_domain_rules (domain, rule, category, reason) VALUES
  -- Consumer mail
  ('gmail.com','block','consumer','Consumer mail'),
  ('googlemail.com','block','consumer','Consumer mail'),
  ('yahoo.com','block','consumer','Consumer mail'),
  ('ymail.com','block','consumer','Consumer mail'),
  ('outlook.com','block','consumer','Consumer mail'),
  ('hotmail.com','block','consumer','Consumer mail'),
  ('live.com','block','consumer','Consumer mail'),
  ('msn.com','block','consumer','Consumer mail'),
  ('aol.com','block','consumer','Consumer mail'),
  ('icloud.com','block','consumer','Consumer mail'),
  ('me.com','block','consumer','Consumer mail'),
  ('mac.com','block','consumer','Consumer mail'),
  ('proton.me','block','consumer','Consumer mail'),
  ('protonmail.com','block','consumer','Consumer mail'),
  ('pm.me','block','consumer','Consumer mail'),
  ('gmx.com','block','consumer','Consumer mail'),
  ('gmx.net','block','consumer','Consumer mail'),
  ('mail.com','block','consumer','Consumer mail'),
  ('zoho.com','block','consumer','Consumer mail'),
  ('yandex.com','block','consumer','Consumer mail'),
  ('fastmail.com','block','consumer','Consumer mail'),
  ('hey.com','block','consumer','Consumer mail'),
  -- Disposable / throwaway
  ('mailinator.com','block','disposable','Disposable mail'),
  ('guerrillamail.com','block','disposable','Disposable mail'),
  ('10minutemail.com','block','disposable','Disposable mail'),
  ('tempmail.com','block','disposable','Disposable mail'),
  ('temp-mail.org','block','disposable','Disposable mail'),
  ('throwawaymail.com','block','disposable','Disposable mail'),
  ('yopmail.com','block','disposable','Disposable mail'),
  ('trashmail.com','block','disposable','Disposable mail'),
  ('sharklasers.com','block','disposable','Disposable mail'),
  ('dispostable.com','block','disposable','Disposable mail'),
  ('getnada.com','block','disposable','Disposable mail'),
  ('maildrop.cc','block','disposable','Disposable mail'),
  ('mailnesia.com','block','disposable','Disposable mail'),
  ('spamgourmet.com','block','disposable','Disposable mail'),
  ('emailondeck.com','block','disposable','Disposable mail')
ON CONFLICT (domain) DO NOTHING;

COMMIT;
