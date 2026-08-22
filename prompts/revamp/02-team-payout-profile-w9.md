# Prompt 02 — Team payout profile and W-9 collection

> **Prerequisites:** None
> **Reserved migration:** `0077_team_payout_profiles.sql` — verify it is still free with `ls supabase/migrations | tail -3`
> **Scope:** large · ~14 files
> **Leaves the repo:** green and shippable on its own

## Why this exists

A Fortune 500 accounts-payable department will not cut a check to a name and a hope. Before
funds are released they require: a completed Form W-9 on file, the payee's exact legal name,
its taxpayer identification number, a remittance address, and evidence that somebody
verified those match. Today the platform has one field for all of this —
`teams.tax_status`, a three-value enum the coach self-selects — and the actual paperwork is
an email: `emails/handshake-email.tsx:52-54` tells the coach to "reply to this email with
your team's W-9 and preferred payment instructions." The platform never sees it, so it can
never tell a sponsor "this team is payable."

## Current state (verified)

**What exists**

- `teams.tax_status` is enum `tax_status_type` (`501c3` | `School` | `None`). It is written
  at auto-provisioning from untrusted `profiles.pending_team_data`
  (`app/(coach)/dashboard/page.tsx:117-118`) and is otherwise coach-editable. There is no
  legal payee name, no EIN, no address, no document anywhere on `teams`.
- The credential-upload pattern this slice mirrors:
  - `app/(auth)/upload-credentials/page.tsx` — client component, 5 MB / PDF+JPEG+PNG
    client pre-check, calls the server action, shows a success card.
  - `app/actions/credentials.ts` — validates via `validateCredentialFile` (imported from
    `app/actions/auth.ts`; size + MIME allowlist + magic-byte sniffing), `requireAuth()` +
    an explicit `user.role !== 'coach'` check, uploads with the **admin client** to a
    timestamped path `${clerkUserId}/credentials_${Date.now()}.${ext}`, updates the profile
    pointer, best-effort removes the superseded file, writes `audit_log`, then alerts admins.
  - Bucket `coach-credentials`: created in `0002_storage.sql`, capped in
    `0048_storage_limits.sql:56-60` (5 MB; `application/pdf`, `image/jpeg`, `image/png`),
    policies rewritten for Clerk in `0051_clerk_auth.sql:297-320` — insert-own / select-own
    keyed on `(auth.jwt() ->> 'sub') = (storage.foldername(name))[1]`, plus
    `bucket_id = '…' AND public.is_admin()` for admins.
  - Admin review queue: `app/(admin)/coaches/page.tsx` — mints 30-minute signed URLs
    **only** for rows that actually need review (`:26-46`), a deliberate optimization.
- Retention: `lib/credentials-retention.ts` exports `CREDENTIALS_BUCKET`,
  `USER_PARTITIONED_BUCKETS` (currently `coach-credentials`, `team-logos`, `pitch-storage`,
  `visual-pitch-items`, `pitch-media`), `purgeCoachCredentials`, `purgeUserStorage`,
  `sweepUnpurgedCredentials`. `0074_purge_coach_credentials.sql` adds
  `profiles.coach_credentials_purged_at` and the partial index
  `idx_profiles_credentials_pending_purge`. The nightly sweep runs from
  `app/api/cron/expire-submissions/route.ts:76`.
- Column-guard precedent: `guard_submission_writable_columns()` in
  `0064_submissions_policy_hardening.sql:81-190` — a BEFORE INSERT OR UPDATE trigger with an
  explicit allowlist that fails closed, because coach/admin/sponsor all share the
  `authenticated` DB role and neither RLS nor a column GRANT can separate them.
- Sponsor-visibility helper: `sponsor_can_view_team(uuid)` — true when the sponsor has a
  dispatched submission from that team. `v_sponsors_public` (0063) is the precedent for a
  **SECURITY DEFINER view** that re-implements visibility internally.

**What is missing**

No payout table, no EIN, no mailing address, no remittance email, no W-9 document, no
`tax-documents` bucket, no admin verification of any of it, and no way for a sponsor to
learn whether a team is payable. `grep -rn "w9\|W-9\|payout\|remittance" app lib supabase`
returns only the handshake-email prose.

## What you are building

1. Migration `0077_team_payout_profiles.sql`: the `payee_tax_classification` enum, the
   `team_payout_profiles` table + RLS, the column-write guard trigger, the private
   `tax-documents` storage bucket + its four policies, the sponsor-facing
   `v_team_payout_public` SECURITY DEFINER view, and the encrypt/decrypt RPC pair.
