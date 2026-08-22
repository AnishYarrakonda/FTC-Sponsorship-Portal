# Prompt 06 — In-House E-Signature Capture & the Agreement Gate

> **Prerequisites:** 05 (agreement templates), 01 (funding fulfillment state machine)
> **Reserved migration:** `0080_agreement_signatures.sql` — verify it is still free with `ls supabase/migrations | tail -3`
> **Scope:** large · ~24 files
> **Leaves the repo:** green and shippable on its own

## Why this exists

Prompt 05 produced a document. A corporate legal team's next question is *"show me the executed
copy and prove who signed it."* ESIGN and UETA make a typed name binding only if you can evidence
intent to sign, attribution to a person, and the integrity of the record — the exact bytes that
person saw. Without that evidence a signature is a database row someone can dispute. This slice
captures it, stores the executed document immutably, and makes the signature a **hard prerequisite**
for a fulfillment leaving `pledged` — enforced in Postgres, not in a React component.

## Current state (verified)

**What exists after prompts 05 and 01:**
- `agreement_templates` (0079) with `key`, `version`, `title`, `body`, `consent_text`,
  `merge_fields`, `status IN ('draft','effective','retired')`, immutable once effective.
- `lib/agreements/merge-fields.ts`, `lib/agreements/render.ts` (deterministic renderer,
  `MissingMergeFieldError` / `UnknownMergeFieldError`), `lib/agreements/diff.ts`.
- Prompt 01's fulfillment state machine at `supabase/migrations/0076_*.sql`.

**Before writing a line of SQL, open `supabase/migrations/0076_*.sql` and read it in full.** This
prompt assumes prompt 01 shipped a fulfillment table with a `pledged → agreement_signed →
payment_sent → …` status progression and a SECURITY DEFINER transition RPC. **Use the real table,
column, status, and function names from that file — do not use the placeholder names below if they
differ.** If prompt 01 modelled the machine in a way that makes an `agreement_signed` state
meaningless (for example, if it has no `pledged` state at all), **stop and ask** rather than
inventing a shape. Throughout this document, `<FULFILLMENTS>` means prompt 01's fulfillment table
and `<ADVANCE_RPC>` means its transition function.

**Verified facts about the surrounding code (read these files):**
- Auth guards in `lib/actions-utils.ts`: `requireAuth()` / `requireSponsor()` /
  `requireVerifiedCoach()` return the `profiles` row as `user` (so `user.id` is the profile uuid)
  plus `clerkUserId`. `getClientIp()` reads the first hop of `x-forwarded-for`, else `'unknown'`.
- `requireSponsor()` additionally returns `sponsorId` (`profiles.sponsor_id`) and `adminClient`.
- Existing private-bucket precedent: `coach-credentials` (bucket created in
  `supabase/migrations/0002_storage.sql`, its policies rewritten for Clerk in
  `supabase/migrations/0051_clerk_auth.sql:298-320` — `(auth.jwt() ->> 'sub') = (storage.foldername(name))[1]`;
  size/MIME caps set in `supabase/migrations/0048_storage_limits.sql`). Note that `0002_storage.sql`
  and `0048_storage_limits.sql` still contain the **superseded** `auth.uid()` form — 0051 is the
  live version. Do not copy from 0002 or 0048.
- Signed-URL precedent: `app/(admin)/coaches/page.tsx:40` — `.createSignedUrl(path, 1800)`.
- Server-side upload precedent (validated, admin-client write, timestamped path):
  `app/actions/credentials.ts`.
- `lib/notify.ts` → `createInAppNotification({ recipientId, type, title, body?, submissionId?, skipEmail? })`.
  `type` is constrained by a CHECK to
  `submission_declined | submission_approved | submission_changes_requested | coach_verified | general`.
  **There is no signature-specific type and this slice does not add one** — use `'general'`.
- Sponsor submission detail route: `app/(sponsor)/sponsor/submissions/[id]/`.
  Coach submission detail route: `app/(coach)/submissions/[id]/`.
- `app/(account)/layout.tsx` redirects verified coaches to `/dashboard?tab=settings` and active
  sponsors to `/sponsor/settings`, so the `(account)` group is **not** a valid host for a shared
  page. Top-level authenticated routes are the existing convention (`app/legal`, `app/sponsors`,
  `app/sponsor-view`).
- `middleware.ts` `isPublicRoute` list — `/agreements(.*)` must **not** be added to it.

**What is missing:** everything below.

## What you are building

1. Migration `0080_agreement_signatures.sql`: the append-only `agreement_signatures` table with RLS,
   the private `executed-agreements` bucket with Clerk-partitioned policies, the
   `sign_agreement_atomic()` RPC, the `agreement_is_signed()` guard, the patched `<ADVANCE_RPC>`,
   and a belt-and-braces trigger on `<FULFILLMENTS>`.
2. `lib/agreements/provider.ts` — the narrow `SignatureProvider` interface.
3. `lib/agreements/in-house-provider.ts` — the only concrete implementation.
4. `lib/agreements/context.ts` — builds a `MergeContext` from a submission.
5. `lib/schemas/agreement-signature.ts` — Zod schemas.
6. `app/actions/agreements-sign.ts` — `prepareAgreementForSigning`, `signAgreement`,
   `getExecutedAgreement`.
7. Signing UI for sponsor and coach, plus a shared signing component.
8. `/agreements/[signatureId]` — the verification page with the full audit trail.
9. Fixture updates for all three preview modes.

## Data model

### DDL

