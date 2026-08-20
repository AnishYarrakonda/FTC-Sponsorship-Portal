-- 0092_agreement_template_author_deletion.sql
--
-- Fixes: deleting the profile that published an agreement template was impossible.
--
-- `agreement_templates.created_by` is `REFERENCES profiles(id) ON DELETE SET NULL`, so
-- removing an author makes Postgres UPDATE the template row and set that column to NULL.
-- `guard_agreement_template_immutable` (0079) then rejected the update, because its content
-- freeze listed `created_by` alongside title/body/consent_text:
--
--     OR NEW.created_by IS DISTINCT FROM OLD.created_by
--
-- The DELETE failed with `agreement_template_immutable`. Consequences:
--   * an admin who ever published a template could never be deleted — including through the
--     account-deletion path the privacy policy promises
--   * scripts/seed-test-accounts.mjs could not wipe `profiles`, so every re-run silently
--     added a second copy of every test account
--
-- The fix keeps the content freeze exactly as it was and carves out precisely one
-- transition: `created_by` may go to NULL, and only to NULL. Re-pointing it at a different
-- author is still refused, so provenance cannot be rewritten — it can only be forgotten,
-- which is what ON DELETE SET NULL means.

CREATE OR REPLACE FUNCTION guard_agreement_template_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'draft' THEN
    -- Drafts are freely editable, including draft -> effective.
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- Effective / retired rows: only the retirement transition, the legal-review
  -- acknowledgement, and the author FK being nulled by a profile deletion may change.
  -- Content is frozen. Edits must create a new version.
  IF NEW.key <> OLD.key
     OR NEW.version <> OLD.version
     OR NEW.title <> OLD.title
     OR NEW.body <> OLD.body
     OR NEW.consent_text <> OLD.consent_text
     OR NEW.merge_fields IS DISTINCT FROM OLD.merge_fields
     OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'agreement_template_immutable'
      USING HINT = 'This version is already effective. Create a new version instead.';
  END IF;

  -- created_by may only be cleared (the ON DELETE SET NULL path), never reassigned.
  IF NEW.created_by IS DISTINCT FROM OLD.created_by AND NEW.created_by IS NOT NULL THEN
    RAISE EXCEPTION 'agreement_template_immutable'
      USING HINT = 'The recorded author of an effective version cannot be changed.';
  END IF;

  IF OLD.status = 'retired' AND NEW.status <> 'retired' THEN
    RAISE EXCEPTION 'agreement_template_immutable'
      USING HINT = 'A retired version cannot be un-retired.';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END
$$;