2. `lib/schemas/payout.ts` + new keys in `lib/schemas/limits.ts`.
3. `app/actions/payout.ts` — four server actions.
4. `validateTaxDocumentFile` in `app/actions/auth.ts` (PDF-only sibling of
   `validateCredentialFile`).
5. Coach UI: a payout section reachable from the portfolio, plus a W-9 upload page.
6. Admin UI: `/admin/payouts` verification queue + sidebar entry.
7. Retention wiring in `lib/credentials-retention.ts` and the nightly cron.
8. `PAYOUT_ENCRYPTION_KEY` in `lib/env.ts` (and in Vercel before deploy).
9. Tests.

## Data model

### Enum

```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payee_tax_classification') THEN
    CREATE TYPE payee_tax_classification AS ENUM (
      '501c3_org',        -- the team itself holds the determination letter
      'school_district',  -- a public school / district / governmental unit
      'fiscal_sponsor',   -- funds are received by a separate 501(c)(3) on the team's behalf
      'other_nonprofit',  -- e.g. 501(c)(4), booster club with its own EIN
      'unincorporated'    -- no legal entity; individual TIN. Cannot be receipted as charitable.
    );
  END IF;
END $$;
```

### EIN storage — the decision, and why

**Store the EIN encrypted, with a key the database never holds.**

`ein_ciphertext bytea` is written by `pgp_sym_encrypt(p_ein, p_key)` and read only by a
SECURITY DEFINER RPC that takes the key as a parameter. The key lives in
`env.PAYOUT_ENCRYPTION_KEY` (Vercel project env), is passed in per call, and is never
stored in a table, a GUC, or a function body. A stolen database dump therefore yields no
TINs. `ein_last4` is kept in plaintext for display and matching.

Why bother, given that a 501(c)(3)'s EIN is public in IRS Pub 78: because the enum above
admits `school_district`, `other_nonprofit`, and `unincorporated` payees, and for those an
EIN plus a mailing address plus a legal payee name is a complete check-fraud kit. Encrypting
the whole column is simpler and less error-prone than encrypting only some rows.

Cost of this decision, state it plainly in the migration header: a new required env var, a
key that must be present before any payout profile can be written, and no key rotation
tooling (rotation means decrypt-with-old / re-encrypt-with-new in a one-off script — write
that script only when rotation is actually needed).

`pgcrypto` lives in the `extensions` schema on Supabase, so **every function that calls
`pgp_sym_encrypt`/`pgp_sym_decrypt` needs `SET search_path = public, extensions`**
(_CONTEXT §8.5, the lesson of 0059).

### `team_payout_profiles`

```sql
CREATE TABLE IF NOT EXISTS team_payout_profiles (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id                uuid NOT NULL UNIQUE REFERENCES teams(id) ON DELETE CASCADE,

  -- Payee identity (what goes on the check)
  legal_payee_name       text NOT NULL CHECK (char_length(legal_payee_name) BETWEEN 2 AND 200),
  tax_classification     payee_tax_classification NOT NULL,
  ein_ciphertext         bytea,
  ein_last4              text CHECK (ein_last4 IS NULL OR ein_last4 ~ '^[0-9]{4}$'),

  -- Fiscal sponsor path: the team is not its own legal entity, so a separate
  -- organisation receives and receipts the funds.
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

  -- W-9 document, in the private `tax-documents` bucket, keyed {clerkUserId}/…
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

  -- A fiscally sponsored payee must name its sponsor.
  CONSTRAINT payout_fiscal_sponsor_named CHECK (
    NOT is_fiscally_sponsored OR fiscal_sponsor_name IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_payout_profiles_team ON team_payout_profiles(team_id);

-- The admin verification queue reads exactly this predicate. Partial, so it stays small.
CREATE INDEX IF NOT EXISTS idx_payout_profiles_awaiting_review
  ON team_payout_profiles (w9_uploaded_at)
  WHERE w9_uploaded_at IS NOT NULL AND w9_verified_at IS NULL AND w9_rejected_at IS NULL;

-- The renewal sweep reads this one.
CREATE INDEX IF NOT EXISTS idx_payout_profiles_expiring
  ON team_payout_profiles (w9_expires_at)
  WHERE w9_verified_at IS NOT NULL AND w9_expires_at IS NOT NULL;
```