```sql
-- 0080_agreement_signatures.sql
-- APPLY WITH: psql "$DATABASE_URL" -f supabase/migrations/0080_agreement_signatures.sql
-- Contains $$-quoted blocks — psql -f only, never the Supabase CLI splitter.
-- Idempotent.
--
-- APPEND-ONLY. This table is an ESIGN/UETA business record. There is no UPDATE policy
-- and no DELETE policy, for any role, deliberately.

CREATE TABLE IF NOT EXISTS agreement_signatures (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Pins the EXACT version signed. RESTRICT would block template cleanup and, worse,
  -- 05's delete-guard already forbids deleting a non-draft, so RESTRICT adds nothing.
  template_id           uuid REFERENCES agreement_templates(id) ON DELETE RESTRICT,
  template_key          text    NOT NULL,
  template_version      integer NOT NULL,

  -- Signer. SET NULL, not RESTRICT: a Clerk `user.deleted` webhook cascades through
  -- profiles and runs no app code, so RESTRICT would wedge account deletion. The
  -- denormalised columns below are what keep the record standing on its own.
  signer_profile_id     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  signer_role           text NOT NULL CHECK (signer_role IN ('sponsor','coach')),
  signer_legal_name     text NOT NULL,
  signer_email          text NOT NULL,

  -- Bound entities. All SET NULL for the same reason; entity_snapshot preserves the facts.
  submission_id         uuid REFERENCES submissions(id) ON DELETE SET NULL,
  sponsor_id            uuid REFERENCES sponsors(id)    ON DELETE SET NULL,
  team_id               uuid REFERENCES teams(id)       ON DELETE SET NULL,
  entity_snapshot       jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- The ESIGN evidence.
  typed_name            text NOT NULL CHECK (length(btrim(typed_name)) BETWEEN 2 AND 200),
  signed_at             timestamptz NOT NULL DEFAULT now(),
  ip_address            text NOT NULL,
  user_agent            text NOT NULL,
  document_hash         text NOT NULL CHECK (document_hash ~ '^[0-9a-f]{64}$'),
  document_storage_path text NOT NULL,
  consent_text_version  integer NOT NULL,
  consent_text_hash     text NOT NULL CHECK (consent_text_hash ~ '^[0-9a-f]{64}$'),

  created_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE agreement_signatures ENABLE ROW LEVEL SECURITY;

-- One signature per role per submission. Partial, because submission_id becomes NULL
-- if the submission is ever deleted and NULLs must not collide.
CREATE UNIQUE INDEX IF NOT EXISTS agreement_signatures_one_per_role_per_submission
  ON agreement_signatures (submission_id, signer_role)
  WHERE submission_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS agreement_signatures_signer_idx    ON agreement_signatures (signer_profile_id);
CREATE INDEX IF NOT EXISTS agreement_signatures_sponsor_idx   ON agreement_signatures (sponsor_id);
CREATE INDEX IF NOT EXISTS agreement_signatures_team_idx      ON agreement_signatures (team_id);
CREATE INDEX IF NOT EXISTS agreement_signatures_hash_idx      ON agreement_signatures (document_hash);
```

> **Trap — do not add a `CHECK (submission_id IS NOT NULL OR sponsor_id IS NOT NULL OR team_id IS
> NOT NULL)`.** CHECK constraints are re-evaluated on UPDATE, and an `ON DELETE SET NULL` cascade
> *is* an UPDATE. The last cascade would violate the CHECK and abort the parent delete — silently
> converting SET NULL back into RESTRICT and breaking the Clerk deletion webhook. Enforce the
> at-least-one-entity rule inside `sign_agreement_atomic()` instead, where it belongs.

Add an append-only guard as a trigger as well as by policy absence, because every write in this
codebase can reach the DB through the service-role client, which ignores RLS:

```sql
CREATE OR REPLACE FUNCTION guard_agreement_signature_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'agreement_signature_immutable'
      USING HINT = 'Executed signatures are an ESIGN business record and cannot be deleted.';
  END IF;
  -- Allow ONLY the FK SET NULL cascades to land. Everything else is frozen.
  IF NEW.typed_name        <> OLD.typed_name
     OR NEW.signed_at      <> OLD.signed_at
     OR NEW.ip_address     <> OLD.ip_address
     OR NEW.user_agent     <> OLD.user_agent
     OR NEW.document_hash  <> OLD.document_hash
     OR NEW.document_storage_path <> OLD.document_storage_path
     OR NEW.consent_text_hash     <> OLD.consent_text_hash
     OR NEW.signer_legal_name     <> OLD.signer_legal_name
     OR NEW.signer_email          <> OLD.signer_email
     OR NEW.template_version      <> OLD.template_version
     OR NEW.entity_snapshot IS DISTINCT FROM OLD.entity_snapshot THEN
    RAISE EXCEPTION 'agreement_signature_immutable';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_agreement_signature_append_only ON agreement_signatures;
CREATE TRIGGER trg_agreement_signature_append_only
  BEFORE UPDATE OR DELETE ON agreement_signatures
  FOR EACH ROW EXECUTE FUNCTION guard_agreement_signature_append_only();

REVOKE EXECUTE ON FUNCTION guard_agreement_signature_append_only() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION guard_agreement_signature_append_only() TO service_role;
```

### RLS policies (one bullet per policy)

- `agreement_signatures_select_own` — `FOR SELECT USING (signer_profile_id = current_profile_id())`.
  A signer always reads their own signatures.
