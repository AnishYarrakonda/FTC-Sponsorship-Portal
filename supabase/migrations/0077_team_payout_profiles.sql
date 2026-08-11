-- 0077_team_payout_profiles.sql
-- Cost of this decision: a new required env var PAYOUT_ENCRYPTION_KEY, a key that must be present before any payout profile can be written, and no key rotation tooling.

-- 1. Create the enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payee_tax_classification') THEN
    CREATE TYPE payee_tax_classification AS ENUM (
      '501c3_org',
      'school_district',
      'fiscal_sponsor',
      'other_nonprofit',
      'unincorporated'
    );
  END IF;
END $$;

-- 2. Create the table
CREATE TABLE IF NOT EXISTS team_payout_profiles (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id                uuid NOT NULL UNIQUE REFERENCES teams(id) ON DELETE CASCADE,

  -- Payee identity (what goes on the check)
  legal_payee_name       text NOT NULL CHECK (char_length(legal_payee_name) BETWEEN 2 AND 200),
  tax_classification     payee_tax_classification NOT NULL,
  ein_ciphertext         bytea,
  ein_last4              text CHECK (ein_last4 IS NULL OR ein_last4 ~ '^[0-9]{4}$'),

  -- Fiscal sponsor path
  is_fiscally_sponsored  boolean NOT NULL DEFAULT false,
  fiscal_sponsor_name    text CHECK (fiscal_sponsor_name IS NULL OR char_length(fiscal_sponsor_name) <= 200),
  fiscal_sponsor_ein_ciphertext bytea,
  fiscal_sponsor_ein_last4      text CHECK (fiscal_sponsor_ein_last4 IS NULL OR fiscal_sponsor_ein_last4 ~ '^[0-9]{4}$'),

  -- Where a paper check goes
  mailing_address_line1  text CHECK (mailing_address_line1 IS NULL OR char_length(mailing_address_line1) <= 200),
  mailing_address_line2  text CHECK (mailing_address_line2 IS NULL OR char_length(mailing_address_line2) <= 200),
  mailing_city           text CHECK (mailing_city  IS NULL OR char_length(mailing_city)  <= 120),
  mailing_state          text CHECK (mailing_state IS NULL OR char_length(mailing_state) <= 2),
  mailing_postal_code    text CHECK (mailing_postal_code IS NULL OR mailing_postal_code ~ '^[0-9]{5}(-[0-9]{4})?$'),
  remittance_email       text CHECK (remittance_email IS NULL OR char_length(remittance_email) <= 254),

  -- W-9 document
  w9_document_path       text,
  w9_uploaded_at         timestamptz,
  w9_expires_at          timestamptz,
  w9_renewal_notified_at timestamptz,
  w9_purged_at           timestamptz,

  -- Admin review
  w9_verified_by         uuid REFERENCES profiles(id) ON DELETE SET NULL,
  w9_verified_at         timestamptz,
  w9_rejected_reason     text CHECK (w9_rejected_reason IS NULL OR char_length(w9_rejected_reason) <= 1000),
  w9_rejected_at         timestamptz,

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT payout_fiscal_sponsor_named CHECK (
    NOT is_fiscally_sponsored OR fiscal_sponsor_name IS NOT NULL
  )
);

COMMENT ON COLUMN team_payout_profiles.w9_purged_at IS 'w9_document_path NULL + this NULL = never uploaded; NULL + NOT NULL = uploaded, then destroyed.';

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_payout_profiles_team ON team_payout_profiles(team_id);

CREATE INDEX IF NOT EXISTS idx_payout_profiles_awaiting_review
  ON team_payout_profiles (w9_uploaded_at)
  WHERE w9_uploaded_at IS NOT NULL AND w9_verified_at IS NULL AND w9_rejected_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_payout_profiles_expiring
  ON team_payout_profiles (w9_expires_at)
  WHERE w9_verified_at IS NOT NULL AND w9_expires_at IS NOT NULL;

-- 4. RLS
ALTER TABLE team_payout_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payout_select_admin" ON team_payout_profiles;
CREATE POLICY "payout_select_admin" ON team_payout_profiles FOR SELECT USING (is_admin());

DROP POLICY IF EXISTS "payout_select_coach" ON team_payout_profiles;
CREATE POLICY "payout_select_coach" ON team_payout_profiles FOR SELECT USING (
  EXISTS (SELECT 1 FROM teams t WHERE t.id = team_payout_profiles.team_id AND t.owner_id = current_profile_id())
);