`w9_purged_at` carries exactly the semantics `0074` gave `coach_credentials_purged_at`:
`w9_document_path` NULL + this NULL = never uploaded; NULL + NOT NULL = uploaded, then
destroyed. Add the same `COMMENT ON COLUMN`.

### Who can read what — the exact table

| Column group | Coach (owner) | Admin | Sponsor |
|---|---|---|---|
| `legal_payee_name`, `tax_classification`, `is_fiscally_sponsored`, `fiscal_sponsor_name` | read + write | read + write | **read, via `v_team_payout_public` only** |
| "W-9 on file" (derived: `w9_verified_at IS NOT NULL`) | read | read | **read, via the view only** |
| `ein_last4`, `fiscal_sponsor_ein_last4` | read + write | read | **never** |
| `ein_ciphertext`, `fiscal_sponsor_ein_ciphertext` | opaque bytea, useless without the key | opaque; decrypt only via RPC | **never** |
| `mailing_*`, `remittance_email` | read + write | read | **never** |
| `w9_document_path` and the object behind it | read + write | read (signed URL) | **never — no signed URL is ever minted for a sponsor** |
| `w9_verified_*`, `w9_rejected_*`, `w9_expires_at`, `w9_purged_at` | read only | read + write | **never** |

COPPA note: nothing on this table may identify a student. `legal_payee_name` is an
organisation or, for `unincorporated`, an adult coach — enforce that in the Zod schema's
help text and reject nothing automatically, but never accept a roster, a student name, or a
date of birth here.

### RLS policies

`ALTER TABLE team_payout_profiles ENABLE ROW LEVEL SECURITY;`

- `payout_select_admin` · SELECT · `USING (is_admin())`
- `payout_select_coach` · SELECT · `USING (EXISTS (SELECT 1 FROM teams t WHERE t.id = team_payout_profiles.team_id AND t.owner_id = current_profile_id()))`
- `payout_insert_coach` · INSERT · `WITH CHECK (is_coach_verified() AND EXISTS (SELECT 1 FROM teams t WHERE t.id = team_payout_profiles.team_id AND t.owner_id = current_profile_id()))`
- `payout_update_coach` · UPDATE · same predicate in both `USING` and `WITH CHECK`
- `payout_update_admin` · UPDATE · `USING (is_admin()) WITH CHECK (is_admin())`
- **No DELETE policy for anyone.** A payout profile is removed only by the `ON DELETE
  CASCADE` from `teams`, or by the admin client.
- **No sponsor policy of any kind.** Sponsors do not read this table. They read the view.

### Column-write guard

RLS is row-level, and coach / admin / sponsor all share the `authenticated` DB role — so
policies cannot stop a coach from PATCHing `w9_verified_at` on their own row. Mirror
`guard_submission_writable_columns()` (0064):

```sql
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
BEGIN
  IF is_admin() OR is_trusted_server_context() THEN RETURN NEW; END IF;
  -- compare to_jsonb(OLD) vs to_jsonb(NEW), raise 42501 naming the first
  -- non-allowlisted column that changed. Fails closed: any column added later is
  -- protected until it is added to this list.
  ...
END;
$$;

DROP TRIGGER IF EXISTS guard_payout_profile_writable_columns ON team_payout_profiles;
CREATE TRIGGER guard_payout_profile_writable_columns
  BEFORE INSERT OR UPDATE ON team_payout_profiles
  FOR EACH ROW EXECUTE FUNCTION guard_payout_profile_writable_columns();
```

Read 0064's body first and copy its structure, including its handling of unchanged columns.
This table has no stored generated columns, so 0064's `is_locked` caveat does not apply —
do not carry that code over.

### Sponsor-facing view

```sql
CREATE OR REPLACE VIEW v_team_payout_public
WITH (security_invoker = false) AS      -- definer's rights, like v_sponsors_public (0063)
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
```

No EIN column, no address column, no document path — a sponsor cannot select what the view
does not project. `sponsor_can_view_team()` must stay a function call; inlining it causes
42P17 (0066).

### Encrypt / decrypt RPCs

```sql
set_payout_ein(p_team_id uuid, p_actor_profile_id uuid, p_ein text, p_key text,
               p_target text DEFAULT 'payee')   -- 'payee' | 'fiscal_sponsor'
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions

get_payout_ein(p_team_id uuid, p_key text, p_target text DEFAULT 'payee')
  RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
```