- `agreement_signatures_select_admin` — `FOR SELECT USING (is_admin())`.
- `agreement_signatures_select_sponsor` — `FOR SELECT USING (sponsor_id IS NOT NULL AND EXISTS
  (SELECT 1 FROM profiles p WHERE p.id = current_profile_id() AND p.role = 'sponsor'
  AND p.sponsor_id IS NOT NULL AND p.sponsor_id = agreement_signatures.sponsor_id))`.
  This is the exact shape of `ledger_select_sponsor` in
  `supabase/migrations/0069_ledger_sponsor_and_coach_read.sql` — a sponsor sees the coach's
  countersignature on their own agreement, and no other sponsor's book.
- `agreement_signatures_select_coach` — `FOR SELECT USING (team_id IS NOT NULL AND EXISTS
  (SELECT 1 FROM teams t WHERE t.id = agreement_signatures.team_id AND t.owner_id = current_profile_id()))`.
  Mirrors `ledger_select_coach`. **This sublink on `teams` is only safe while every policy on
  `teams` stays sublink-free** (0066 wraps the sponsor predicate in `sponsor_can_view_team()`); an
  inline sublink there gives 42P17 on every read here. Repeat that note in the migration.
- **No INSERT policy. No UPDATE policy. No DELETE policy. For any role.** Inserts happen only
  through `sign_agreement_atomic()`, which is SECURITY DEFINER and granted to `service_role` alone.

### Storage bucket

```sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('executed-agreements', 'executed-agreements', false)
ON CONFLICT (id) DO NOTHING;

UPDATE storage.buckets
   SET file_size_limit = 5242880,               -- 5 MB, matching coach-credentials
       allowed_mime_types = array['text/html']  -- HTML only in this slice; no PDF generation
 WHERE id = 'executed-agreements';
```

Policies, folder-partitioned by **Clerk user id** exactly like `coach-credentials` in
`0051_clerk_auth.sql`:

- `executed_agreements_select_own` — `FOR SELECT USING (bucket_id = 'executed-agreements' AND (auth.jwt() ->> 'sub') = (storage.foldername(name))[1])`.
- `executed_agreements_select_admin` — `FOR SELECT USING (bucket_id = 'executed-agreements' AND is_admin())`.
- **No INSERT, UPDATE, or DELETE policy.** Every write goes through the admin client inside the
  provider. A signer cannot upload or overwrite their own executed document.

Path layout: `{clerk_user_id}/{submission_id}/{template_key}-v{version}-{role}-{unix_ms}.html`.
The prepared (pre-signature) render lives at
`{clerk_user_id}/{submission_id}/prepared-{sha256}.html` and is the **source of truth for the bytes
displayed** — see "How the hash stays honest" below.

### RPC signatures

```sql
-- Writes the signature and, when both parties have signed, advances the fulfillment.
CREATE OR REPLACE FUNCTION sign_agreement_atomic(
  p_template_id           uuid,
  p_signer_profile_id     uuid,
  p_signer_role           text,
  p_submission_id         uuid,
  p_typed_name            text,
  p_ip                    text,
  p_user_agent            text,
  p_document_hash         text,
  p_document_storage_path text,
  p_consent_text_hash     text,
  p_entity_snapshot       jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$ … $$;

REVOKE EXECUTE ON FUNCTION sign_agreement_atomic(uuid,uuid,text,uuid,text,text,text,text,text,text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION sign_agreement_atomic(uuid,uuid,text,uuid,text,text,text,text,text,text,jsonb)
  TO service_role;
```

Body, in order — every step is required:

1. **Re-verify the actor from `p_signer_profile_id`.** The action calls this through the admin
   client, so there is no Clerk `sub` and `current_profile_id()` / `is_admin()` are useless inside.
   Load the profile; if it does not exist → `{ok:false,error:'unauthorized'}`.
2. Load the template. Must be `status = 'effective'`, else `{ok:false,error:'template_not_effective'}`.
   (A version retired between prepare and submit means the signer is looking at a stale document.)
3. `SELECT … FROM submissions WHERE id = p_submission_id FOR UPDATE`. Missing →
   `{ok:false,error:'submission_not_found'}`. Resolve `team_id` and `sponsor_id` **from the
   submission row**, never from a parameter.
4. **Entitlement.** `p_signer_role = 'sponsor'` → the profile's `role = 'sponsor'` and
   `sponsor_id = submissions.sponsor_id`. `p_signer_role = 'coach'` → the profile owns
   `submissions.team_id` (`teams.owner_id = p_signer_profile_id`) and `coach_verified = true`.
   Otherwise `{ok:false,error:'unauthorized'}`.
5. **Ordering.** A coach may not countersign before the sponsor has signed →
   `{ok:false,error:'awaiting_sponsor_signature'}`.
6. Already signed for this `(submission_id, signer_role)` → `{ok:false,error:'already_signed'}`
   (also caught by the unique index; return the friendly code rather than a 23505).
7. Denormalise `signer_legal_name` from `profiles.full_name` and `signer_email` from
   `profiles.email`; reject if `full_name` is null/blank → `{ok:false,error:'profile_incomplete'}`.
8. Enforce the at-least-one-entity rule that the CHECK constraint deliberately does not.
9. `INSERT` the row.
10. If both `'sponsor'` and `'coach'` rows now exist for this submission, call prompt 01's
    `<ADVANCE_RPC>` (or perform its `pledged → agreement_signed` transition inline if 01 exposed a
    plain UPDATE) inside the same transaction. Surface a failed transition as
    `{ok:false,error:'fulfillment_transition_failed'}` and let the whole transaction roll back —
    **never** leave a signature recorded against a fulfillment that did not advance.
