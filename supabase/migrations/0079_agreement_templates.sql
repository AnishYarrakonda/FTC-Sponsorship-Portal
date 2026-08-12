-- 0079_agreement_templates.sql
-- APPLY WITH: psql "$DATABASE_URL" -f supabase/migrations/0079_agreement_templates.sql
-- Contains $$-quoted blocks — the Supabase CLI splitter mishandles them. psql -f only.
-- Idempotent.
--
-- ⚠️ LEGAL REVIEW REQUIRED: the seeded document body at the bottom of this file is
-- unreviewed template copy drafted by an engineer, not legal advice and not a lawyer's
-- work product. It ships with needs_legal_review = true, which drives a persistent
-- warning banner in the admin UI. An attorney must review it and an admin must clear
-- the flag before this platform relies on it in a real transaction.

CREATE TABLE IF NOT EXISTS agreement_templates (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key                 text NOT NULL
                        CHECK (key IN ('sponsorship_agreement','platform_tos','team_participation')),
  version             integer NOT NULL CHECK (version >= 1),
  title               text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 200),
  body                text NOT NULL CHECK (length(body) BETWEEN 200 AND 60000),
  -- ESIGN/UETA consent disclosure shown at signing. Versioned WITH the document,
  -- because "what the signer agreed to" includes the consent language itself.
  consent_text        text NOT NULL CHECK (length(consent_text) BETWEEN 50 AND 4000),
  -- Merge-field keys the body references, extracted and validated at save time.
  merge_fields        text[] NOT NULL DEFAULT '{}',
  status              text NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','effective','retired')),
  needs_legal_review  boolean NOT NULL DEFAULT true,
  effective_from      timestamptz,
  retired_at          timestamptz,
  created_by          uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agreement_templates_key_version_unique UNIQUE (key, version),
  CONSTRAINT agreement_templates_effective_dated
    CHECK (status <> 'effective' OR effective_from IS NOT NULL),
  CONSTRAINT agreement_templates_retired_dated
    CHECK (status <> 'retired' OR retired_at IS NOT NULL)
);

ALTER TABLE agreement_templates ENABLE ROW LEVEL SECURITY;

-- At most one effective version per key, and at most one open draft per key.
CREATE UNIQUE INDEX IF NOT EXISTS agreement_templates_one_effective_per_key
  ON agreement_templates (key) WHERE status = 'effective';
CREATE UNIQUE INDEX IF NOT EXISTS agreement_templates_one_draft_per_key
  ON agreement_templates (key) WHERE status = 'draft';
CREATE INDEX IF NOT EXISTS agreement_templates_key_version_idx
  ON agreement_templates (key, version DESC);

-- Immutability once effective/retired — a BEFORE UPDATE trigger, not a policy,
-- because the admin client bypasses RLS entirely and this rule must hold against it too.
CREATE OR REPLACE FUNCTION guard_agreement_template_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status = 'draft' THEN
    -- Drafts are freely editable, including draft -> effective.
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- Effective / retired rows: only the retirement transition and the legal-review
  -- acknowledgement may change. Content is frozen. Edits must create a new version.
  IF NEW.key <> OLD.key
     OR NEW.version <> OLD.version
     OR NEW.title <> OLD.title
     OR NEW.body <> OLD.body
     OR NEW.consent_text <> OLD.consent_text
     OR NEW.merge_fields IS DISTINCT FROM OLD.merge_fields
     OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'agreement_template_immutable'
      USING HINT = 'This version is already effective. Create a new version instead.';
  END IF;

  IF OLD.status = 'retired' AND NEW.status <> 'retired' THEN
    RAISE EXCEPTION 'agreement_template_immutable'
      USING HINT = 'A retired version cannot be un-retired.';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_agreement_template_immutable ON agreement_templates;
CREATE TRIGGER trg_agreement_template_immutable
  BEFORE UPDATE ON agreement_templates
  FOR EACH ROW EXECUTE FUNCTION guard_agreement_template_immutable();

-- Delete guard — a draft may be discarded; an effective/retired version may never be
-- deleted. Prompt 06 adds an FK from agreement_signatures, but this rule is enforced
-- from day one rather than arriving with the FK.
CREATE OR REPLACE FUNCTION guard_agreement_template_no_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'agreement_template_immutable'
      USING HINT = 'Only a draft version may be deleted.';
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_agreement_template_no_delete ON agreement_templates;
CREATE TRIGGER trg_agreement_template_no_delete
  BEFORE DELETE ON agreement_templates
  FOR EACH ROW EXECUTE FUNCTION guard_agreement_template_no_delete();