- `set_payout_ein`: resolve the actor with the three-branch pattern
  (`sub` present → assert `current_profile_id() = p_actor_profile_id`;
  else `is_trusted_server_context()` → trust; else `unauthorized`). Require that the actor
  owns the team or `is_admin()`. Normalise the EIN to digits, require exactly 9, write
  `pgp_sym_encrypt(v_digits, p_key)` and `ein_last4 = right(v_digits, 4)`. Never echo the
  EIN in the return value or in `audit_log`.
- `get_payout_ein`: **admin or trusted server only** — no coach path, no sponsor path.
  Returns NULL when the ciphertext is NULL. Wrap the decrypt so a wrong key returns NULL
  rather than raising.
- Both:
  ```sql
  REVOKE EXECUTE ON FUNCTION set_payout_ein(uuid, uuid, text, text, text) FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION set_payout_ein(uuid, uuid, text, text, text) FROM anon;
  REVOKE EXECUTE ON FUNCTION set_payout_ein(uuid, uuid, text, text, text) FROM authenticated;
  GRANT  EXECUTE ON FUNCTION set_payout_ein(uuid, uuid, text, text, text) TO service_role;
  ```
  and the same four lines for `get_payout_ein`.

### Storage bucket `tax-documents`

```sql
insert into storage.buckets (id, name, public)
values ('tax-documents', 'tax-documents', false)
on conflict (id) do nothing;

update storage.buckets
   set file_size_limit = 5242880,                        -- 5 MB
       allowed_mime_types = array['application/pdf']     -- PDF only. A W-9 is a form.
 where id = 'tax-documents';
```

Policies, mirroring `0051_clerk_auth.sql:297-320` exactly (folder = Clerk `sub`):

- `"Coaches can upload their own tax documents"` · INSERT ·
  `WITH CHECK (bucket_id = 'tax-documents' AND (auth.jwt() ->> 'sub') = (storage.foldername(name))[1])`
- `"Coaches can see their own tax documents"` · SELECT · same predicate in `USING`
- `"Coaches can delete their own tax documents"` · DELETE · same predicate
- `"Admins can see all tax documents"` · SELECT ·
  `USING (bucket_id = 'tax-documents' AND public.is_admin())`

No public SELECT policy. No sponsor policy. Every `DROP POLICY IF EXISTS` first, so the
file replays.

## Server actions

New file `app/actions/payout.ts`. Canonical 5-step shape. Zod schemas in
`lib/schemas/payout.ts`, `safeParse` only.

```ts
saveTeamPayoutProfile(data: {
  legalPayeeName: string
  taxClassification: '501c3_org'|'school_district'|'fiscal_sponsor'|'other_nonprofit'|'unincorporated'
  ein?: string                       // 9 digits, dashes tolerated; never round-tripped back to the client
  isFiscallySponsored: boolean
  fiscalSponsorName?: string
  fiscalSponsorEin?: string
  mailingAddressLine1?: string
  mailingAddressLine2?: string
  mailingCity?: string
  mailingState?: string
  mailingPostalCode?: string
  remittanceEmail?: string
}): Promise<{ success?: true; error?: string; code?: string }>
```
- Guard: `requireVerifiedCoach()` — return `e.code` so the UI can show the verification CTA.
- Resolves the caller's team the same way `getCoachTeamId()` does in
  `app/actions/submission.ts:14-34` (most recently updated team owned by the caller).
- Upserts the non-EIN columns with the **server client** (RLS + the guard trigger apply),
  then, if `ein` was supplied, calls `set_payout_ein` with the **admin client** and
  `env.PAYOUT_ENCRYPTION_KEY`.
- Audit action string: `save_team_payout_profile`. Metadata: `{ team_id,
  tax_classification, has_ein: boolean, has_address: boolean }` — **never the EIN, never
  the address**.
- Notification: none. This is self-service editing of one's own record; firing a
  notification on every keystroke-save is noise.
- Changing `legal_payee_name`, `tax_classification`, or either EIN **clears
  `w9_verified_at` / `w9_verified_by`** and re-queues the row for review — the verified
  fact was about the old values. Do this in the action via the admin client and say so in
  the UI ("changing these re-opens verification").

```ts
uploadW9(formData: FormData): Promise<{ success?: true; error?: string }>
```
- Guard: `requireVerifiedCoach()`, plus the same explicit role assertion
  `app/actions/credentials.ts:36` makes.
- Validate with `validateTaxDocumentFile(file)` — see below.
- Upload with the **admin client** to `${clerkUserId}/w9_${Date.now()}.pdf`
  (timestamped path, exactly as `credentials.ts:46` does, so retries never collide and a
  stale reviewer link cannot point at a swapped file).