11. Return `{ok:true, signature_id, all_signed: boolean, fulfillment_status}`.

### The gate

```sql
CREATE OR REPLACE FUNCTION agreement_is_signed(p_submission_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM agreement_signatures s
                  WHERE s.submission_id = p_submission_id AND s.signer_role = 'sponsor')
     AND EXISTS (SELECT 1 FROM agreement_signatures s
                  WHERE s.submission_id = p_submission_id AND s.signer_role = 'coach');
$$;

REVOKE EXECUTE ON FUNCTION agreement_is_signed(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION agreement_is_signed(uuid) TO service_role;
```

The gate is enforced in **two** places in the database, and nowhere else is authoritative:

1. **Inside `<ADVANCE_RPC>`.** `CREATE OR REPLACE` prompt 01's transition function in this migration.
   Open `supabase/migrations/0076_*.sql`, copy the current body **verbatim**, and insert, at the top
   of the branch that moves a fulfillment into `payment_sent`:
   ```sql
   IF NOT agreement_is_signed(v_submission_id) THEN
     RETURN jsonb_build_object('ok', false, 'error', 'agreement_not_signed');
   END IF;
   ```
   Re-apply prompt 01's own REVOKE/GRANT lines after the `CREATE OR REPLACE` — replacing a function
   does not restore grants you did not re-issue, and a missed `REVOKE … FROM PUBLIC` here re-opens
   the money path to every authenticated user.
2. **A BEFORE UPDATE trigger on `<FULFILLMENTS>`**, so the rule survives a direct service-role
   `UPDATE` that bypasses the RPC entirely:
   ```sql
   CREATE OR REPLACE FUNCTION guard_fulfillment_requires_signed_agreement()
   RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
   BEGIN
     IF NEW.status = 'payment_sent' AND OLD.status IS DISTINCT FROM NEW.status THEN
       IF NOT agreement_is_signed(NEW.submission_id) THEN
         RAISE EXCEPTION 'agreement_not_signed'
           USING HINT = 'Both parties must execute the sponsorship agreement first.';
       END IF;
     END IF;
     RETURN NEW;
   END $$;
   ```
   Attach it as `BEFORE UPDATE ON <FULFILLMENTS>` and apply the REVOKE/GRANT pair. Substitute
   prompt 01's real status value and submission column name.

The UI must also hide and disable the "Mark payment sent" control until both signatures exist — but
treat that purely as courtesy. The database is the gate.

### Countersignature — decided

- **The sponsor signs first.** They are the committing party, and the signing step immediately
  follows their funding decision.
- **The coach countersigns.** The team is accepting restricted funds and use-of-funds obligations
  under Article 6 of the seeded agreement; a one-sided instrument does not bind them to it.
  `agreement_signed` requires **both**.
- **The platform does not sign, and no admin countersigns.** Article 4 of the agreement says the
  platform is not a party. A platform signature block would contradict the single most important
  clause in the document. `signer_role` is therefore `CHECK (signer_role IN ('sponsor','coach'))` —
  do not add a `'platform'` value "for later"; an unused enum value in a legal-record table invites
  someone to start writing it.
- Admins never sign on anyone's behalf. Admin capability here is read-only: view any executed
  document and its audit trail.

## How the hash stays honest

The hash must cover the exact bytes the signer saw, and the signer sees them at page load while the
signature arrives on a later request. The resolution:

1. **`prepare`** builds the `MergeContext` (including a pinned `agreement_date`), calls
   `renderAgreement`, computes `sha256(html)` with node `crypto`, and **writes those bytes to
   storage immediately** at `{clerk}/{submission}/prepared-{sha256}.html`. It returns the html, the
   hash, and the consent text. Storage is now the record of what was displayed.
2. The page renders that exact html and echoes the hash into a hidden field.
3. **`capture`** re-reads the prepared object from storage by the client-supplied hash, recomputes
   the sha256 of the downloaded bytes, and requires all three to agree (client-supplied hash =
   stored path = recomputed digest). Mismatch → `document_changed`, tell the user to reload.
4. `capture` also re-checks that the template version it prepared against is still `effective`.
   Changed → `template_changed`.
5. Only then does it copy the object to the executed path and call `sign_agreement_atomic`.

Consequences: no HMAC, no new env var, no new table, and no trust placed in a client-supplied
document body. `renderAgreement`'s determinism (prompt 05) is what makes step 3 reliable — if it
ever becomes non-deterministic, this whole scheme fails open in the confusing direction, which is
why prompt 05 has a determinism test.

Consent capture: `consent_text` comes from the pinned template version; store
`consent_text_version = template.version` and `consent_text_hash = sha256(consent_text)`. Store the
consent text itself nowhere new — it lives, immutably, on the template row.

## Provider interface

`lib/agreements/provider.ts` — deliberately narrow, three methods, no vendor concepts leaking in:

```ts
export interface PrepareInput  { submissionId: string; signerRole: 'sponsor' | 'coach'; signerProfileId: string; clerkUserId: string }
export interface PreparedDocument {
  templateId: string; templateKey: string; templateVersion: number
  title: string; html: string; sha256: string; preparedStoragePath: string
  consentText: string; consentTextHash: string
  expectedSignerName: string
}
export interface CaptureInput {
  submissionId: string; signerRole: 'sponsor' | 'coach'; signerProfileId: string; clerkUserId: string
  documentHash: string; typedName: string; ipAddress: string; userAgent: string
}
export interface SignatureCapture { signatureId: string; signedAt: string; documentHash: string; storagePath: string; allSigned: boolean }
export interface RetrievedSignature {
  signatureId: string; templateKey: string; templateVersion: number
  signerRole: 'sponsor' | 'coach'; signerLegalName: string; signerEmail: string
  typedName: string; signedAt: string; ipAddress: string; userAgent: string
  documentHash: string; documentUrl: string   // short-lived signed URL
}

export interface SignatureProvider {
  prepare(input: PrepareInput): Promise<PreparedDocument>
  capture(input: CaptureInput): Promise<SignatureCapture>
  retrieve(signatureId: string, requesterProfileId: string): Promise<RetrievedSignature>
}
```

`lib/agreements/in-house-provider.ts` exports `class InHouseSignatureProvider implements
SignatureProvider` and `export const signatureProvider: SignatureProvider = new InHouseSignatureProvider()`.
Server actions import only `signatureProvider` and the interface types — **never the concrete
class**, so a vendor swap is one new file plus one changed export. Add a header comment saying
exactly that. Do not build a plugin registry, a factory, or an env-var-selected provider; there is
one implementation and speculative indirection is worse than none.

## Server actions

`app/actions/agreements-sign.ts`, canonical 5-step shape. Schemas in
`lib/schemas/agreement-signature.ts` (add `typedName: 200` to `lib/schemas/limits.ts` only if a new
constant is genuinely needed — `LIMITS.fullName` is already 200 and is the right constant here).

| Action | Signature | Guard | Audit action | Notification |
|---|---|---|---|---|
| `prepareAgreementForSigning` | `({ submissionId }) => { document?: PreparedDocumentDTO; alreadySigned?: true; error?: string }` | `requireAuth()` + role branch | none (read) | none |
| `signAgreement` | `({ submissionId, documentHash, typedName, consentAccepted }) => { success?: true; signatureId?: string; allSigned?: boolean; error?: string }` | `requireAuth()` + role branch | `agreement_signed` | see below |
| `getExecutedAgreement` | `({ signatureId }) => { signature?: RetrievedSignature; error?: string }` | `requireAuth()` | `agreement_document_retrieved` | none |

- **Role branch:** resolve `'sponsor'` vs `'coach'` from `user.role` after `requireAuth()`, then let
  the RPC do the real entitlement check. Do not call `requireSponsor()` / `requireVerifiedCoach()`
  at the top — one action serves both roles and you would need to try/catch both. Reject
  `user.role === 'admin'` with "Administrators cannot sign on behalf of a party."
- **`signAgreement` validation:** Zod `safeParse` on
  `{ submissionId: z.uuid(), documentHash: z.string().regex(/^[0-9a-f]{64}$/), typedName: z.string().trim().min(2).max(LIMITS.fullName), consentAccepted: z.literal(true) }`.
  `consentAccepted: z.literal(true)` means an unchecked box is a validation failure, not a runtime
  `if`.
- **Typed-name match:** compare `typedName` to `profiles.full_name` case-insensitively after
  collapsing internal whitespace and stripping trailing periods. Mismatch →
  "The typed name must match the name on your account (`{full_name}`)." Do the comparison in the
  action so the message can name the expected value; the RPC stores whatever it is given.
- `ipAddress` from `getClientIp()`; `userAgent` from `(await headers()).get('user-agent') ?? 'unknown'`.
  Truncate the UA to 512 chars. **Never** accept either from the client.
- **Audit** via `adminClient` (get it from `createAdminClient()`; `requireAuth()` does not return
  one): `{ actor_id: user.id, action: 'agreement_signed', entity_type: 'agreement_signatures',
  entity_id: signatureId, metadata: { submission_id, template_key, template_version, signer_role,
  document_hash, all_signed } }`. Do not put the IP in `metadata` — it is already a first-class
  column on the signature row and duplicating PII into a jsonb blob makes retention harder.
- **Notify** with `createInAppNotification`, `type: 'general'`, `submissionId` set:
  - sponsor signed → notify the team owner: "Sign your sponsorship agreement" with the
    `/submissions/{id}/sign` path in the body.
  - coach countersigned → notify the sponsor contact profile: "{Team} countersigned — agreement
    fully executed".
  - Leave `skipEmail` at its default `false`; there is no richer dedicated template in this slice,
    and both parties genuinely need the email.
- **No new email template and no `lib/dispatch.ts` involvement.** This is a transactional
  notification to a known party, not sponsor-facing pitch outreach. Do not route it through
  `dispatchApprovedSubmission`.
- **`getExecutedAgreement`** reads through the caller's RLS-respecting `supabase` client, so a
  non-party gets zero rows and a clean "not found or not yours" — do not use the admin client for
  the row read. The signed URL itself must be minted with the admin client (`createSignedUrl(path, 1800)`,
  matching `app/(admin)/coaches/page.tsx:40`) **only after** the RLS read returned a row.

## UI

| Route | File | Audience |
|---|---|---|
| `/sponsor/submissions/[id]/sign` | `app/(sponsor)/sponsor/submissions/[id]/sign/page.tsx` | sponsor |
| `/submissions/[id]/sign` | `app/(coach)/submissions/[id]/sign/page.tsx` | coach |
| `/agreements/[signatureId]` | `app/agreements/[signatureId]/page.tsx` | either party + admin |

`/agreements/*` is a **top-level authenticated route** — not in a group. The `(account)` group
layout redirects verified coaches and active sponsors away, so it cannot host a page both roles
need. Do **not** add `/agreements` to `isPublicRoute` in `middleware.ts`; the default
unauthenticated → `/login` behaviour is correct here.