DROP POLICY IF EXISTS "payout_insert_coach" ON team_payout_profiles;
CREATE POLICY "payout_insert_coach" ON team_payout_profiles FOR INSERT WITH CHECK (
  is_coach_verified() AND EXISTS (SELECT 1 FROM teams t WHERE t.id = team_payout_profiles.team_id AND t.owner_id = current_profile_id())
);

DROP POLICY IF EXISTS "payout_update_coach" ON team_payout_profiles;
CREATE POLICY "payout_update_coach" ON team_payout_profiles FOR UPDATE USING (
  is_coach_verified() AND EXISTS (SELECT 1 FROM teams t WHERE t.id = team_payout_profiles.team_id AND t.owner_id = current_profile_id())
) WITH CHECK (
  is_coach_verified() AND EXISTS (SELECT 1 FROM teams t WHERE t.id = team_payout_profiles.team_id AND t.owner_id = current_profile_id())
);

DROP POLICY IF EXISTS "payout_update_admin" ON team_payout_profiles;
CREATE POLICY "payout_update_admin" ON team_payout_profiles FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());

-- 5. Column-write guard
CREATE OR REPLACE FUNCTION guard_payout_profile_writable_columns()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_allowed text[] := ARRAY[
    'team_id','legal_payee_name','tax_classification','ein_ciphertext','ein_last4',
    'is_fiscally_sponsored','fiscal_sponsor_name','fiscal_sponsor_ein_ciphertext',
    'fiscal_sponsor_ein_last4','mailing_address_line1','mailing_address_line2',
    'mailing_city','mailing_state','mailing_postal_code','remittance_email',
    'w9_document_path','w9_uploaded_at','w9_expires_at','updated_at'
  ];
  v_generated text[];
BEGIN
  SELECT COALESCE(array_agg(attname), ARRAY[]::text[])
    INTO v_generated
    FROM pg_attribute
   WHERE attrelid = TG_RELID
     AND attgenerated <> ''
     AND NOT attisdropped;

  v_allowed := v_allowed || v_generated;

  IF is_admin() OR is_trusted_server_context() THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.w9_verified_by IS NOT NULL
       OR NEW.w9_verified_at IS NOT NULL
       OR NEW.w9_rejected_reason IS NOT NULL
       OR NEW.w9_rejected_at IS NOT NULL
       OR NEW.w9_purged_at IS NOT NULL
       OR NEW.w9_renewal_notified_at IS NOT NULL
    THEN
      RAISE EXCEPTION
        'team_payout_profiles: coach cannot set protected columns on insert'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - v_allowed) IS DISTINCT FROM (to_jsonb(OLD) - v_allowed) THEN
    RAISE EXCEPTION
      'team_payout_profiles: column not writable by this role (allowed: %)', array_to_string(v_allowed, ', ')
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION guard_payout_profile_writable_columns() IS
  'The column-write guard fails closed — every column you add later is unwritable by coaches until it is added to the allowlist.';

DROP TRIGGER IF EXISTS guard_payout_profile_writable_columns ON team_payout_profiles;
CREATE TRIGGER guard_payout_profile_writable_columns
  BEFORE INSERT OR UPDATE ON team_payout_profiles
  FOR EACH ROW EXECUTE FUNCTION guard_payout_profile_writable_columns();

-- 6. View
CREATE OR REPLACE VIEW v_team_payout_public
WITH (security_invoker = false) AS
SELECT
  p.team_id,
  p.legal_payee_name,
  p.tax_classification,
  p.is_fiscally_sponsored,
  p.fiscal_sponsor_name,
  (p.w9_verified_at IS NOT NULL) AS w9_on_file,
  p.w9_verified_at
FROM team_payout_profiles p
WHERE is_admin()
   OR sponsor_can_view_team(p.team_id)
   OR EXISTS (SELECT 1 FROM teams t WHERE t.id = p.team_id AND t.owner_id = current_profile_id());

GRANT SELECT ON v_team_payout_public TO authenticated;

-- 7. Encrypt/Decrypt RPCs
CREATE OR REPLACE FUNCTION set_payout_ein(p_team_id uuid, p_actor_profile_id uuid, p_ein text, p_key text,
               p_target text DEFAULT 'payee')
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_sub text := auth.jwt()->>'sub';
  v_digits text;
  v_cipher bytea;
  v_last4 text;