- Update the profile row: `w9_document_path`, `w9_uploaded_at = now()`,
  `w9_expires_at = now() + interval '3 years'`, clear `w9_verified_at/_by`,
  `w9_rejected_reason/_at`, `w9_renewal_notified_at`, `w9_purged_at`.
- Best-effort remove the superseded object; never block on it (`credentials.ts:77-82`).
- Audit `upload_w9` with `{ team_id, file_path, replaced }`.
- Notify admins with `sendW9UploadAlert` (below).

```ts
verifyTeamPayoutProfile(input: { teamId: string }): Promise<{ success?: true; error?: string }>
rejectTeamPayoutProfile(input: { teamId: string; reason: string }): Promise<{ success?: true; error?: string }>
```
- Guard: `requireAdmin()`.
- `verify`: set `w9_verified_by = user.id`, `w9_verified_at = now()`, clear the rejection
  fields. Audit `verify_team_payout_profile`. Notify the team owner,
  `type: 'general'`, "Your payout details are verified — sponsors can now see that your
  W-9 is on file."
- `reject`: set `w9_rejected_reason`, `w9_rejected_at = now()`, clear `w9_verified_*`.
  Audit `reject_team_payout_profile` with the reason. Notify the team owner with the reason.
  `reason` min 10 chars.
- **Rejection must not delete the document** — the coach needs the admin to be able to look
  at it again, and re-upload replaces it anyway.
- `revalidatePath('/admin/payouts')`, `revalidatePath('/dashboard')`.

### `validateTaxDocumentFile`

Add to `app/actions/auth.ts` beside `validateCredentialFile` (that file is `'use server'`,
so the export must be `async`). Read `validateCredentialFile` first and match it exactly:
same return shape (`{ error?: string; ext?: string }`), same size cap constant, but MIME
allowlist `['application/pdf']` and a magic-byte check for the literal `%PDF-` prefix.
Do not loosen `validateCredentialFile` and reuse it — a W-9 photographed as a JPEG is not
acceptable to an AP department.

### `sendW9UploadAlert` in `lib/notify.ts`

Reuse the existing `CredentialUploadAlert` template — it already accepts `heading` and
`description` overrides (see `sendSponsorApplicationAlert` at `lib/notify.ts:365-392`).
No new email template.

```ts
export async function sendW9UploadAlert(
  teamName: string, coachName: string, coachEmail: string
): Promise<NotifyResult>
```
Recipients from `getAdminNotificationRecipients()`; `reviewUrl` =
`${env.NEXT_PUBLIC_APP_URL}/admin/payouts`. Never throws; returns `NotifyResult`.

### `lib/schemas/limits.ts`

Add:
```ts
  legalPayeeName: 200,
  fiscalSponsorName: 200,
  mailingLine: 200,
  mailingCity: 120,
  remittanceEmail: 254,
  payoutRejectionReason: 1000,
```

## UI

**Coach — payout details**
- New route `app/(coach)/team/payout/page.tsx` (server component: reads the row with the
  server client, redirects to `/login` via `getAuthedProfile()` when unauthed, redirects to
  `/awaiting-verification` when `!coach_verified`).
- New client component `components/coach/payout-profile-form.tsx` (react-hook-form +
  `@hookform/resolvers` + the Zod schema, matching `components/sponsor/sponsor-form.tsx`).
- The EIN input is **write-only**: when a ciphertext exists the field renders as
  `•••••-••{ein_last4}` with a "Replace" button. The server never returns the plaintext to
  a coach.
- A link into it from the Portfolio tab (`components/coach/portfolio-tab.tsx`) — a single
  card titled "Payout & tax details" showing one of: *Not started* / *Awaiting W-9* /
  *In review* / *Verified* / *Needs attention (rejected)*.
- States: **empty** — "Sponsors release funds to a named payee. Add your details to get
  paid." with a primary CTA. **loading** — `loading.tsx` skeleton matching
  `app/(coach)/dashboard/loading.tsx`. **error** — inline `Alert variant="destructive"`
  with the action's error string. **permission-denied** — an unverified coach never reaches
  the form; the portfolio card shows the verification CTA instead.