Shared component `components/agreements/signing-panel.tsx` (`'use client'`), used by both signing
pages:

- Renders the prepared html inside a scrollable container with
  `dangerouslySetInnerHTML` — safe because the html was DOMPurify-sanitized server-side by prompt
  05's renderer and re-read from storage, never composed on the client.
- **Scroll-to-bottom gate:** an `IntersectionObserver` on a sentinel `<div>` at the end of the
  document. Until it fires, the consent checkbox, the name field, and the submit button are all
  `disabled`, with visible helper text "Scroll to the end of the agreement to continue." Also treat
  a document shorter than the viewport as already-read (observe on mount) or short agreements become
  unsignable — this is the bug this pattern always ships with.
- **Consent block:** the template's `consent_text` verbatim, followed by a required checkbox: *"I
  agree to sign this document electronically. I understand my typed name below is my legal
  signature and has the same effect as a handwritten one."*
- **Typed name:** a text input with the expected name shown as placeholder and helper text, plus
  inline mismatch feedback before submit.
- **Evidence disclosure**, visible above the button, not buried: "We will record your name, the time
  in UTC, your IP address, your browser, and a cryptographic fingerprint of this exact document."
- Submit uses `useTransition` + `sonner` `toast` + an inline `<Alert variant="destructive">` for
  errors — the pattern in `app/(auth)/upload-credentials/page.tsx`.
- Document hash rendered in a monospace footer so the signer can see what is being fingerprinted.

State coverage for the signing pages:

- **Loading** — `loading.tsx` next to each signing page with a skeleton; the prepare step renders
  and hashes a document, so it is not instant.
- **Empty / not applicable** — submission is not in a state that has a pledged fulfillment: an
  explanatory card and a link back to the submission, not a 404.
- **Error** — `prepare` throwing `MissingMergeFieldError` is the realistic failure (the team has no
  legal payee name yet). Catch it specifically and render an actionable message naming the missing
  fields: for a coach, "Add your payout details before signing"; for a sponsor, "This team has not
  finished its payout profile — we have notified them." Never render a document with a blank.
- **Permission denied** — a signed-in user who is neither party gets the group layout's existing
  redirect for the wrong portal, and the action returns `unauthorized` if they reach it directly.
- **Already signed** — `prepare` returns `alreadySigned: true`; render a success card with the
  signed timestamp and a link to `/agreements/{signatureId}` instead of the form. Idempotent on
  refresh.
- **Awaiting counterparty** — a coach opening the page before the sponsor signs sees "Waiting for
  {Sponsor} to sign" with no form.

Verification page `/agreements/[signatureId]`:

- Server component. Calls `getExecutedAgreement`. Shows, for the whole submission (both signatures,
  not just the one in the URL): signer legal name, typed name as entered, role, UTC timestamp, IP
  address, user agent, template key + version, and the full sha256 with a copy button.
- "Download executed document" links to the short-lived signed URL, with the expiry stated.
- A "Verify this record" explainer: what the hash covers and how to check it
  (`shasum -a 256 <downloaded file>` must equal the displayed hash). This is the page a corporate
  legal team will actually ask for, so make the hash and the method prominent rather than decorative.
- Not-found / not-yours collapse to the same message. Do not distinguish them.

Also: add an "Agreement" status row to the sponsor and coach submission detail pages
(`app/(sponsor)/sponsor/submissions/[id]/page.tsx`, `app/(coach)/submissions/[id]/page.tsx`)
showing not-required / awaiting-sponsor / awaiting-coach / executed, linking to the sign or
verification page.

Fixtures: extend `lib/dev-preview.ts`, `lib/dev-coach-preview.ts`, and `lib/dev-bypass.ts` with
`agreement_signatures` rows and a `storage.createSignedUrl` stub (all three files already stub
`createSignedUrl` returning `'#dev-mock'`) so every preview mode still renders.

## Out of scope

- PDF rendering. Executed documents are HTML; the bucket MIME allowlist enforces it.
- Any third-party signature vendor integration. The interface exists so one *could* be added; adding
  one is a different prompt.
- Signature images, drawn signatures, or uploaded signature files.
- Notarisation, timestamping authorities, or blockchain anchoring.
- Signing anything other than `sponsorship_agreement` — `platform_tos` and `team_participation`
  remain unsigned keys.
- Bulk / multi-submission signing, reminder cron jobs, or signature expiry.
- Changing prompt 01's state machine beyond inserting the gate check.
- Adding a `notifications.type` value. Use `'general'`.
- Any new npm dependency. `crypto` is built in.

## Guardrails specific to this slice

- **Never `auth.uid()`** — NULL under Clerk. `current_profile_id()` / `is_admin()` in policies;
  parameter-based re-verification inside SECURITY DEFINER functions.
- **`sign_agreement_atomic` runs with no Clerk `sub`** because the admin client calls it. Every
  entitlement decision inside it must derive from `p_signer_profile_id` and the submission row.
  This is the single most likely place to introduce an authorization hole in this slice.
- **REVOKE/GRANT on every function you create *and every function you `CREATE OR REPLACE`*,**
  including prompt 01's transition RPC. Replacing a function does not preserve a REVOKE you did not
  re-issue.
- **`SET search_path = public, extensions`** on anything touching pgcrypto (`digest`). If you compute
  hashes only in Node, you still need `SET search_path = public` on the plpgsql functions.