REVOKE EXECUTE ON FUNCTION guard_agreement_template_immutable() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION guard_agreement_template_immutable() TO service_role;
REVOKE EXECUTE ON FUNCTION guard_agreement_template_no_delete() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION guard_agreement_template_no_delete() TO service_role;

-- RLS policies
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'agreement_templates' AND policyname = 'agreement_templates_select_admin'
  ) THEN
    CREATE POLICY agreement_templates_select_admin ON agreement_templates
      FOR SELECT USING (is_admin());
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'agreement_templates' AND policyname = 'agreement_templates_select_published'
  ) THEN
    CREATE POLICY agreement_templates_select_published ON agreement_templates
      FOR SELECT TO authenticated USING (status IN ('effective','retired'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'agreement_templates' AND policyname = 'agreement_templates_insert_admin'
  ) THEN
    CREATE POLICY agreement_templates_insert_admin ON agreement_templates
      FOR INSERT WITH CHECK (is_admin());
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'agreement_templates' AND policyname = 'agreement_templates_update_admin'
  ) THEN
    CREATE POLICY agreement_templates_update_admin ON agreement_templates
      FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'agreement_templates' AND policyname = 'agreement_templates_delete_admin_draft'
  ) THEN
    CREATE POLICY agreement_templates_delete_admin_draft ON agreement_templates
      FOR DELETE USING (is_admin() AND status = 'draft');
  END IF;
END $$;
-- No policy for anon. The public specimen page reads through the admin client with a
-- hard-coded status = 'effective' filter (house rule 9: route the crossing through the
-- admin client rather than loosening a policy).

-- Publish is not a plain UPDATE: the one-effective-per-key partial unique index means the
-- incumbent must be retired and the successor promoted inside one transaction.
CREATE OR REPLACE FUNCTION publish_agreement_version(
  p_template_id uuid,
  p_actor_profile_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_key text;
  v_version integer;
  v_prev_id uuid;
BEGIN
  -- Called with the ADMIN client, so there is no Clerk `sub` in the JWT. Re-verify the
  -- actor from the parameter — the RPC cannot rely on is_admin().
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = p_actor_profile_id AND role = 'admin'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  SELECT key, version INTO v_key, v_version
    FROM agreement_templates
   WHERE id = p_template_id AND status = 'draft'
   FOR UPDATE;

  IF v_key IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_a_draft');
  END IF;

  SELECT id INTO v_prev_id
    FROM agreement_templates
   WHERE key = v_key AND status = 'effective'
   FOR UPDATE;

  IF v_prev_id IS NOT NULL THEN
    UPDATE agreement_templates
       SET status = 'retired', retired_at = now()
     WHERE id = v_prev_id;
  END IF;

  UPDATE agreement_templates
     SET status = 'effective', effective_from = now()
   WHERE id = p_template_id;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    p_actor_profile_id, 'agreement_template_published', 'agreement_templates', p_template_id,
    jsonb_build_object('key', v_key, 'version', v_version, 'retired_id', v_prev_id)
  );

  RETURN jsonb_build_object(
    'ok', true, 'key', v_key, 'version', v_version, 'retired_id', v_prev_id
  );
END $$;