**Coach — W-9 upload**
- New route `app/(coach)/team/payout/w9/page.tsx`, a near-copy of
  `app/(auth)/upload-credentials/page.tsx`: same dropzone, same client pre-checks (5 MB,
  `application/pdf` only, `accept=".pdf,application/pdf"`), same `useTransition` +
  `sonner` toast + success card. Copy the file and change the copy, the allowlist, and the
  action import — do not try to generalise the existing page into a shared component.
- After success, redirect to `/team/payout`.
- Both routes are authenticated; **do not add them to the `createRouteMatcher` public list
  in `middleware.ts`**.

**Admin — verification queue**
- New route `app/(admin)/payouts/page.tsx` + `components/admin/payout-review-card.tsx`.
- Three sections, exactly like `app/(admin)/coaches/page.tsx`: **In review**
  (`w9_uploaded_at IS NOT NULL AND w9_verified_at IS NULL AND w9_rejected_at IS NULL`),
  **Verified**, **Awaiting upload / rejected**.
- Mint a 30-minute signed URL **only** for rows in the first section — carry over the
  optimization and the comment from `coaches/page.tsx:26-33`.
- Show `ein_last4` and the mailing address to the admin (they are verifying them against
  the document). Full EIN is available through a "Reveal EIN" control that calls a
  `requireAdmin()` action wrapping `get_payout_ein`; each reveal writes an
  `audit_log` row with action `reveal_payout_ein`.
- Add `{ label: 'Payouts', href: '/admin/payouts', icon: Receipt, exact: false, badge: false }`
  to the nav array in `components/admin/admin-sidebar.tsx:29-34`, after "Teams".
- States: **empty** — `EmptyState` "Nothing awaiting review." **loading** — `loading.tsx`.
  **error** — if the signed-URL mint fails, render the card with a disabled viewer and the
  reason, never a broken link. **permission-denied** — the `(admin)` group's existing guard
  covers it; do not add a second check.

## Out of scope

- Fulfillment status, payment tracking, receipts — prompts 01, 03, 04.
- Blocking a settle or a dispatch on "W-9 on file". This slice **collects and exposes** the
  fact; making it a gate is a product decision for a later prompt. Do not add the gate.
- Any change to `teams.tax_status`. It stays where it is; `tax_classification` is the
  finance-grade field and the two are allowed to disagree until an admin verifies.
- Key rotation tooling.
- 1099 generation, backup-withholding logic, TIN matching against the IRS API.
- Touching `coach-credentials`, `purgeCoachCredentials`, or the coach photo-ID flow beyond
  adding the new bucket to `USER_PARTITIONED_BUCKETS`.

## Guardrails specific to this slice

1. **Never `auth.uid()`.** `0002_storage.sql` still contains it in its original policies —
   that file is historical; 0051 replaced those policies. Write the new bucket's policies
   against `(auth.jwt() ->> 'sub')` from the start.
2. **`SET search_path = public, extensions`** on both EIN functions — pgcrypto is not in
   `public` (0059).
3. **REVOKE EXECUTE FROM PUBLIC, anon, authenticated; GRANT TO service_role** on
   `set_payout_ein` and `get_payout_ein`. Do **not** revoke on anything called from inside
   an RLS policy.
4. **The retention rule here is the opposite of the credentials rule.** A photo ID is
   evidence for one decision and is destroyed after it (0074). A W-9 is a business record
   the sponsor's auditors may need for years. **Do not purge a W-9 on verification.** Do
   not add it to `sweepUnpurgedCredentials`. What you *do* add:
   - `'tax-documents'` to `USER_PARTITIONED_BUCKETS` in `lib/credentials-retention.ts`, so
     account deletion (`purgeUserStorage`) removes it — "delete my account" must not leave
     a TIN document behind.
   - `purgeTeamW9(admin, teamId, path)` next to `purgeCoachCredentials`, same
     storage-first-then-pointer ordering and the same best-effort semantics, setting
     `w9_purged_at`. Called only from account deletion / an explicit admin request.
   - `sweepExpiringW9s(admin)` in a new `lib/payout-retention.ts`, invoked from
     `app/api/cron/expire-submissions/route.ts` alongside the existing
     `sweepUnpurgedCredentials` call at `:76`: for rows with
     `w9_verified_at IS NOT NULL AND w9_expires_at < now() + interval '60 days' AND
     w9_renewal_notified_at IS NULL`, send one `createInAppNotification` and stamp
     `w9_renewal_notified_at`. One notice per W-9, ever. Add its counts to the existing
     cron `audit_log` metadata at `:112-123`. **Do not add a second cron route** — this
     rides the existing daily job.