- **`is_trusted_server_context()`, never a raw `(auth.jwt()->>'sub') IS NULL` test** — the anon key
  satisfies the latter and it fails open.
- **The `ON DELETE SET NULL` / CHECK-constraint interaction** described above. Re-read it before
  adding any constraint to this table.
- **The `teams` sublink in `agreement_signatures_select_coach`** depends on `teams` policies staying
  sublink-free (0066). Note it in the migration.
- **Do not add a column to `submissions`.** If you think you need one (`agreement_signed_at`, say),
  you do not — `agreement_is_signed()` derives it. A new `submissions` column is also unwritable by
  coaches by default because `guard_submission_writable_columns()` fails closed, which will surface
  as a mystifying autosave failure.
- **Do not weaken the append-only guarantee** to make a test pass. If a test needs to clean up
  signatures, it runs as `postgres`/service role with the trigger temporarily disabled inside a
  transaction that rolls back, or it uses a throwaway database.
- **COPPA:** `entity_snapshot` stores team number, team name, organization, sponsor company, and
  amount. **No student names, no roster data, no minor's identity, ever.** Enumerate the permitted
  keys in a code comment.
- **Capacity integrity:** this slice records signatures and gates a fulfillment transition. It must
  not touch `sponsors.funding_used_cents`, `submissions.reserved_amount_cents`, or
  `transactions_ledger`. Reserve/settle/release is already correct and is prompt 11's territory.
- **Next 16:** `params` is a Promise in Server Components — `await params` before reading
  `signatureId` or `id`.

## Files you will touch

**Create:**
- `supabase/migrations/0080_agreement_signatures.sql`
- `lib/agreements/provider.ts`
- `lib/agreements/in-house-provider.ts`
- `lib/agreements/context.ts`
- `lib/schemas/agreement-signature.ts`
- `app/actions/agreements-sign.ts`
- `app/(sponsor)/sponsor/submissions/[id]/sign/page.tsx`
- `app/(sponsor)/sponsor/submissions/[id]/sign/loading.tsx`
- `app/(coach)/submissions/[id]/sign/page.tsx`
- `app/(coach)/submissions/[id]/sign/loading.tsx`
- `app/agreements/[signatureId]/page.tsx`
- `components/agreements/signing-panel.tsx`
- `components/agreements/agreement-status-row.tsx`
- `components/agreements/signature-audit-trail.tsx`
- `lib/__tests__/agreement-signature-hash.test.ts`
- `lib/__tests__/agreement-context.test.ts`
- `tests/e2e/agreement-signing.spec.ts`

**Modify:**
- `supabase/migrations/0080_agreement_signatures.sql` re-declares prompt 01's `<ADVANCE_RPC>` —
  do **not** edit `supabase/migrations/0076_*.sql` in place; applied migrations are immutable.
- `app/(sponsor)/sponsor/submissions/[id]/page.tsx`
- `app/(coach)/submissions/[id]/page.tsx`
- `lib/supabase/types.ts`
- `lib/dev-preview.ts`
- `lib/dev-coach-preview.ts`
- `lib/dev-bypass.ts`
- `lib/schemas/limits.ts` (only if a new constant is genuinely required)

## Tests

**Vitest — `lib/__tests__/agreement-signature-hash.test.ts`:**
- `sha256` of a known string matches a fixed expected digest (guards against an encoding change).
- Rendering the same context twice yields the same hash.
- Changing a single merge value changes the hash.
- The typed-name matcher: accepts `"jane q. public"` vs `"Jane Q. Public"`, accepts doubled internal
  spaces, rejects `"J. Public"` and `""`.

**Vitest — `lib/__tests__/agreement-context.test.ts`:**
- Builds a complete `MergeContext` from a full submission fixture.
- A missing legal payee name surfaces as `MissingMergeFieldError` naming `team_legal_payee_name`,
  and no document is produced.
- `amount_formatted` renders cents correctly (`1_250_000` → `$12,500.00`) and is stable across
  locales (`process.env.TZ` and `LANG` changes must not alter it).
- `entity_snapshot` contains only the permitted keys — assert the key set exactly, so a future
  addition of student data fails the test.

**Playwright — `tests/e2e/agreement-signing.spec.ts` (security boundaries are mandatory):**
- Unauthenticated `GET /agreements/<id>` → redirected to `/login` (proves it is not public).
- Sponsor A cannot open sponsor B's signing page or verification page.
- A coach cannot open `/sponsor/submissions/<id>/sign`.
- A coach cannot countersign before the sponsor signs (the page shows "waiting", and calling the
  action directly returns `awaiting_sponsor_signature`).
- Happy path: sponsor scrolls, checks consent, types the matching name, signs; the coach is notified;
  the coach countersigns; the fulfillment advances out of `pledged`.
- Controls stay disabled until the document is scrolled to the bottom; a short document enables them
  immediately.
- Submitting a stale `documentHash` returns `document_changed`.

**SQL boundary checks — in the migration's `VERIFICATION` block, and actually run:**
- `UPDATE agreement_signatures SET typed_name = 'x'` as service_role →
  `agreement_signature_immutable`.
- `DELETE FROM agreement_signatures` as service_role → `agreement_signature_immutable`.
- As coach A's JWT: `GET /rest/v1/agreement_signatures?select=*` returns only their own team's rows.
- As sponsor B's JWT: sponsor A's signature is absent.
- As anon: `[]`.
- `has_function_privilege('authenticated','sign_agreement_atomic(uuid,uuid,text,uuid,text,text,text,text,text,text,jsonb)','EXECUTE')`
  → `false`. Same for `agreement_is_signed(uuid)` and the replaced `<ADVANCE_RPC>`.
