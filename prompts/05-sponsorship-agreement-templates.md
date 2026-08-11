# Prompt 05 — Sponsorship Agreement Templates & Versioning

> **Prerequisites:** None
> **Reserved migration:** `0079_agreement_templates.sql` — verify it is still free with `ls supabase/migrations | tail -3`
> **Scope:** medium · ~18 files
> **Leaves the repo:** green and shippable on its own

## Why this exists

A corporate sponsor's legal team asks three questions before releasing $5–50k: *what exactly are we
committing to, who is the counterparty, and where is the signed instrument?* Today the platform
answers none of them. `transactions_ledger` records a commitment created by a button click, the
handshake email tells the sponsor a coach "will send W-9 and payment instructions", and
`app/legal/terms/page.tsx` never states who the money flows between or what the platform's liability
is. This slice builds the document layer those questions are answered from — the versioned template
and the honest legal pages. Prompt 06 builds the signature capture on top of it.

## Current state (verified)

**What exists:**
- `app/legal/terms/page.tsx` — six sections (acceptance, eligibility, prohibited conduct, review &
  dispatch, sponsor funding caps, termination). It never mentions who pays whom, never says the
  platform does not handle funds, has no limitation of liability, no governing law, no
  "changes to these terms" clause, and no reference to any sponsorship agreement.
- `app/legal/privacy/page.tsx` — six sections. Section 5 (Data Retention) covers photo-ID purging
  accurately; there is nothing about agreement or signature records.
- Both pages are static server components under `app/legal/`, wrapped by `app/legal/layout.tsx`,
  each rendering `<BackButton />` from `@/components/ui/back-button` and a
  `<div className="prose prose-invert">` body. Both stamp
  `Last updated: {new Date().toLocaleDateString()}` with `suppressHydrationWarning`.
- `/legal(.*)` is **already** in the `isPublicRoute` matcher in `middleware.ts`. Any new page under
  `app/legal/` is public with **no middleware change**.
- The admin route group is `app/(admin)/`, gated by `app/(admin)/layout.tsx`
  (`getAuthedProfile()` → redirect sponsors to `/sponsor/dashboard?redirected=admin`, everyone
  else non-admin to `/dashboard?redirected=admin`). Group-level `loading.tsx` and `error.tsx`
  already exist at `app/(admin)/loading.tsx` and `app/(admin)/error.tsx`.
- Admin nav lives in the `NAV_ITEMS` const array in `components/admin/admin-sidebar.tsx`
  (a `'use client'` component; icons are `lucide-react`).
- `isomorphic-dompurify` and `@react-email/render` are already dependencies. **No new dependency is
  needed or permitted for this slice.**

**What is missing:** every part of an agreement layer. No `agreement_templates` table, no merge-field
contract, no renderer, no admin editor, no diff, no seeded document, and no legal copy describing the
funds-flow reality.

## What you are building

1. Migration `0079_agreement_templates.sql`: the `agreement_templates` table, its immutability
   trigger, the one-effective-version-per-key index, per-role RLS, the
   `publish_agreement_version()` RPC, and the seeded `sponsorship_agreement` v1.
2. `lib/agreements/merge-fields.ts` — the typed merge-field registry (the only variables a template
   may reference).
3. `lib/agreements/render.ts` — a **deterministic** renderer that fails loudly on unknown or missing
   fields. Determinism is a hard requirement: prompt 06 hashes its output.
4. `lib/agreements/diff.ts` — a pure line diff, no dependency.
5. `lib/schemas/agreement.ts` — Zod schemas for the admin editor actions.
6. `app/actions/agreements.ts` — `createAgreementDraft`, `updateAgreementDraft`,
   `publishAgreementVersion`, `clearLegalReviewFlag`.
7. Admin UI under `app/(admin)/agreements/` — list, version history + inline version diff, draft
   editor with live preview and unknown-token warnings.
8. `app/legal/agreement/page.tsx` — a public, read-only **specimen** rendering of the currently
   effective sponsorship agreement.
9. Rewritten `app/legal/terms/page.tsx` and updated `app/legal/privacy/page.tsx`.
10. `lib/dev-bypass.ts` fixtures so `npm run dev:admin-preview` still renders the new admin pages.

## Data model

### DDL

```sql
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
```