5. **A sponsor must never receive a signed URL for a `tax-documents` object.** There is no
   code path that mints one for a non-admin. Assert it in a test.
6. **Never write the EIN or the mailing address into `audit_log.metadata`, a notification
   body, an email, or a `console.log`.**
7. **`PAYOUT_ENCRYPTION_KEY` must be added to `lib/env.ts`** (it warns in dev, throws in
   prod) **and set in Vercel before deploying**, or the first payout save throws.
   Minimum 32 characters; validate that in the Zod env schema.
8. **COPPA:** no student names, ages, or photos on this table or in the bucket. A W-9 is an
   organisational tax form; if a coach uploads a roster by mistake the admin rejects it.
9. The column-write guard fails closed — every column you add later is unwritable by
   coaches until it is added to the allowlist. Say so in the function's `COMMENT`.
10. Sponsors read `v_team_payout_public` and nothing else. If a page needs a payout field a
    sponsor may see, add it to the view — never add a sponsor policy to the base table.

## Files you will touch

**Create:**
- `supabase/migrations/0077_team_payout_profiles.sql`
- `lib/schemas/payout.ts`
- `lib/payout-retention.ts`
- `app/actions/payout.ts`
- `app/(coach)/team/payout/page.tsx`
- `app/(coach)/team/payout/loading.tsx`
- `app/(coach)/team/payout/w9/page.tsx`
- `components/coach/payout-profile-form.tsx`
- `app/(admin)/payouts/page.tsx`
- `app/(admin)/payouts/loading.tsx`
- `components/admin/payout-review-card.tsx`
- `lib/__tests__/payout-schema.test.ts`
- `tests/e2e/payout-w9.spec.ts`

**Modify:**
- `lib/schemas/limits.ts`
- `lib/env.ts` (`PAYOUT_ENCRYPTION_KEY`)
- `lib/notify.ts` (`sendW9UploadAlert`)
- `app/actions/auth.ts` (`validateTaxDocumentFile`)
- `lib/credentials-retention.ts` (`USER_PARTITIONED_BUCKETS`, `purgeTeamW9`)
- `app/api/cron/expire-submissions/route.ts` (call `sweepExpiringW9s`, extend the audit metadata)
- `components/admin/admin-sidebar.tsx` (nav entry)
- `components/coach/portfolio-tab.tsx` (payout status card + link)
- `lib/supabase/types.ts`

## Tests

**Unit — `lib/__tests__/payout-schema.test.ts` (Vitest):**
- EIN normalisation: `12-3456789`, `123456789`, `12 345 6789` all accept and yield
  `last4 = '6789'`; 8 or 10 digits reject; letters reject.
- `mailingPostalCode` accepts `75024` and `75024-1234`, rejects `7502` and `ABCDE`.
- `isFiscallySponsored: true` without `fiscalSponsorName` fails validation with a readable
  message (mirrors the DB CHECK).
- Every max length comes from `LIMITS` — assert by reference, not by literal.

**Unit — `lib/__tests__/credentials-retention.test.ts` (extend the existing file):**
- `USER_PARTITIONED_BUCKETS` contains `'tax-documents'`.
- `purgeTeamW9` deletes storage before clearing the pointer, and leaves the pointer intact
  when the storage delete fails (same assertions the file already makes for
  `purgeCoachCredentials`).

**E2E — `tests/e2e/payout-w9.spec.ts` (Playwright). Security boundaries are mandatory:**
- Coach saves a payout profile → row created, `ein_last4` set, `ein_ciphertext` non-null,
  and a direct read of `ein_ciphertext` is not the EIN in plaintext.
- **A coach PATCHing `w9_verified_at` on their own row via PostgREST is rejected by the
  guard trigger (42501), and the value is unchanged.**
- **Coach of Team X reading `team_payout_profiles` sees only their own row; Team Y's row is
  absent.**
- **A sponsor selecting `team_payout_profiles` over PostgREST gets `[]`, even for a team
  they have a dispatched submission from.**
- **A sponsor selecting `v_team_payout_public` for such a team gets exactly
  `team_id, legal_payee_name, tax_classification, is_fiscally_sponsored,
  fiscal_sponsor_name, w9_on_file, w9_verified_at` — and the response contains no `ein`,
  no `mailing`, no `w9_document_path` key.**
- **A sponsor selecting `v_team_payout_public` for a team they have NOT been dispatched
  gets `[]`.**