- **Gate cannot be bypassed:** with a fulfillment in `pledged` and no signatures,
  (a) calling `<ADVANCE_RPC>` for `payment_sent` returns `agreement_not_signed`, and
  (b) a direct `UPDATE <FULFILLMENTS> SET status='payment_sent'` as service_role raises
  `agreement_not_signed`. **Both must be demonstrated.**
- Deleting a signer's `profiles` row nulls `signer_profile_id` and leaves the signature intact with
  its denormalised name and email — and does **not** error.
- Replay the migration a second time with `psql -f`.

## Acceptance criteria

- [ ] `psql -f supabase/migrations/0080_agreement_signatures.sql` succeeds twice in a row.
- [ ] `pg_policies` for `agreement_signatures` shows exactly four SELECT policies and **zero**
      INSERT/UPDATE/DELETE policies.
- [ ] `storage.buckets` shows `executed-agreements` with `public = false`, a 5 MB limit, and
      `{text/html}`; its only policies are the two SELECT policies.
- [ ] Service-role `UPDATE` and `DELETE` on `agreement_signatures` both raise
      `agreement_signature_immutable`.
- [ ] With no signatures, `<ADVANCE_RPC>` → `payment_sent` returns `agreement_not_signed`, **and** a
      direct service-role `UPDATE` to `payment_sent` raises `agreement_not_signed`. Both proven with
      pasted psql output.
- [ ] With both signatures present, the same transition succeeds.
- [ ] A sponsor signs in a real browser: controls are disabled until scroll-to-bottom, a mismatched
      typed name is rejected with the expected name shown, and after signing the executed document
      exists in `executed-agreements` under the sponsor's Clerk id.
- [ ] `shasum -a 256` of the downloaded executed document equals `agreement_signatures.document_hash`.
- [ ] The coach receives an in-app notification and an email, countersigns, and the fulfillment
      leaves `pledged`.
- [ ] Re-loading the signing page after signing shows the already-signed card, not a second form.
- [ ] `/agreements/{signatureId}` shows both signatures with typed name, UTC timestamp, IP, user
      agent, template version, and hash, and the download link works.
- [ ] A second sponsor account gets "not found" on that same URL.
- [ ] Deleting a signer profile leaves the signature row readable by admin with its denormalised
      name and email intact.
- [ ] A submission whose team has no legal payee name shows the actionable "missing payout details"
      message and produces no document.
- [ ] All three preview modes (`dev:admin-preview`, `dev:sponsor-preview`, `dev:coach-preview`)
      render the new pages without network access.
- [ ] `npm run typecheck && npm run lint && npm run build && npm run test` all pass.

## Rollback

```sql
BEGIN;
-- 1. Restore prompt 01's transition RPC to its pre-gate body, copied verbatim from
--    supabase/migrations/0076_*.sql, and re-issue its REVOKE/GRANT lines.
--    Do this FIRST — the function references agreement_is_signed().
-- <paste 0076's CREATE OR REPLACE + REVOKE/GRANT here>

DROP TRIGGER  IF EXISTS trg_fulfillment_requires_signed_agreement ON <FULFILLMENTS>;
DROP FUNCTION IF EXISTS guard_fulfillment_requires_signed_agreement();
DROP TRIGGER  IF EXISTS trg_agreement_signature_append_only ON agreement_signatures;
DROP FUNCTION IF EXISTS guard_agreement_signature_append_only();
DROP FUNCTION IF EXISTS sign_agreement_atomic(uuid,uuid,text,uuid,text,text,text,text,text,text,jsonb);
DROP FUNCTION IF EXISTS agreement_is_signed(uuid);

-- 2. Storage policies.
DROP POLICY IF EXISTS "executed_agreements_select_own"   ON storage.objects;
DROP POLICY IF EXISTS "executed_agreements_select_admin" ON storage.objects;
COMMIT;
```

**Do not drop `agreement_signatures` and do not delete the `executed-agreements` bucket.** Executed
agreements are legal records; if any real signature exists, dropping the table destroys evidence a
counterparty is entitled to. Rolling back the *code* while leaving the table in place is safe — the
table is inert without the RPC. Only drop it if you have confirmed `SELECT count(*)` is zero
(pre-launch, this will be the case):

```sql
DROP TABLE IF EXISTS agreement_signatures;
DELETE FROM storage.objects WHERE bucket_id = 'executed-agreements';
DELETE FROM storage.buckets WHERE id = 'executed-agreements';
```

Then `git revert` the code commit and `vercel deploy --prod --yes`. `vercel rollback` reverts the
deployment but not the database.

## Commit

```
feat(esign): in-house ESIGN capture and a database-enforced agreement gate

Adds append-only agreement_signatures pinning the exact template version signed,
with typed name, UTC timestamp, IP, user agent, and a sha256 of the exact bytes
displayed — re-verified against the stored prepared document at capture time.
Executed documents live in a new private executed-agreements bucket partitioned
by Clerk user id.

Sponsor signs, coach countersigns, the platform does not sign: Article 4 of the
agreement says it is not a party. A fulfillment cannot reach payment_sent until
both signatures exist, enforced inside the transition RPC and again by a trigger
so a direct service-role UPDATE cannot bypass it.

Signing runs behind a narrow SignatureProvider interface (prepare/capture/
retrieve) with the in-house implementation as the only concrete class.
```