**Immutability once effective** — a BEFORE UPDATE trigger, not a policy, because the admin client
bypasses RLS entirely and this constraint must hold against it too:

```sql
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
```

Also add a BEFORE DELETE trigger raising `agreement_template_immutable` unless
`OLD.status = 'draft'`. Prompt 06 adds an FK from `agreement_signatures`, but a delete guard here
means the rule is enforced from day one rather than arriving with the FK.

### RLS policies (one bullet per policy)

- `agreement_templates_select_admin` — `FOR SELECT USING (is_admin())`. Admins read every version,
  including drafts.
- `agreement_templates_select_published` — `FOR SELECT TO authenticated USING (status IN ('effective','retired'))`.
  Any signed-in user may read a published version. Retired must be readable or a signer cannot
  retrieve the version they signed (prompt 06's verification page).
- `agreement_templates_insert_admin` — `FOR INSERT WITH CHECK (is_admin())`.
- `agreement_templates_update_admin` — `FOR UPDATE USING (is_admin()) WITH CHECK (is_admin())`.
  The trigger, not this policy, is what enforces immutability.
- `agreement_templates_delete_admin_draft` — `FOR DELETE USING (is_admin() AND status = 'draft')`.
- **No policy for `anon`.** The public specimen page reads through the admin client with a
  hard-coded `status = 'effective'` filter (house rule 9: route the crossing through the admin
  client rather than loosening a policy).

### RPC

```sql
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

  RETURN jsonb_build_object(
    'ok', true, 'key', v_key, 'version', v_version, 'retired_id', v_prev_id
  );
END $$;

REVOKE EXECUTE ON FUNCTION publish_agreement_version(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION publish_agreement_version(uuid, uuid) TO service_role;
```

Apply the same REVOKE/GRANT pair to `guard_agreement_template_immutable()` — it is a trigger
function, but the rule in `_CONTEXT.md` §8.4 is unconditional and Postgres defaults to PUBLIC.

### Merge-field contract

`lib/agreements/merge-fields.ts` — the single source of truth. A template may reference **only**
these keys; anything else is rejected at save time and at render time.

```ts
export const MERGE_FIELDS = {
  platform_name:          { label: 'Platform name',           example: 'FTC Pitfund' },
  platform_contact_email: { label: 'Platform contact email',  example: 'support@…' },
  agreement_date:         { label: 'Agreement date (UTC)',    example: '2026-08-09' },
  sponsor_company_name:   { label: 'Sponsor company name',    example: 'Acme Robotics, Inc.' },
  sponsor_contact_name:   { label: 'Sponsor signatory name',  example: 'Dana Whitfield' },
  sponsor_contact_email:  { label: 'Sponsor contact email',   example: 'dana@acme.example' },
  team_number:            { label: 'FTC team number',         example: '14821' },
  team_name:              { label: 'Team name',               example: 'Iron Kestrels' },
  team_organization:      { label: 'Team organization',       example: 'Northgate High School' },
  team_legal_payee_name:  { label: 'Legal payee name',        example: 'Northgate HS Robotics Boosters' },
  team_city:              { label: 'Team city',               example: 'Dayton' },
  team_state:             { label: 'Team state',              example: 'OH' },
  season:                 { label: 'Competition season',      example: '2026–2027' },
  amount_formatted:       { label: 'Sponsorship amount',      example: '$12,500.00' },
} as const

export type MergeFieldKey = keyof typeof MERGE_FIELDS
export type MergeContext = Record<MergeFieldKey, string>
```

`team_legal_payee_name` is the payee from prompt 02's payout profile when that slice exists. **Do
not** import prompt 02 code — this slice only declares the field; prompt 06 populates it, falling
back to `teams.organization`. Note this in a code comment so a later reader does not think it is
dead.

### Renderer contract (`lib/agreements/render.ts`)

- Token syntax: `{{ field_name }}` (whitespace inside the braces optional).
- `extractMergeFields(body): string[]` — every distinct token in the body, in order.
- `validateTemplateBody(body): { ok: true; fields: MergeFieldKey[] } | { ok: false; unknown: string[] }`.
- `renderAgreement(body, ctx): { html: string }`:
  - Unknown token → throw `UnknownMergeFieldError` listing every unknown token.
  - Known token whose value is `undefined`, `null`, or empty/whitespace-only → throw
    `MissingMergeFieldError` listing **every** missing key (not just the first). **Never substitute
    a blank, a dash, or the field name.** A silently blank payee line in an executed agreement is the
    exact failure mode this contract exists to prevent.
  - Values are HTML-escaped before substitution; the assembled document is then run through
    `isomorphic-dompurify` with a tag allowlist of `h1 h2 h3 p ul ol li strong em br hr table thead
    tbody tr th td` and no attributes except `class`.
- **Determinism is load-bearing.** No `Date`, no `Math.random`, no locale-dependent formatting, no
  object-key iteration order dependence inside the renderer. `agreement_date` and
  `amount_formatted` arrive pre-formatted in `ctx`. Prompt 06 hashes this output; a non-deterministic
  byte anywhere breaks signature verification. Add a unit test that asserts two calls with identical
  inputs produce identical strings.

## Server actions

All in `app/actions/agreements.ts`, all following the canonical 5-step shape. Schemas in
`lib/schemas/agreement.ts`. Note: `plainTextField` / `richTextField` are **module-private** in
`lib/schemas/submission.ts` and `lib/schemas/team.ts` — they are not exported. Do not try to import
them; the template body is raw template source and must not be tiptap-sanitized before storage
anyway. Use plain `z.string().trim().min().max()` with limits added to `lib/schemas/limits.ts`
(`agreementTitle: 200`, `agreementBody: 60000`, `agreementConsentText: 4000`).

| Action | Signature | Guard | Audit action | Notification |
|---|---|---|---|---|
| `createAgreementDraft` | `({ key, title, body, consentText }) => { success?: true; id?: string; error?: string }` | `requireAdmin()` | `agreement_template_created` | none |
| `updateAgreementDraft` | `({ id, title, body, consentText }) => { success?: true; error?: string }` | `requireAdmin()` | `agreement_template_updated` | none |
| `publishAgreementVersion` | `({ id }) => { success?: true; error?: string }` | `requireAdmin()` | `agreement_template_published` | none |
| `clearLegalReviewFlag` | `({ id, reviewerNote }) => { success?: true; error?: string }` | `requireAdmin()` | `agreement_template_legal_review_cleared` | none |

Details:

- **`createAgreementDraft`** — run `validateTemplateBody` and reject with the unknown-token list
  before touching the DB. Compute the next version with an atomic insert-with-subselect:
  `INSERT ... SELECT COALESCE(MAX(version),0)+1 FROM agreement_templates WHERE key = $key`. The
  `UNIQUE (key, version)` constraint is the race guard — map `23505` through `mapDbError` and
  surface "A draft already exists for this document. Edit it instead." Persist
  `merge_fields` from the validation result. Writes go through the **server** client
  (`requireAdmin()`'s `supabase`), which the admin RLS policies permit; `adminClient` is used only
  for `audit_log`, per the canonical shape.
- **`updateAgreementDraft`** — same validation. The immutability trigger raises
  `agreement_template_immutable` if the row is not a draft; catch it and return
  "This version is already effective — create a new version to change it."
- **`publishAgreementVersion`** — calls `adminClient.rpc('publish_agreement_version', { p_template_id, p_actor_profile_id: user.id })`.
  Map `unauthorized` and `not_a_draft` to friendly strings. `revalidatePath('/agreements')`,
  `revalidatePath('/legal/agreement')`.
- **No notifications.** Template CRUD is an internal admin operation with no per-user state change;
  `_CONTEXT.md` house rule 8 covers user-visible state changes. This is a deliberate exception, not
  an omission — say so in a comment at the top of the file.

## UI

Routes (all under the existing admin group, so `app/(admin)/layout.tsx` supplies the
permission-denied behaviour and `loading.tsx` / `error.tsx` supply loading and error states):

| Route | File | Purpose |
|---|---|---|
| `/agreements` | `app/(admin)/agreements/page.tsx` | One card per `key`: effective version + date, open-draft badge, legal-review badge |
| `/agreements/[key]` | `app/(admin)/agreements/[key]/page.tsx` | Version history table + inline diff via `?from=1&to=2` search params |
| `/agreements/[key]/edit` | `app/(admin)/agreements/[key]/edit/page.tsx` | Draft editor |
| `/legal/agreement` | `app/legal/agreement/page.tsx` | Public specimen — already covered by `/legal(.*)` in `middleware.ts`; **no middleware change** |

Components in `components/admin/`:
- `agreement-editor.tsx` (`'use client'`) — a plain `<textarea>` for the body, **not** the tiptap
  editor. Tiptap would mangle `{{ tokens }}` and wrap them in markup. Debounced live preview on the
  right, rendered from the registry's `example` values. Unknown tokens surface as an inline amber
  list under the textarea before save is possible; the Save button stays disabled while any unknown
  token is present. Reuse the `useTransition` + `sonner` `toast` + inline `<Alert variant="destructive">`
  pattern from `app/(auth)/upload-credentials/page.tsx`.
- `agreement-version-diff.tsx` — renders the output of `lib/agreements/diff.ts` as
  added/removed/unchanged lines.
- `agreement-legal-review-banner.tsx` — a persistent amber `<Alert>` on every agreements page while
  any effective template has `needs_legal_review = true`: *"This document has not been reviewed by
  an attorney. It is engineering-drafted template copy, not legal advice. Have counsel review it
  before relying on it."* Clearing it requires the admin to type a reviewer note.

Nav: add `{ label: 'Agreements', href: '/agreements', icon: FileSignature, exact: false, badge: false }`
to `NAV_ITEMS` in `components/admin/admin-sidebar.tsx`, after `Sponsors`.

State coverage:
- **Empty** — a `key` with no versions renders "No version of this document exists yet" plus a
  "Create draft" button. The migration seeds `sponsorship_agreement`, so `platform_tos` and
  `team_participation` will legitimately be empty on day one; that is the state to design for.
- **Loading** — `app/(admin)/loading.tsx` already covers the group. Add
  `app/(admin)/agreements/loading.tsx` with a skeleton matching `app/(admin)/sponsors/loading.tsx`.
- **Error** — `app/(admin)/error.tsx` already covers the group. Action errors render inline via
  `<Alert variant="destructive">`, never a thrown boundary.
- **Permission denied** — handled by the group layout redirect. Do not add a second check in the page.
- **Already published** — the editor route for a `key` whose only versions are effective/retired
  renders a read-only view with a "Create version N+1 from this" button that seeds a new draft with
  the current body.

Public specimen page (`app/legal/agreement/page.tsx`):
- Server component. Reads the effective `sponsorship_agreement` through `createAdminClient()` with
  `.eq('key','sponsorship_agreement').eq('status','effective').maybeSingle()` — hard-scoped, no
  user input in the query.
- Renders with the registry `example` values and a prominent banner: *"SPECIMEN. Merge fields below
  show example values. The binding document is the one generated and signed for a specific
  sponsorship."*
- If no effective version exists, render a short "not yet published" notice rather than 404.
- Link it from the new "The Sponsorship Agreement" section in the Terms page.

### Legal copy (attorney review required)

Rewrite `app/legal/terms/page.tsx` keeping its existing shell (metadata export, `<BackButton />`,
the `Last updated` line with `suppressHydrationWarning`, `prose prose-invert`). Keep sections 1–6
substantially as they are and add:

- **Our role — facilitator, not fiduciary.** The platform introduces teams to sponsors and tracks
  the state of a commitment. It is not a party to the sponsorship, not an agent of either party,
  not a fiduciary, not a broker-dealer, and not a charity or fiscal sponsor.
- **How funds move.** *The platform never receives, holds, escrows, or transmits sponsorship funds.*
  Payment is made directly by the sponsor to the team or its fiscal host. The platform records what
  the parties tell it; a record here is not proof of payment and creates no obligation on the
  platform to pay anyone.
- **The Sponsorship Agreement.** Each funded sponsorship is governed by the Sponsorship Agreement
  executed between the sponsor and the team, linked at `/legal/agreement`. Where these Terms and an
  executed Sponsorship Agreement conflict, the Sponsorship Agreement governs the sponsorship; these
  Terms continue to govern use of the platform.
- **Electronic signatures.** Users consent to transact electronically under ESIGN/UETA; a typed name
  submitted through the platform's signing flow is a legally binding signature. Users may request a
  copy of any document they signed and may withdraw consent to electronic transacting prospectively.
- **No warranty; limitation of liability.** Service provided "as is"; no guarantee of funding,
  sponsor response, or payment; aggregate liability capped at the greater of the fees the user paid
  the platform (currently zero) or US$100; no indirect, incidental, or consequential damages.
- **Indemnification** for misuse of funds, misrepresentation, and COPPA violations.
- **Governing law and venue** — leave the state as a clearly-marked `TODO(legal)` placeholder rather
  than inventing a jurisdiction.
- **Changes to these Terms** — notice mechanism and continued-use acceptance.

Add to `app/legal/privacy/page.tsx` a section "Agreement and signature records": when a document is
signed, the platform records the typed name, the account's email, the UTC timestamp, the IP address,
the browser user-agent string, and a cryptographic hash of the exact document displayed, and retains
the executed document and that audit trail for seven years as an ESIGN/UETA business record. State
plainly that **this record survives account deletion** — it is the one category exempted from the
deletion promise in the existing retention section — and reconcile the wording so the two sections do
not contradict each other.

Every one of these blocks must carry a visible marker in the source (`{/* ATTORNEY REVIEW REQUIRED */}`)
and the seeded agreement body carries the `needs_legal_review` flag. Do not present any of it as
legal advice in the copy itself.

### Seeded Sponsorship Agreement v1 (template copy — attorney review required)

Insert as `key='sponsorship_agreement'`, `version=1`, `status='effective'`, `effective_from=now()`,
`needs_legal_review=true`, `created_by=NULL`. Cover, at minimum, these numbered articles:

1. **Parties and effective date** — `{{ sponsor_company_name }}`, `{{ team_legal_payee_name }}` on
   behalf of FTC Team `{{ team_number }}` (`{{ team_name }}`) of `{{ team_organization }}`,
   `{{ team_city }}`, `{{ team_state }}`; effective `{{ agreement_date }}`.
2. **The commitment** — sponsor commits `{{ amount_formatted }}` for the `{{ season }}` season.
3. **Payment terms** — paid **directly** to `{{ team_legal_payee_name }}` within 30 days of
   execution, by the method the parties agree; the team supplies a W-9 and remittance details.
4. **The platform's role** — `{{ platform_name }}` is a facilitator and recordkeeper only. It is not
   a party to this Agreement, does not receive, hold, or transmit the funds, and has no payment
   obligation to either party. State this in the document itself so a sponsor's counsel does not
   have to infer it.
5. **Recognition** — what the sponsor receives: logo placement on the robot and team materials,
   named acknowledgement in outreach, an end-of-season impact summary. Recognition is the team's
   obligation, not the platform's.
6. **Use of funds** — restricted to team operating expenses (parts, tooling, registration, travel,
   outreach). Not for individual compensation. Team keeps records for the season and provides a
   summary on request.
7. **Misuse of funds** — sponsor's remedies: written notice, a 30-day cure period, then refund of the
   unspent balance. The platform's only role is to record the dispute and may suspend the team's
   account; it is not an arbitrator and owes no refund.
8. **Term and termination** — runs through the end of the `{{ season }}` season; either party may
   terminate for material breach on 30 days' written notice; obligations already accrued survive.
9. **No employment, partnership, or joint venture; no exclusivity** unless separately agreed.
10. **Limitation of liability** — each party's liability capped at the sponsorship amount; the
    platform's liability to either party expressly excluded, consistent with Article 4.
11. **Governing law** — `TODO(legal): jurisdiction to be set by counsel.`
12. **Entire agreement, amendment in writing, counterparts, electronic signature.**
13. **Signature blocks** — sponsor and team, each with printed name, title, and date.

Write it in plain declarative English at roughly the reading level of the existing legal pages. Do
not include a "this is not legal advice" line inside the document body — a disclaimer inside an
executed instrument undermines it. The attorney-review warning lives in the migration comment, the
`needs_legal_review` flag, and the admin banner.

## Out of scope

- **Signature capture of any kind.** No signing UI, no `agreement_signatures` table, no storage
  bucket, no hashing, no ESIGN capture. That is prompt 06 in its entirety.
- Wiring anything to a fulfillment state machine or to `transactions_ledger`.
- PDF generation. Documents are HTML in this slice.
- Seeding `platform_tos` or `team_participation` content — the keys exist; the copy does not.
- Retiring a version without a successor, and un-retiring. Publish-supersedes is the only lifecycle
  transition.
- Any WYSIWYG editor for template bodies.
- Emailing anyone about a template change.
- Any new npm dependency, including a diff library.

## Guardrails specific to this slice

- **Never `auth.uid()`.** It is NULL under Clerk. Use `is_admin()` in policies and
  `current_profile_id()` where a profile is needed.
- **`publish_agreement_version` is called with the admin client**, which carries no Clerk `sub`, so
  `is_admin()` inside it would evaluate against nothing. It **must** re-verify the actor from
  `p_actor_profile_id`. This is the pattern `_CONTEXT.md` §1 describes; copy it exactly.
- **REVOKE/GRANT every SECURITY DEFINER function**, the trigger function included. Postgres defaults
  to PUBLIC and this project has already been bitten by it once (0062).
- **The immutability rule must be a trigger, not a policy.** Policies do not apply to the
  service-role client, and every write in this codebase can reach the DB through it.
- **The two partial unique indexes make naive UPDATEs fail.** Promoting a draft while an effective
  version exists violates `agreement_templates_one_effective_per_key`. That is why publishing is an
  RPC, not an action-level update. Do not "fix" the index by dropping it.
- **The renderer must be deterministic.** Prompt 06 hashes its output and stores the hash in a legal
  record. A stray `new Date()` or `toLocaleString()` inside it is a latent verification failure that
  will not show up until someone disputes a signature.
- **Failing loudly on a missing merge field is the feature.** Do not add a "graceful" fallback.
- **Next 16:** `params` and `searchParams` in Server Components are Promises — `await` them. The
  diff route reads `?from=`/`?to=` from `searchParams`.
- **Extend `lib/dev-bypass.ts`** with `agreement_templates` fixtures or `npm run dev:admin-preview`
  breaks on the new pages. The mock client is a table-name switch — follow the existing shape.
- Do not touch `app/legal/layout.tsx`, the submission lifecycle, capacity logic, or
  `lib/dispatch.ts`.

## Files you will touch

**Create:**
- `supabase/migrations/0079_agreement_templates.sql`
- `lib/agreements/merge-fields.ts`
- `lib/agreements/render.ts`
- `lib/agreements/diff.ts`
- `lib/schemas/agreement.ts`
- `app/actions/agreements.ts`
- `app/(admin)/agreements/page.tsx`
- `app/(admin)/agreements/loading.tsx`
- `app/(admin)/agreements/[key]/page.tsx`
- `app/(admin)/agreements/[key]/edit/page.tsx`
- `components/admin/agreement-editor.tsx`
- `components/admin/agreement-version-diff.tsx`
- `components/admin/agreement-legal-review-banner.tsx`
- `app/legal/agreement/page.tsx`
- `lib/__tests__/agreement-render.test.ts`
- `lib/__tests__/agreement-diff.test.ts`
- `tests/e2e/agreements-admin.spec.ts`

**Modify:**
- `app/legal/terms/page.tsx`
- `app/legal/privacy/page.tsx`
- `components/admin/admin-sidebar.tsx`
- `lib/schemas/limits.ts`
- `lib/dev-bypass.ts`
- `lib/supabase/types.ts` (regenerate or hand-add the `agreement_templates` row/insert/update types
  and the `publish_agreement_version` RPC signature — match the file's existing style)

## Tests

**Vitest — `lib/__tests__/agreement-render.test.ts`:**
- Renders every registry field correctly with a full context.
- Unknown token → `UnknownMergeFieldError` naming the token.
- Missing value (`undefined`, `null`, `''`, `'   '`) → `MissingMergeFieldError` listing **all**
  missing keys, and the output is not produced.
- **Determinism:** two calls with identical inputs return byte-identical strings; a third call after
  `vi.setSystemTime()` advances the clock still matches.
- HTML in a merge value is escaped; `<script>` in a template body is stripped by DOMPurify.
- `validateTemplateBody` accepts the seeded body verbatim (import the SQL seed string from a shared
  constant, or assert against a copy kept in sync — state which you chose).

**Vitest — `lib/__tests__/agreement-diff.test.ts`:** identical inputs → all unchanged; insertion,
deletion, and replacement each produce the expected line ops; empty inputs do not throw.

**Playwright — `tests/e2e/agreements-admin.spec.ts` (security boundaries are mandatory):**
- Unauthenticated `GET /agreements` → redirected to `/login`.
- Signed-in **coach** → redirected off `/agreements` by the admin layout (`/dashboard?redirected=admin`).
- Signed-in **sponsor** → redirected to `/sponsor/dashboard?redirected=admin`.
- Unauthenticated `GET /legal/agreement` → 200 and shows the SPECIMEN banner.
- Admin can create a draft, sees an unknown-token warning for `{{ bogus_field }}` and a disabled
  Save, fixes it, saves, publishes, and sees v1 flip to retired and v2 to effective.

**SQL boundary checks** — put them in the migration's `VERIFICATION` comment block and run them:
- As a coach (their own Clerk JWT): `PATCH /rest/v1/agreement_templates?id=eq.<id>` → 0 rows.
- As anon: `GET /rest/v1/agreement_templates?select=*` → `[]`.
- As a signed-in non-admin: the effective row is visible, the draft row is not.
- As service_role: `UPDATE agreement_templates SET body='x' WHERE status='effective'` →
  `agreement_template_immutable`.
- `DELETE FROM agreement_templates WHERE status='effective'` → `agreement_template_immutable`.
- `INSERT` a second `status='effective'` row for the same key → unique index violation.
- `SELECT publish_agreement_version('<draft>','<coach profile id>')` → `{"ok":false,"error":"unauthorized"}`.
- Replay the whole migration a second time with `psql -f` — it must succeed.

## Acceptance criteria

- [ ] `psql -f supabase/migrations/0079_agreement_templates.sql` succeeds twice in a row.
- [ ] `SELECT key, version, status, needs_legal_review FROM agreement_templates` returns exactly one
      row: `sponsorship_agreement | 1 | effective | t`.
- [ ] `pg_policies` for `agreement_templates` lists exactly the five policies named above and no
      others.
- [ ] An `UPDATE` of an effective template's `body` as service_role raises
      `agreement_template_immutable`.
- [ ] `publish_agreement_version` returns `unauthorized` when passed a non-admin profile id, and
      `has_function_privilege('authenticated','publish_agreement_version(uuid,uuid)','EXECUTE')`
      is `false`.
- [ ] Admin can create a draft of v2, see a line diff against v1, publish it, and observe v1 become
      `retired` and v2 `effective` — verified in a browser, not by reading code.
- [ ] A template body containing `{{ not_a_real_field }}` cannot be saved, and the editor names the
      offending token.
- [ ] `renderAgreement` throws rather than emitting a document when `team_legal_payee_name` is empty.
- [ ] `/legal/agreement` loads while signed out, shows the SPECIMEN banner, and renders example
      values for every merge field.
- [ ] `/legal/terms` states that the platform never receives, holds, or transmits funds, and links
      to `/legal/agreement`.
- [ ] `/legal/privacy` states that signature records survive account deletion and does not contradict
      the existing retention section.
- [ ] A coach and a sponsor are both redirected away from `/agreements`.
- [ ] `npm run dev:admin-preview` renders `/agreements` without hitting the network.
- [ ] `npm run typecheck && npm run lint && npm run build && npm run test` all pass.

## Rollback

```sql
BEGIN;
DROP TRIGGER IF EXISTS trg_agreement_template_immutable ON agreement_templates;
DROP TRIGGER IF EXISTS trg_agreement_template_no_delete ON agreement_templates;
DROP FUNCTION IF EXISTS publish_agreement_version(uuid, uuid);
DROP FUNCTION IF EXISTS guard_agreement_template_immutable();
DROP FUNCTION IF EXISTS guard_agreement_template_no_delete();
DROP TABLE IF EXISTS agreement_templates;  -- CASCADE only if 0080 has already been applied
COMMIT;
```

Then `git revert` the code commit and redeploy with `vercel deploy --prod --yes`. **Do not run this
after prompt 06 has shipped** — `agreement_signatures.template_id` references this table, and
dropping it destroys executed legal records. If 06 is live, roll back 0080 first.

## Commit

```
feat(agreements): versioned sponsorship agreement templates + honest legal pages

Adds agreement_templates with immutable-once-effective versioning, a typed
merge-field contract whose renderer fails loudly on a missing value, an
admin-only editor with version diffing, and a seeded Sponsorship Agreement v1
flagged for attorney review. Rewrites /legal/terms and /legal/privacy to state
the platform's actual role: facilitator and recordkeeper, never a holder of funds.

Template copy is engineering-drafted and unreviewed. needs_legal_review = true.
```