- **Anon gets `[]` from both the table and the view.**
- W-9 upload: a PDF succeeds; a JPEG is refused by `validateTaxDocumentFile`; a renamed
  JPEG with a `.pdf` extension is refused by the magic-byte check.
- **A sponsor requesting a signed URL for a `tax-documents` object is denied by storage RLS.**
- Admin verifies → `w9_on_file` flips to true in the sponsor's view; the coach receives a
  notification.
- Coach then edits `legal_payee_name` → `w9_verified_at` is cleared and the row is back in
  the review queue.
- Admin rejects with a reason → the coach sees the reason; the document still exists.

## Acceptance criteria

- [ ] A verified coach can save a payout profile, and `ein_ciphertext` in the database does
      not contain the EIN in readable form.
- [ ] `get_payout_ein` returns the correct EIN for an admin with the right key, and NULL
      with a wrong key — it never raises.
- [ ] A coach cannot set `w9_verified_at`, `w9_verified_by`, `w9_rejected_at`, or
      `w9_purged_at` on their own row; the attempt fails with 42501.
- [ ] A sponsor viewing a team they have been dispatched sees the legal payee name and
      "W-9 on file: yes/no", and cannot obtain the EIN, the mailing address, or the document
      by any route including a direct PostgREST call.
- [ ] A sponsor who has never been dispatched a submission from a team sees nothing about
      that team's payout profile.
- [ ] Uploading a non-PDF is rejected before anything reaches storage.
- [ ] The `tax-documents` bucket is private, capped at 5 MB, `application/pdf` only, and
      objects are partitioned by Clerk user id.
- [ ] An admin verifying a W-9 notifies the coach in-app and by email.
- [ ] Editing the legal payee name after verification re-queues the row for review.
- [ ] Deleting a Clerk account removes that user's `tax-documents` objects
      (`purgeUserStorage` covers the bucket).
- [ ] A W-9 is **not** deleted when it is verified — verify a coach and confirm the object
      is still in the bucket.
- [ ] A W-9 within 60 days of `w9_expires_at` produces exactly one renewal notice across
      two consecutive cron runs.
- [ ] `PAYOUT_ENCRYPTION_KEY` is validated in `lib/env.ts` and set in Vercel before deploy.
- [ ] The migration applies cleanly twice in a row with `psql -f`.
- [ ] `npm run typecheck && npm run lint && npm run build && npm run test` all pass.

## Rollback

```sql
BEGIN;

DROP TRIGGER  IF EXISTS guard_payout_profile_writable_columns ON team_payout_profiles;
DROP FUNCTION IF EXISTS guard_payout_profile_writable_columns();

DROP VIEW IF EXISTS v_team_payout_public;

DROP FUNCTION IF EXISTS get_payout_ein(uuid, text, text);
DROP FUNCTION IF EXISTS set_payout_ein(uuid, uuid, text, text, text);

DROP TABLE IF EXISTS team_payout_profiles;
DROP TYPE  IF EXISTS payee_tax_classification;

-- Storage policies (objects in the bucket are NOT deleted by this; see below).
DROP POLICY IF EXISTS "Coaches can upload their own tax documents" ON storage.objects;
DROP POLICY IF EXISTS "Coaches can see their own tax documents"    ON storage.objects;
DROP POLICY IF EXISTS "Coaches can delete their own tax documents" ON storage.objects;
DROP POLICY IF EXISTS "Admins can see all tax documents"           ON storage.objects;

COMMIT;
```

The `tax-documents` bucket is deliberately **not** dropped: `storage.buckets` deletion fails
while objects exist, and silently destroying tax records during a rollback is worse than
leaving an unreferenced bucket. To remove it deliberately, empty it first
(`supabase storage rm --recursive ss://tax-documents`) then
`delete from storage.buckets where id = 'tax-documents';`.

Revert the code with `git revert` of this prompt's commit. `PAYOUT_ENCRYPTION_KEY` may stay
in Vercel; it is inert without the RPCs.

## Commit

```
feat(payouts): collect verified W-9 and payee details per team

A sponsor's AP department will not release funds without a W-9, a legal
payee name, a TIN and a remittance address, and today the platform holds
none of it — teams.tax_status is a self-selected three-value enum and the
paperwork happens over email. Adds team_payout_profiles with the EIN
encrypted at rest under an app-held key, a private PDF-only tax-documents
bucket partitioned by Clerk user id, a column-write guard so coaches
cannot self-verify, an admin verification queue, and a sponsor-facing view
that exposes only the payee name and whether a W-9 is on file.
```