REVOKE EXECUTE ON FUNCTION publish_agreement_version(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION publish_agreement_version(uuid, uuid) TO service_role;

-- Seed: Sponsorship Agreement v1 (template copy — ATTORNEY REVIEW REQUIRED).
-- Only ever seeds once: guarded on "no row exists for this key at all" rather than
-- "no effective row", so a replay after v1 has been retired by a real v2 does not
-- resurrect a stray v1.
INSERT INTO agreement_templates (
  key, version, title, body, consent_text, merge_fields, status, needs_legal_review, effective_from, created_by
)
SELECT
  'sponsorship_agreement',
  1,
  'FTC Team Sponsorship Agreement',
  $body$<h2>1. Parties and Effective Date</h2>
<p>
This Sponsorship Agreement ("Agreement") is entered into between {{ sponsor_company_name }}
("Sponsor") and {{ team_legal_payee_name }}, acting on behalf of FIRST Tech Challenge Team
{{ team_number }} ({{ team_name }}) of {{ team_organization }}, {{ team_city }}, {{ team_state }}
("Team"), effective {{ agreement_date }} ("Effective Date").
</p>

<h2>2. The Commitment</h2>
<p>
Sponsor commits to provide {{ amount_formatted }} in support of the Team for the
{{ season }} competition season ("Commitment").
</p>

<h2>3. Payment Terms</h2>
<p>
Payment of the Commitment is made directly by Sponsor to {{ team_legal_payee_name }} within
thirty (30) days of the Effective Date, by a method agreed between the parties. The Team will
supply Sponsor with a completed IRS Form W-9 and remittance details prior to payment.
</p>

<h2>4. The Platform's Role</h2>
<p>
{{ platform_name }} is a facilitator and recordkeeper only. {{ platform_name }} is not a party
to this Agreement, does not receive, hold, or transmit the funds described in Section 2, and has
no payment obligation to either party under this Agreement.
</p>

<h2>5. Recognition</h2>
<p>
In recognition of the Commitment, the Team will provide Sponsor with logo placement on the
robot and team materials, named acknowledgement in Team outreach, and an end-of-season impact
summary. Fulfillment of this Section is the Team's obligation, not {{ platform_name }}'s.
</p>

<h2>6. Use of Funds</h2>
<p>
Funds provided under this Agreement are restricted to Team operating expenses, including parts,
tooling, competition registration, travel, and outreach. Funds may not be used for individual
compensation. The Team will keep records of its use of funds for the season and provide a
summary to Sponsor on request.
</p>

<h2>7. Misuse of Funds</h2>
<p>
If Sponsor reasonably believes funds have been used in a manner inconsistent with Section 6,
Sponsor's remedy is written notice to the Team, followed by a thirty (30) day cure period, after
which Sponsor may request a refund of the unspent balance. {{ platform_name }}'s only role in
such a dispute is to record it; {{ platform_name }} is not an arbitrator of the dispute, owes no
refund to either party, and may suspend the Team's platform account pending resolution.
</p>

<h2>8. Term and Termination</h2>
<p>
This Agreement runs through the end of the {{ season }} season. Either party may terminate this
Agreement for material breach on thirty (30) days' written notice to the other party. Obligations
that have already accrued as of termination survive termination.
</p>

<h2>9. No Employment, Partnership, or Joint Venture</h2>
<p>
Nothing in this Agreement creates an employment relationship, partnership, or joint venture
between Sponsor and Team, and neither party has exclusivity with the other unless separately
agreed in writing.
</p>

<h2>10. Limitation of Liability</h2>
<p>
Each party's liability under this Agreement is capped at the amount of the Commitment.
{{ platform_name }}'s liability to either party under or in connection with this Agreement is
expressly excluded, consistent with Section 4.
</p>

<h2>11. Governing Law</h2>
<p>TODO(legal): jurisdiction to be set by counsel.</p>

<h2>12. Entire Agreement</h2>
<p>
This Agreement is the entire agreement between the parties regarding the Commitment and
supersedes all prior discussions on the subject. It may be amended only in writing signed by
both parties, may be executed in counterparts, and may be executed by electronic signature.
</p>

<h2>13. Signatures</h2>
<table>
<thead><tr><th>Sponsor</th><th>Team</th></tr></thead>
<tbody>
<tr><td>Printed Name: {{ sponsor_contact_name }}</td><td>Printed Name: ______________________</td></tr>
<tr><td>Title: ______________________</td><td>Title: ______________________</td></tr>
<tr><td>Date: {{ agreement_date }}</td><td>Date: ______________________</td></tr>
</tbody>
</table>$body$,
  'By typing your name below and clicking "Sign," you consent to conduct this transaction '
  || 'electronically and agree that your typed name constitutes your legal signature on this '
  || 'document, binding to the same extent as a handwritten signature, under the U.S. Electronic '
  || 'Signatures in Global and National Commerce Act (ESIGN) and applicable state UETA law. You '
  || 'may request a copy of any document you sign through the platform, and you may withdraw '
  || 'consent to transact electronically prospectively by contacting the platform.',
  ARRAY[
    'sponsor_company_name','team_legal_payee_name','team_number','team_name','team_organization',
    'team_city','team_state','agreement_date','amount_formatted','season','platform_name',
    'sponsor_contact_name'
  ],
  'effective',
  true,
  now(),
  NULL
WHERE NOT EXISTS (SELECT 1 FROM agreement_templates WHERE key = 'sponsorship_agreement');

-- VERIFICATION (run manually after applying; not executed by this migration):
--
-- As a coach (their own Clerk JWT): PATCH .../agreement_templates?id=eq.<id>            -> 0 rows
-- As anon:                          GET   .../agreement_templates?select=*              -> []
-- As a signed-in non-admin:         effective row visible, draft row is not
-- As service_role:
--   UPDATE agreement_templates SET body='x' WHERE status='effective';
--     -> ERROR: agreement_template_immutable
--   DELETE FROM agreement_templates WHERE status='effective';
--     -> ERROR: agreement_template_immutable
--   INSERT a second status='effective' row for the same key -> unique index violation
-- SELECT publish_agreement_version('<draft-id>', '<coach-profile-id>');
--   -> {"ok":false,"error":"unauthorized"}
-- Replay this whole file a second time with psql -f -> must succeed.
