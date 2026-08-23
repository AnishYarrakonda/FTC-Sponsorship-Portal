-- 0104_override_reason_survives_actor_deletion.sql
--
-- NOT from the audit pack. Found while proving A-01-02: deleting an admin profile on the
-- local stack failed with 23514, but on `override_requires_reason` rather than on the
-- super-admin floor.
--
-- team_verification_records.overridden_by is `ON DELETE SET NULL`, while the CHECK insists
-- it is NOT NULL whenever outcome = 'overridden'. Those two rules contradict each other:
-- the moment an admin who has ever overridden a team verification is deleted, the cascade
-- sets the column NULL and the CHECK refuses the delete.
--
-- The consequence is the same failure A-01-02 describes, on a much more common actor:
-- the Clerk user.deleted webhook has already irrecoverably purged that person's uploaded
-- files, the profiles DELETE then fails permanently, the handler returns 500, and Svix
-- retries a delete that can never succeed. "Delete my account" destroys the files and
-- leaves the row.
--
-- The constraint's actual purpose is that an override must STATE A REASON. It does that
-- with override_reason alone. Requiring the actor FK to stay populated made the actor
-- undeletable, which is not a property a platform handling government IDs can afford --
-- and the actor's identity is not lost: the override is recorded in audit_log with
-- actor_id, which is exactly what audit_log is for.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS + ADD.

ALTER TABLE public.team_verification_records
  DROP CONSTRAINT IF EXISTS override_requires_reason;

ALTER TABLE public.team_verification_records
  ADD CONSTRAINT override_requires_reason
  CHECK ((outcome <> 'overridden') OR (override_reason IS NOT NULL));