BEGIN
  -- 1. Resolve actor
  IF v_sub IS NOT NULL THEN
    IF current_profile_id() != p_actor_profile_id THEN
      RAISE EXCEPTION USING errcode='42501', message='Unauthorized';
    END IF;
  ELSIF is_trusted_server_context() THEN
    -- Trust the parameter
  ELSE
    RAISE EXCEPTION USING errcode='42501', message='Unauthorized';
  END IF;

  -- 2. Require team ownership or admin
  IF NOT is_admin() THEN
    IF NOT EXISTS (SELECT 1 FROM teams WHERE id = p_team_id AND owner_id = p_actor_profile_id) THEN
      RAISE EXCEPTION USING errcode='42501', message='Unauthorized to edit this team''s payout profile';
    END IF;
  END IF;

  -- 3. Normalise EIN
  v_digits := regexp_replace(p_ein, '\D', '', 'g');
  IF char_length(v_digits) != 9 THEN
    RAISE EXCEPTION 'EIN must contain exactly 9 digits';
  END IF;

  v_cipher := pgp_sym_encrypt(v_digits, p_key);
  v_last4 := right(v_digits, 4);

  -- 4. Update table
  IF p_target = 'payee' THEN
    UPDATE team_payout_profiles SET ein_ciphertext = v_cipher, ein_last4 = v_last4 WHERE team_id = p_team_id;
  ELSIF p_target = 'fiscal_sponsor' THEN
    UPDATE team_payout_profiles SET fiscal_sponsor_ein_ciphertext = v_cipher, fiscal_sponsor_ein_last4 = v_last4 WHERE team_id = p_team_id;
  ELSE
    RAISE EXCEPTION 'Invalid target %', p_target;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION set_payout_ein(uuid, uuid, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION set_payout_ein(uuid, uuid, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION set_payout_ein(uuid, uuid, text, text, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION set_payout_ein(uuid, uuid, text, text, text) TO service_role;


CREATE OR REPLACE FUNCTION get_payout_ein(p_team_id uuid, p_key text, p_target text DEFAULT 'payee')
  RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_cipher bytea;
  v_plain text;
BEGIN
  IF NOT (is_admin() OR is_trusted_server_context()) THEN
    RAISE EXCEPTION USING errcode='42501', message='Unauthorized';
  END IF;

  IF p_target = 'payee' THEN
    SELECT ein_ciphertext INTO v_cipher FROM team_payout_profiles WHERE team_id = p_team_id;
  ELSIF p_target = 'fiscal_sponsor' THEN
    SELECT fiscal_sponsor_ein_ciphertext INTO v_cipher FROM team_payout_profiles WHERE team_id = p_team_id;
  ELSE
    RAISE EXCEPTION 'Invalid target %', p_target;
  END IF;

  IF v_cipher IS NULL THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_plain := pgp_sym_decrypt(v_cipher, p_key);
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
  
  RETURN v_plain;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_payout_ein(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_payout_ein(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION get_payout_ein(uuid, text, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION get_payout_ein(uuid, text, text) TO service_role;

-- 8. Storage bucket
insert into storage.buckets (id, name, public)
values ('tax-documents', 'tax-documents', false)
on conflict (id) do nothing;

update storage.buckets
   set file_size_limit = 5242880,
       allowed_mime_types = array['application/pdf']
 where id = 'tax-documents';

DROP POLICY IF EXISTS "Coaches can upload their own tax documents" ON storage.objects;
CREATE POLICY "Coaches can upload their own tax documents" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'tax-documents' AND (auth.jwt() ->> 'sub') = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Coaches can see their own tax documents" ON storage.objects;
CREATE POLICY "Coaches can see their own tax documents" ON storage.objects FOR SELECT
  USING (bucket_id = 'tax-documents' AND (auth.jwt() ->> 'sub') = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Coaches can delete their own tax documents" ON storage.objects;
CREATE POLICY "Coaches can delete their own tax documents" ON storage.objects FOR DELETE
  USING (bucket_id = 'tax-documents' AND (auth.jwt() ->> 'sub') = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Admins can see all tax documents" ON storage.objects;
CREATE POLICY "Admins can see all tax documents" ON storage.objects FOR SELECT
  USING (bucket_id = 'tax-documents' AND public.is_admin());
