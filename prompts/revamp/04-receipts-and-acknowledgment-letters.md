# Prompt 04 — Donation receipts and acknowledgment letters

> **Prerequisites:** `01` (the `funding_fulfillments` state machine), `02` (the team payout profile)
> **Reserved migration:** `0078_funding_receipts.sql` — verify it is still free with `ls supabase/migrations | tail -3`
> **Scope:** large · ~16 files
> **Leaves the repo:** green and shippable on its own

## Why this exists

A sponsor's controller closes the books and needs one document per gift: the payee's legal
name, its EIN, the date, the amount, and the sentence that makes the deduction stand up —
"no goods or services were provided in exchange for this contribution." IRS Publication 1771
requires a contemporaneous written acknowledgment for any single contribution of $250 or
more, and no acknowledgment means no deduction, whatever the bank statement says.

The platform issues nothing. Prompt `01` gave `funding_fulfillments` a `receipted` status and
prompt `01`'s own transition table notes that "`receipted` is issued by prompt 04's
`issue_funding_receipt`, which PERFORMs this RPC. Until 04 lands, nothing reaches
`receipted`." Prompt `01` also left a literal marker at the end of `confirmPaymentReceived`:
`// prompt 04 hooks receipt issuance in here`. This is that prompt.

## ⚠️ The tax language in this prompt is a draft, not advice

Read this before you write a line of copy.

- **Getting the wording wrong creates real tax liability for the sponsor.** An
  acknowledgment that omits the goods-and-services statement, or that asserts
  deductibility for a payee that is not a qualified organisation, can cause the sponsor's
  deduction to be disallowed on audit — plus interest and penalties on the underpayment.
  The sponsor relied on a document this platform generated.
- **It also exposes the team.** A school district or a booster club that issues a receipt
  claiming 501(c)(3) status it does not hold has made a false statement to a donor.
- **The drafted language below must be reviewed by an attorney or a CPA before launch.**
  It is a starting point written by a software engineer reading Pub 1771. It is not legal or
  tax advice and must not be presented to a user as either.

To make that impossible to forget rather than merely documented, the copy module exports:

```ts
/** ISO date on which counsel signed off on the template copy. NULL until they have. */
export const RECEIPT_COPY_REVIEWED_AT: string | null = null
```

While it is `null`, every rendered document carries a visible banner at the top —
**"DRAFT — this acknowledgment uses template language that has not been reviewed by
counsel."** — and that banner is baked into the stored, immutable HTML. A document issued
before review says so forever, which is the correct behaviour: back-dating a claim of legal
review is worse than the draft. Do **not** remove the banner by editing the template. The
only way to clear it is to set `RECEIPT_COPY_REVIEWED_AT` to a real date, and that is a
human decision, not a code change an agent makes.

Every generated document also carries the footer:

> Prepared through FTC Pitfund on behalf of {payeeLegalName}. FTC Pitfund is not a party to
> this contribution and does not provide tax advice.

The receipt is issued **by the team to the sponsor**. The platform is the record-keeper, not
the donee. Keep that framing in every string.

## Current state (verified)

**What exists after `01` and `02`**

- `funding_fulfillments` with `status fulfillment_status` (`pledged`, `agreement_signed`,
  `payment_sent`, `payment_received`, `receipted`, `cancelled`), `amount_cents`,
  `transaction_id UNIQUE`, `sponsor_id NOT NULL`, nullable `team_id` / `submission_id`
  (`ON DELETE SET NULL`, mirroring `0061`), and `payment_received_at`.
- `record_fulfillment_transition(p_fulfillment_id, p_actor_profile_id, p_to_status,
  p_payment_method, p_payment_reference, p_occurred_on, p_note) RETURNS jsonb` —
  SECURITY DEFINER, EXECUTE revoked from `PUBLIC`/`anon`/`authenticated`, granted to
  `service_role`. Its transition table allows `payment_received → receipted` for
  **admin** and **system**, and treats `receipted` as terminal.
- `can_read_fulfillment(uuid)` — SECURITY DEFINER, STABLE, deliberately **not** revoked
  because RLS policies evaluate it as the calling role. It already encodes
  admin / owning-sponsor / owning-coach.
- `funding_fulfillment_events` — append-only, SELECT via `can_read_fulfillment`.
- `app/actions/fulfillment.ts` → `confirmPaymentReceived`, ending in the prompt-04 marker.
- `team_payout_profiles` (`0077`) with `legal_payee_name`, `tax_classification`
  (`501c3_org` | `school_district` | `fiscal_sponsor` | `other_nonprofit` |
  `unincorporated`), `ein_ciphertext bytea`, `ein_last4`, `is_fiscally_sponsored`,
  `fiscal_sponsor_name`, `w9_verified_at`, and `get_payout_ein(p_team_id, p_key, p_target)`
  — **admin or trusted-server only**, `SET search_path = public, extensions`, EXECUTE
  revoked and granted to `service_role`.
- `env.PAYOUT_ENCRYPTION_KEY` in `lib/env.ts`.
- Prompt `03`'s surfaces: the sponsor funding tracker, the coach Funding tab, and
  `/reconciliation`. This slice adds links and controls to all three.

**What exists in the app**

- `teams.tax_status` is enum `tax_status_type` (`501c3` | `School` | `None`), **self-selected
  by the coach** and written at auto-provisioning from untrusted
  `profiles.pending_team_data` (`app/(coach)/dashboard/page.tsx:117-118`).
- `@react-email/components` **and `@react-email/render`** are already dependencies
  (`package.json`). `emails/notification-email.tsx` is the neutral transactional template to
  match; `emails/handshake-email.tsx` shows the `Section`-based summary-box idiom.
- `lib/notify.ts` — `:24` `NotifyResult` (no sender ever throws), `:46-58` `sendViaResend`,
  `:201-222` the `replyTo` + `createHash(...).digest('hex')` idempotency-key pattern.
- `lib/errors.ts:15-52` `mapDbError`.
- `middleware.ts:5-18` — the public matcher. **`/receipts` is not in it and must not be
  added**; a receipt is authenticated.
- `app/(sponsor)/sponsor/submissions/[id]/not-found.tsx` — the `notFound()` precedent.
- **There are no sequences anywhere in the schema.** `grep -rln "CREATE SEQUENCE\|nextval"
  supabase/migrations` returns nothing. The counter this slice adds is the first one.

**What is missing**

`grep -rn "receipt\|acknowledg\|1771\|deductib" app lib emails supabase` returns only the
`Receipt` lucide icon. No receipt table, no numbering, no document, no PDF story, no void
semantics, nothing that reaches `fulfillment_status = 'receipted'`.

## What you are building

1. Migration `0078_funding_receipts.sql`: two enums, `funding_receipts`,
   `funding_receipt_counters`, RLS on both, `issue_funding_receipt(...)`,
   `void_funding_receipt(...)`, and the REVOKE/GRANT block on both functions.
2. `lib/receipt-copy.ts` — variant resolution, the three copy variants, the number
   formatter, and `RECEIPT_COPY_REVIEWED_AT`. Pure; no React, no DB.
3. `lib/receipt-document.tsx` — one shared `ReceiptDocumentBody` component and
   `renderReceiptDocument(ctx) → { html, sha256 }`.
4. `emails/funding-receipt-email.tsx` — the email shell around that body.
5. `lib/receipts.ts` — `generateAndStoreReceipt(...)`, the non-action orchestrator called
   both by the admin action and by `confirmPaymentReceived`.
6. `app/actions/receipt.ts` — `issueReceiptForFulfillment`, `voidReceipt`, `reissueReceipt`,
   `resendReceiptEmail`.
7. `app/receipts/[receiptNumber]/page.tsx` — the shared, authenticated, print-optimised
   document view.
8. Links and controls on the three prompt-`03` surfaces.
9. Fixtures and tests.

**No new env var. No new dependency.** See the document-format decision below.

## Document format — the decision

**Render HTML from React Email, store it immutably, email it, and give both parties a
print-optimised page whose browser "Save as PDF" produces the archival copy. Do not add a
PDF library.**

`@react-email/render` is already installed, so `render(<ReceiptDocumentBody {...ctx} />,
{ pretty: false })` gives a deterministic HTML string with zero new dependencies. One
renderer feeds three destinations — the row stored in Postgres, the email body, and the
print page — so all three are byte-identical by construction rather than by discipline.

The honest tradeoff against `@react-pdf/renderer`:

| | HTML + browser print | `@react-pdf/renderer` |
|---|---|---|
| New dependency | none | a large one, with its own font/layout engine |
| Serverless bundle | unchanged | meaningfully larger; a real risk on Vercel Hobby, where this project already pins `jsdom`/`cssstyle` overrides to fix an `ERR_REQUIRE_ESM` in the bundle |
| Byte-identical email and archive | yes, one renderer | no — two renderers, two layouts, two things to keep in sync |
| Fidelity of the archived file | depends on the printing browser's margins and headers | pixel-identical everywhere |
| Attachable to the email | no — the email *is* the document | yes, a real `.pdf` attachment |
| Tamper evidence | SHA-256 over the stored HTML, re-verified on render | same, over the PDF bytes |

The one thing HTML genuinely loses is a file the controller can drag into a folder without
thinking. That is a real cost and worth naming — but a browser's Save-as-PDF is one keystroke
away, the sponsor already has the document in their inbox as a searchable email, and the
legally operative content is the text, not its container. Pub 1771 requires a *written*
acknowledgment; it does not require a PDF.

**Decision: HTML.** If a customer later demands attached PDFs, the swap is contained —
`renderReceiptDocument` gains a second output and `sendFundingReceiptEmail` gains an
`attachments` array. Nothing else in this design has to move. Do not pre-build for that.

## Data model

### Enums

```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'receipt_status') THEN
    CREATE TYPE receipt_status AS ENUM ('issued', 'voided');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'receipt_variant') THEN
    CREATE TYPE receipt_variant AS ENUM (
      'charitable_501c3',      -- Pub 1771 acknowledgment; asserts deductibility
      'governmental_school',   -- public school / governmental unit; makes NO deductibility claim
      'non_charitable'         -- payment record only; explicitly not a charitable receipt
    );
  END IF;
END $$;
```

All values declared at type creation so a from-scratch replay works (_CONTEXT §8.1).

### `funding_receipts`

```sql
CREATE TABLE IF NOT EXISTS funding_receipts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Human-readable, gap-free per year. See "Receipt numbering" below.
  receipt_number     text NOT NULL UNIQUE,

  -- RESTRICT on both: a receipt is a tax record. Nothing may delete the thing it documents
  -- out from under it. The ledger is append-only and fulfillments are never deleted, so
  -- this can only fail if someone is breaking one of those invariants.
  fulfillment_id     uuid NOT NULL REFERENCES funding_fulfillments(id)  ON DELETE RESTRICT,
  transaction_id     uuid NOT NULL REFERENCES transactions_ledger(id)   ON DELETE RESTRICT,
  sponsor_id         uuid NOT NULL REFERENCES sponsors(id)              ON DELETE RESTRICT,
  -- Mirrors the nullability of funding_fulfillments.team_id (0061/0076): Clerk account
  -- deletion cascades and runs no app code, and must not be blocked by this table.
  team_id            uuid          REFERENCES teams(id)                 ON DELETE SET NULL,

  -- ── Denormalised ON PURPOSE ────────────────────────────────────────────────────────
  -- A receipt is a point-in-time legal record. If the team renames itself, edits its
  -- payout profile, or the sponsor rebrands next season, the ISSUED document must not
  -- change. NEVER join these back to the live rows when rendering or re-rendering.
  amount_cents       bigint NOT NULL CHECK (amount_cents > 0),
  contribution_date  date   NOT NULL,
  variant            receipt_variant NOT NULL,
  payee_legal_name   text   NOT NULL CHECK (char_length(payee_legal_name) BETWEEN 2 AND 200),
  payee_ein_last4    text   CHECK (payee_ein_last4 IS NULL OR payee_ein_last4 ~ '^[0-9]{4}$'),
  payee_tax_classification text,
  sponsor_legal_name text   NOT NULL CHECK (char_length(sponsor_legal_name) BETWEEN 1 AND 200),
  sponsor_contact_email    text,

  -- Pub 1771 quid-pro-quo disclosure. NULL = nothing was provided in exchange, which is
  -- what makes the "no goods or services" sentence true. Prompt 14 (recognition tiers) is
  -- the first thing that can make it false — see "Interaction with prompts 14 and 15".
  goods_or_services_description text CHECK (goods_or_services_description IS NULL
                                            OR char_length(goods_or_services_description) <= 1000),
  goods_or_services_fmv_cents   bigint CHECK (goods_or_services_fmv_cents IS NULL
                                              OR goods_or_services_fmv_cents >= 0),

  -- The document itself. Immutable once written.
  document_html      text NOT NULL,
  document_sha256    text NOT NULL CHECK (document_sha256 ~ '^[0-9a-f]{64}$'),
  copy_version       text NOT NULL,          -- RECEIPT_COPY_VERSION at issue time
  copy_reviewed_at   timestamptz,            -- NULL = issued while the copy was still a draft

  status             receipt_status NOT NULL DEFAULT 'issued',
  issued_at          timestamptz NOT NULL DEFAULT now(),
  issued_by          uuid REFERENCES profiles(id) ON DELETE SET NULL,   -- NULL = system
  emailed_at         timestamptz,

  voided_at          timestamptz,
  voided_by          uuid REFERENCES profiles(id) ON DELETE SET NULL,
  voided_reason      text CHECK (voided_reason IS NULL OR char_length(voided_reason) <= 1000),

  -- Void + reissue pairing. A receipt is NEVER edited.
  supersedes_receipt_id    uuid REFERENCES funding_receipts(id) ON DELETE RESTRICT,
  superseded_by_receipt_id uuid REFERENCES funding_receipts(id) ON DELETE RESTRICT,

  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT receipt_void_fields_together CHECK (
    (status = 'issued' AND voided_at IS NULL AND voided_reason IS NULL)
    OR (status = 'voided' AND voided_at IS NOT NULL AND voided_reason IS NOT NULL)
  ),
  CONSTRAINT receipt_fmv_requires_description CHECK (
    goods_or_services_fmv_cents IS NULL OR goods_or_services_description IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_receipts_sponsor     ON funding_receipts(sponsor_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_receipts_team        ON funding_receipts(team_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_receipts_fulfillment ON funding_receipts(fulfillment_id);

-- At most ONE live receipt per fulfillment. A voided one does not block a reissue.
-- This is the enforcement point for "no duplicate receipts", not an application check.
CREATE UNIQUE INDEX IF NOT EXISTS uq_receipt_live_per_fulfillment
  ON funding_receipts(fulfillment_id) WHERE status = 'issued';
```

### The EIN, and what storing a receipt costs prompt `02`

Prompt `02` encrypts the EIN so that a stolen database dump yields no TINs. **Issuing a
501(c)(3) acknowledgment necessarily undoes part of that**, because the EIN has to be
printed on the document, and the document is stored. Say so out loud in the migration header
rather than letting a future reader discover it.

The bounded version of that cost:

- The full EIN lives **only inside `document_html`**, never in its own column. There is no
  `payee_ein_full`. The structured field is `payee_ein_last4`, which prompt `02` already
  keeps in plaintext for display.
- `document_html` is readable only by the two parties and an admin, through the same
  `can_read_fulfillment` predicate that guards the fulfillment itself.
- The EIN is printed **only** for `charitable_501c3` and `governmental_school`, i.e. only for
  organisational EINs — which are public in the IRS Tax Exempt Organization Search for
  exactly these entities.
- **An `unincorporated` payee's TIN is an individual's SSN. It is never printed, not even the
  last four, and that variant is `non_charitable` anyway.** This is a hard rule, not a
  default.

So the residual exposure is: organisational EINs, for teams that have actually been paid,
readable by the people who paid them. That is acceptable. An individual's SSN never enters
the table.

### `funding_receipt_counters`

```sql
CREATE TABLE IF NOT EXISTS funding_receipt_counters (
  year       int    PRIMARY KEY,
  last_value bigint NOT NULL DEFAULT 0 CHECK (last_value >= 0)
);
ALTER TABLE funding_receipt_counters ENABLE ROW LEVEL SECURITY;
-- No policies at all: deny-all for every non-service role, exactly like request_throttle
-- and submission_access_tokens. Only the SECURITY DEFINER issuance function touches it.
```

### Receipt numbering — format, uniqueness, and gap-freedom

**Format: `PF-{YYYY}-{NNNNNN}`** — e.g. `PF-2026-000123`. `YYYY` is the UTC year of
`issued_at`; `NNNNNN` is a zero-padded per-year counter starting at `1`. It is short enough
to read over the phone, sorts correctly as text within a year, obviously identifies a
document rather than a record id, and leaks nothing — no team id, no sponsor id, no volume
signal beyond the count of receipts, which a recipient can see anyway.

**A Postgres `SEQUENCE` cannot deliver this.** `nextval` is deliberately non-transactional:
a rolled-back transaction burns its number and leaves a hole. An auditor asking "where is
`PF-2026-000041`?" and being told "a transaction failed" is a bad conversation. So:

```plpgsql
  v_year := EXTRACT(YEAR FROM now() AT TIME ZONE 'utc')::int;

  INSERT INTO funding_receipt_counters (year, last_value)
  VALUES (v_year, 0)
  ON CONFLICT (year) DO NOTHING;

  UPDATE funding_receipt_counters
     SET last_value = last_value + 1
   WHERE year = v_year
  RETURNING last_value INTO v_seq;

  v_number := 'PF-' || v_year::text || '-' || lpad(v_seq::text, 6, '0');
```

Why this is correct:

- **Unique under concurrency.** `UPDATE … RETURNING` takes a row-level lock on the single
  counter row for the year. A second issuance blocks on that lock until the first commits or
  rolls back, then reads the updated value. Two callers can never observe the same
  `last_value`. `receipt_number text NOT NULL UNIQUE` is the belt-and-braces backstop, not
  the mechanism.
- **Gap-free.** The increment and the `INSERT INTO funding_receipts` are in the same
  transaction. Commit → the number is consumed *and* the receipt exists. Any failure after
  the increment — a hash mismatch, a failed transition, a constraint violation — rolls the
  increment back with everything else. There is no path that consumes a number without
  producing a row.
- **Cost, stated plainly.** All issuance for a given year serialises on one row. At this
  product's volume (hundreds of receipts a year) the lock is held for microseconds and this
  is free. If it ever became a bottleneck the fix is to accept gaps and switch to a sequence
  — a deliberate trade, not an accident. Put that sentence in the function's `COMMENT`.
- **A void does not reuse a number.** Gap-freedom is a property of the *issued sequence*, not
  of the currently-valid set. `PF-2026-000041` voided and reissued as `PF-2026-000042` is
  correct and auditable; silently re-minting `…041` is not.

### RLS

```sql
ALTER TABLE funding_receipts ENABLE ROW LEVEL SECURITY;
```

- `receipts_select` · SELECT · `USING (can_read_fulfillment(fulfillment_id))`

**Reuse prompt `01`'s helper verbatim.** It already resolves admin / owning sponsor / owning
coach, and it is a function specifically so the planner does not evaluate
`funding_fulfillments`' own policies from inside this one — the 42P17 class of bug that
`0066` exists to avoid (_CONTEXT §8.8). Do not write a second inline predicate here, and do
not revoke EXECUTE on `can_read_fulfillment` (prompt `01` guardrail 3: it runs inside an RLS
policy as the calling role, and revoking makes every read raise 42501).

- **No INSERT, UPDATE, or DELETE policy on `funding_receipts`, for anyone.** Every write is
  service-role through the two RPCs. This mirrors `transactions_ledger`, `audit_log`, and
  `funding_fulfillments`.
- **No policies at all on `funding_receipt_counters`.**

### `issue_funding_receipt`

```sql
issue_funding_receipt(
  p_fulfillment_id           uuid,
  p_actor_profile_id         uuid,               -- NULL = system
  p_variant                  receipt_variant,
  p_payee_legal_name         text,
  p_payee_ein_last4          text,
  p_payee_tax_classification text,
  p_sponsor_legal_name       text,
  p_sponsor_contact_email    text,
  p_goods_or_services        text,
  p_goods_or_services_fmv_cents bigint,
  p_document_html            text,
  p_document_sha256          text,
  p_copy_version             text,
  p_copy_reviewed_at         timestamptz,
  p_supersedes_receipt_id    uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
```

**Why the RPC takes rendered HTML instead of rendering it:** the document is a React Email
component rendered in Node. Postgres cannot produce it. So the split is — the application
renders and hashes; the database does the part that must be atomic: lock, validate, mint the
number, insert, transition, audit. `SET search_path = public, extensions` is required because
step 5 calls `digest` and pgcrypto lives in `extensions` (_CONTEXT §8.5, the lesson of
`0059`).

Body, in order:

1. **Actor resolution — the three-branch form**, identical to prompt `01`'s
   `record_fulfillment_transition`:
   ```plpgsql
   IF (auth.jwt() ->> 'sub') IS NOT NULL THEN
     v_actor := current_profile_id();
     IF v_actor IS NULL OR v_actor IS DISTINCT FROM p_actor_profile_id THEN
       RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
     END IF;
   ELSIF is_trusted_server_context() THEN
     v_actor := p_actor_profile_id;   -- may be NULL: the system path
   ELSE
     RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
   END IF;
   ```
   Never `(auth.jwt()->>'sub') IS NULL` on its own — `0072` documents that the anon key
   satisfies it and the test fails open.
2. **Only admins and the system issue receipts.** If `v_actor IS NOT NULL` and that profile's
   role is not `admin`, return `unauthorized`. There is no coach path and no sponsor path.
3. `SELECT * INTO v_f FROM funding_fulfillments WHERE id = p_fulfillment_id FOR UPDATE;`
   → not found: `fulfillment_not_found`.
4. **State gate.** Accept either:
   - `v_f.status = 'payment_received'` (first issuance), or
   - `v_f.status = 'receipted'` **and** `p_supersedes_receipt_id IS NOT NULL` **and** that
     receipt exists, belongs to this fulfillment, and has `status = 'voided'` (a reissue).

   Anything else → `not_receiptable`, with the observed status in the JSON.
5. **Idempotency.** If a live receipt already exists for this fulfillment and
   `p_supersedes_receipt_id IS NULL`, return
   `jsonb_build_object('ok', true, 'already_issued', true, 'receipt_id', …, 'receipt_number', …)`.
   `confirmPaymentReceived` can be retried; a retry must not mint a second number.
6. **Integrity check.**
   `IF p_document_sha256 IS DISTINCT FROM encode(digest(p_document_html, 'sha256'), 'hex') THEN
   RETURN … 'document_hash_mismatch'; END IF;` — this is what makes the hash stored on the
   row meaningful later.
7. **Mint the number** with the counter block above.
8. **INSERT** the receipt. `contribution_date := (v_f.payment_received_at AT TIME ZONE 'utc')::date`
   — the contribution date is when the money landed, not when the paperwork was generated.
   `amount_cents := v_f.amount_cents` (from the row, never from a parameter — a caller must
   not be able to state a different amount than was actually pledged).
   `issued_by := v_actor`. Set `supersedes_receipt_id` when reissuing, and
   `UPDATE funding_receipts SET superseded_by_receipt_id = <new id> WHERE id = p_supersedes_receipt_id;`
9. **Transition**, only when `v_f.status = 'payment_received'` (skip it on a reissue, which is
   already `receipted`):
   ```plpgsql
   v_txn := record_fulfillment_transition(
     p_fulfillment_id   := p_fulfillment_id,
     p_actor_profile_id := p_actor_profile_id,
     p_to_status        := 'receipted',
     p_note             := 'Receipt ' || v_number || ' issued'
   );
   IF NOT (v_txn ->> 'ok')::boolean AND (v_txn ->> 'error') <> 'already_in_status' THEN
     RAISE EXCEPTION 'receipt_transition_failed: %', v_txn ->> 'error';
   END IF;
   ```
   Use **named notation** — the function has seven parameters and three trailing NULLs would
   otherwise need explicit casts to resolve. `RAISE`, do not return: a receipt that exists
   while the fulfillment still says `payment_received` is a split-brain, and the RAISE rolls
   back the counter increment along with the insert, preserving gap-freedom.
10. **Audit**, via a direct insert (this function already runs as definer):
    `action: 'issue_funding_receipt'`, `entity_type: 'funding_receipts'`,
    `entity_id: <new id>`, `metadata: { receipt_number, fulfillment_id, variant,
    amount_cents, supersedes }`. **No EIN, no `document_html`, no `payment_reference`.**
11. `RETURN jsonb_build_object('ok', true, 'receipt_id', …, 'receipt_number', v_number);`

### `void_funding_receipt`

```sql
void_funding_receipt(p_receipt_id uuid, p_actor_profile_id uuid, p_reason text)
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
```

Same three-branch actor resolution; admin or system only. `p_reason` must be at least 10
characters → `reason_required`. Already-voided → `{ ok: true, already_voided: true }`.
Sets `status = 'voided'`, `voided_at = now()`, `voided_by = v_actor`, `voided_reason`.

**It never touches `document_html`, `document_sha256`, `receipt_number`, or any of the
denormalised fields.** A voided receipt still renders exactly as it was issued — that is the
entire point of keeping it. Writes an `audit_log` row `void_funding_receipt` with the reason.

Does **not** transition the fulfillment back out of `receipted`. If an admin needs that, they
use `adminOverrideFulfillmentStatus` from prompt `01`, which records its own reason.

### Grants

```sql
REVOKE EXECUTE ON FUNCTION issue_funding_receipt(uuid, uuid, receipt_variant, text, text, text,
  text, text, text, bigint, text, text, text, timestamptz, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION issue_funding_receipt(...) FROM anon;
REVOKE EXECUTE ON FUNCTION issue_funding_receipt(...) FROM authenticated;
GRANT  EXECUTE ON FUNCTION issue_funding_receipt(...) TO service_role;

REVOKE EXECUTE ON FUNCTION void_funding_receipt(uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION void_funding_receipt(uuid, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION void_funding_receipt(uuid, uuid, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION void_funding_receipt(uuid, uuid, text) TO service_role;
```

Postgres defaults EXECUTE to `PUBLIC`; this bit the project once already (`0062`). Spell out
the full argument list on each line — an overload-ambiguous `REVOKE` silently does nothing.

## The copy — `lib/receipt-copy.ts`

Pure module. No React, no DB, no `Date.now()` in any returned string.

```ts
export const RECEIPT_COPY_VERSION = '2026-08-v1'
export const RECEIPT_COPY_REVIEWED_AT: string | null = null

export type ReceiptVariant = 'charitable_501c3' | 'governmental_school' | 'non_charitable'

export function resolveReceiptVariant(input: {
  teamTaxStatus: '501c3' | 'School' | 'None' | null
  taxClassification: PayeeTaxClassification | null
  w9VerifiedAt: string | null
}): ReceiptVariant

export function formatReceiptNumber(year: number, seq: number): string  // 'PF-2026-000123'

export function receiptCopy(variant: ReceiptVariant, ctx: ReceiptCopyContext): {
  heading: string
  bodyLines: string[]
  deductibilityStatement: string
  goodsAndServicesStatement: string
  disclaimer: string
  showEin: boolean
  draftBanner: string | null
}
```

### `resolveReceiptVariant` — the safety-first truth table

```
charitable_501c3   ⟸ teamTaxStatus === '501c3'
                     AND taxClassification ∈ { '501c3_org', 'fiscal_sponsor' }
                     AND w9VerifiedAt !== null

governmental_school ⟸ (teamTaxStatus === 'School' OR taxClassification === 'school_district')
                      AND w9VerifiedAt !== null

non_charitable      ⟸ everything else, including every case where the payout profile is
                      missing, unverified, rejected, or contradicts teams.tax_status
```

**Why the deductible variant needs all three conditions.** The brief for this prompt keys the
501(c)(3) language off `teams.tax_status`. That column alone is not safe to rely on: it is
coach-self-selected and, per prompt `02`, "`teams.tax_status` stays where it is;
`tax_classification` is the finance-grade field and the two are allowed to disagree until an
admin verifies." Printing "contributions are deductible under section 170" on the strength of
a dropdown someone picked at signup is precisely the failure mode the warning at the top of
this prompt describes. Requiring agreement between the self-declaration, the finance-grade
classification, and an admin-verified W-9 costs nothing (a team that wants a deductible
receipt completes prompt `02`'s flow) and removes the whole class of error. **Default to
`non_charitable` on any disagreement or missing data. Never default upward.**

### The three copy variants (drafts — see the warning)

**`charitable_501c3`**

> **Contribution acknowledgment**
>
> {payeeLegalName} (EIN {ein}) acknowledges receipt of a cash contribution of {amount} from
> {sponsorLegalName} on {contributionDate}.
>
> {payeeLegalName} states that it is an organization described in section 501(c)(3) of the
> Internal Revenue Code and that contributions to it are deductible under section 170.
>
> **No goods or services were provided by {payeeLegalName} in exchange for this contribution.**
>
> Retain this acknowledgment with your tax records. {payeeLegalName} does not provide tax
> advice; consult your tax advisor regarding the deductibility of this contribution.

Note the framing: *"{payee} states that it is…"*. The team asserts its own status; the
platform reports the assertion. That is both accurate and the correct allocation of risk.

**`governmental_school`**

> **Contribution acknowledgment**
>
> {payeeLegalName}{ein ? ` (EIN ${ein})` : ''} acknowledges receipt of {amount} from
> {sponsorLegalName} on {contributionDate} in support of its FIRST Tech Challenge robotics
> program.
>
> {payeeLegalName} is a public school or governmental unit. Contributions to a governmental
> unit may be deductible under section 170(c)(1) when made exclusively for public purposes.
> **Whether that applies to this contribution is a determination for your tax advisor; this
> document is not a determination of deductibility.**
>
> No goods or services were provided in exchange for this payment.

**`non_charitable`**

> **Payment record — not a charitable contribution receipt**
>
> {payeeLegalName} acknowledges receipt of {amount} from {sponsorLegalName} on
> {contributionDate}.
>
> **{payeeLegalName} is not a section 501(c)(3) organization, and this document must not be
> used to substantiate a charitable contribution deduction.**
>
> Your payment may be deductible as an ordinary and necessary business expense under section
> 162. That is a determination for your tax advisor.
>
> {whenNoVerifiedProfile: "This team has not completed verified payout and tax information.
> If it does, future contributions can be acknowledged with the appropriate tax language."}

`showEin` is `true` for `charitable_501c3`, `true` for `governmental_school` **when an EIN is
available**, and **always `false` for `non_charitable`**. `unincorporated` resolves to
`non_charitable`, so an individual's TIN can never be printed by construction.

### Quid pro quo

When `goods_or_services_description` is non-null, `goodsAndServicesStatement` becomes the
Pub 1771 disclosure instead of the negative one:

> In exchange for this contribution, {payeeLegalName} provided: {description}. The good-faith
> estimate of the value of those goods or services is {fmv}. Under IRS rules the deductible
> amount, if any, is limited to the excess of the contribution over that value.

Nothing in this slice populates those fields — they exist so the machinery is right the day
something does. See "Interaction with prompts 14 and 15".

### The draft banner

`draftBanner` is `null` when `RECEIPT_COPY_REVIEWED_AT` is set, and otherwise the exact
string:

> DRAFT — this acknowledgment uses template language that has not been reviewed by counsel.

Rendered at the top of the document body, so it lands in `document_html`, the email, the
print page, and the hash.

## The document — `lib/receipt-document.tsx`

One shared body component, three shells.

```tsx
export interface ReceiptDocumentContext { /* every field the copy needs, all primitives */ }

/** The document body. NO <Html>, NO <Body> — it is embedded in an email shell and in a page. */
export function ReceiptDocumentBody(ctx: ReceiptDocumentContext): React.ReactElement

/** Deterministic. Same context in ⇒ byte-identical html and sha256 out. */
export async function renderReceiptDocument(
  ctx: ReceiptDocumentContext
): Promise<{ html: string; sha256: string }>
```

- `renderReceiptDocument` uses `render()` from `@react-email/render` with `pretty: false`,
  then `createHash('sha256').update(html).digest('hex')`.
- **Determinism is load-bearing** — the hash is re-verified at issue time and again on every
  page render. No `Date.now()`, no `Math.random()`, no locale-dependent formatting that
  could differ between the render that produced the hash and any later one. Format dates and
  currency with explicit `en-US` options and a fixed UTC interpretation, and derive every
  displayed value from `ctx`. A test asserts two renders of the same context are identical.
- The body renders `<Section>`-based rows (the `emails/handshake-email.tsx:57-61` summary-box
  idiom), inline styles only, no external images, no web fonts, no `<script>`. It must
  survive Outlook and it must be safe to embed in a page.
- Fields shown: receipt number, issue date, contribution date, payee legal name (+ EIN when
  `showEin`), fiscal sponsor name when `is_fiscally_sponsored`, sponsor legal name, amount in
  words and figures, the variant copy, the goods-and-services statement, the disclaimer, the
  draft banner, and the FTC Pitfund footer. **The payment method and the payment reference
  never appear** — a check number on a tax document is unnecessary and leaks a value prompt
  `01` spent effort keeping out of every other surface.

**`emails/funding-receipt-email.tsx`** wraps the same body in `<Html><Head><Preview>…<Body>`
with a one-line lede and nothing else. It must not restate the tax language — one source.

**Sender in `lib/notify.ts`:**

```ts
export async function sendFundingReceiptEmail(args: {
  receiptId: string
  receiptNumber: string
  to: string
  replyTo?: string
  ctx: ReceiptDocumentContext
  isResend?: boolean
}): Promise<NotifyResult>
```

Routed through `sendViaResend` (`lib/notify.ts:46-58`) so it inherits the never-throws
contract. `replyTo` = the coach's email (the payee answers questions about their own
receipt), falling back to `SUPPORT_EMAIL` — same reasoning as `:194-199`. Idempotency key
`sha256(receiptId + 'receipt')` for the first send, so a retry cannot double-deliver; a
deliberate resend uses `sha256(receiptId + 'receipt-resend' + Date.now())` because the whole
point is to send it again.

## Orchestration — `lib/receipts.ts`

`generateAndStoreReceipt` is a plain module function, **not** a server action, so both
`confirmPaymentReceived` (system path, actor `null`) and the admin action can call it without
nesting `'use server'` boundaries.

```ts
export async function generateAndStoreReceipt(
  adminClient: SupabaseClient<Database>,
  fulfillmentId: string,
  actorProfileId: string | null,
  opts?: { supersedesReceiptId?: string },
): Promise<{ ok: true; receiptNumber: string; alreadyIssued: boolean } | { ok: false; error: string }>
```

Steps:

1. Read, with the admin client, in one query where possible: the fulfillment
   (`amount_cents`, `status`, `payment_received_at`, `team_id`, `sponsor_id`,
   `transaction_id`), `teams(team_name, tax_status)`,
   `team_payout_profiles(legal_payee_name, tax_classification, ein_last4,
   is_fiscally_sponsored, fiscal_sponsor_name, w9_verified_at)`, and
   `sponsors(company_name, contact_email)`.
2. `resolveReceiptVariant(...)`.
3. **Payee name fallback.** If there is no payout profile row, use `teams.team_name` as
   `payee_legal_name`, force `non_charitable`, and include the "has not completed verified
   payout information" line. *Rationale, worth a comment: refusing to issue anything leaves
   the sponsor with no record at all, which is worse than a truthful non-charitable one. The
   non-charitable variant makes no tax claim, so a guessed-at name cannot cause a bad
   deduction.* Also `createInAppNotification` to the coach explaining that completing the
   payout profile would have produced a proper acknowledgment.
4. **EIN.** Only when `showEin`: call `get_payout_ein(p_team_id, env.PAYOUT_ENCRYPTION_KEY,
   'payee')` — or `'fiscal_sponsor'` when `is_fiscally_sponsored` — through the admin client.
   `get_payout_ein` returns NULL on a wrong key rather than raising (prompt `02`), so treat
   NULL as "no EIN available": print the last four only, or omit the EIN line entirely for
   `governmental_school`. **Never log the returned value; never put it in `audit_log`.**
5. `renderReceiptDocument(ctx)`.
6. `adminClient.rpc('issue_funding_receipt', { … })`. Map the error codes through a local
   `mapReceiptError()` in the style of `mapDecisionError` in
   `app/actions/sponsor-decision.ts:25-38`. Treat `already_issued: true` as success.
7. **After** the RPC commits: `sendFundingReceiptEmail` to `sponsors.contact_email`, then
   stamp `emailed_at` when it succeeds. `createInAppNotification` to every profile with
   `role='sponsor'` and `sponsor_id = <sponsor>` (the same fan-out as
   `app/actions/moderation.ts:113-131`) and to the team owner, both with `skipEmail: true`
   for the sponsor (the receipt email *is* the richer dedicated email) and `skipEmail: false`
   for the coach (who gets a short "a receipt was issued" note plus the link, not the
   document).
8. **A failed email never rolls back a receipt.** The RPC has already committed; the receipt
   legally exists. Report the failure to Sentry, leave `emailed_at` null, and surface it as a
   warning — `resendReceiptEmail` is the recovery path. Return `{ ok: true }`.

Then replace prompt `01`'s marker in `app/actions/fulfillment.ts`:

```ts
// prompt 04 hooks receipt issuance in here
```
with a call to `generateAndStoreReceipt(createAdminClient(), fulfillmentId, null)` whose
result is checked but never allowed to fail the coach's confirmation — the coach's action
succeeded the moment the fulfillment reached `payment_received`; a receipt problem is an
admin problem, not a reason to tell the coach their confirmation did not work. Return
`{ success: true, warning }` on a receipt failure, matching
`app/actions/sponsor-decision.ts:116`.

## Server actions — `app/actions/receipt.ts`

Canonical 5-step shape. Zod `safeParse` only.

```ts
issueReceiptForFulfillment(input: { fulfillmentId: string }): Promise<{ success?: true; receiptNumber?: string; error?: string }>
```
`requireAdmin()`. Delegates to `generateAndStoreReceipt(adminClient, id, user.id)`. Audit is
written by the RPC; the action adds no second row. `revalidatePath('/reconciliation')`.
This is the manual path for a fulfillment that reached `payment_received` before this slice
shipped, or whose automatic issuance failed.

```ts
voidReceipt(input: { receiptId: string; reason: string }): Promise<{ success?: true; error?: string }>
```
`requireAdmin()`. `reason` min 10 chars, `max LIMITS.fulfillmentNote`. Calls
`void_funding_receipt`. Notifies **both** counterparties, `type: 'general'`, stating that the
receipt was voided and why — a sponsor whose controller has already filed needs to know.
`revalidatePath('/reconciliation')`, `revalidatePath('/sponsor/funding')`,
`revalidatePath('/dashboard')`.

```ts
reissueReceipt(input: { receiptId: string; reason: string }): Promise<{ success?: true; receiptNumber?: string; error?: string }>
```
`requireAdmin()`. Void, then `generateAndStoreReceipt(..., { supersedesReceiptId })`, which
re-reads the *current* payout profile — that is the whole reason a reissue exists: the payee
name or the tax classification was wrong and has since been fixed. If the issue step fails
after the void, return the error and leave the receipt voided; do **not** attempt to
un-void. Say so in the returned message so the admin knows the state.

```ts
resendReceiptEmail(input: { receiptId: string }): Promise<{ success?: true; error?: string }>
```
`requireAdmin()`. Re-sends the **stored** `document_html` — never a fresh render, or a
year-old receipt would silently pick up new template copy. Stamps `emailed_at`. Audit
`resend_funding_receipt`.

Add to `lib/schemas/limits.ts` if not already present from prompt `01`: nothing new is
needed — `fulfillmentNote: 1000` covers the reason fields. Do not add duplicate keys.

## UI

**`app/receipts/[receiptNumber]/page.tsx` — one shared route, no route group.**

Both parties need the same document and neither portal's chrome belongs on a printable tax
record, so this lives outside `(sponsor)`, `(coach)` and `(admin)`. It is **not** in
`middleware.ts`'s public matcher, so an unauthenticated visitor is redirected to `/login`.

- `getAuthedProfile()` → `redirect('/login')` when null.
- Read with the **server client**: `.from('funding_receipts').select('*').eq('receipt_number',
  params.receiptNumber).maybeSingle()`. Authorization is RLS: a non-party's read returns no
  row, so `notFound()` — same shape as
  `app/(sponsor)/sponsor/submissions/[id]/not-found.tsx`. **Do not add an application-level
  ownership check on top; do not use the admin client here.** A 404 for a receipt that exists
  but is not yours is the correct answer, and it leaks nothing.
- **Re-verify the hash before rendering.** Recompute `sha256(document_html)` and compare with
  `document_sha256`. On mismatch, render a destructive `Alert` — "This receipt could not be
  verified and will not be displayed. Contact support." — and nothing else. That single
  comparison is what turns the stored hash from decoration into a tamper control.
- Render with `dangerouslySetInnerHTML`. Acceptable **here and only here**, for reasons worth
  spelling out in a comment: the HTML was produced by our own renderer from typed primitives,
  it contains no `<script>` and no external resource, it was hashed at issue time, and the
  hash is re-verified one line above. Never widen this to any HTML the platform did not
  render itself.
- A `'use client'` **Print / Save as PDF** button calling `window.print()`, and a
  `@media print` block that hides the button and any chrome.
- When `status = 'voided'`: a persistent destructive banner above the document with
  `voided_reason`, `voided_at`, and a link to `superseded_by_receipt_id`'s number when set.
  **The document still renders.** Retaining the original is the point of a void-and-reissue
  model; hiding it would defeat it.

**Sponsor** — on prompt `03`'s `/sponsor/funding` tracker, a `receipted` row shows its
receipt number as a link to `/receipts/{number}`. Add a "Receipts" section below the tracker
listing number, issue date, contribution date, team, amount, and status
(`Issued` / `Voided`), newest first.

**Coach** — on prompt `03`'s Funding tab, the **Received** section's rows gain the same link.

**Admin** — on `/reconciliation`, a `receipted` row shows the number and link, and its
expander gains three controls: **Void** and **Reissue** (each a dialog with a required
reason, min 10 chars, reusing `components/admin/fulfillment-override-dialog.tsx`'s shape) and
**Resend receipt email**. A `payment_received` row with no live receipt gains **Issue
receipt** — that is the manual recovery path, and its presence is itself the signal that
automatic issuance failed.

**States.** *Empty* — the sponsor's Receipts section uses `EmptyState`: "No receipts yet.
One is issued automatically when a team confirms it received your payment." *Loading* —
`app/receipts/[receiptNumber]/loading.tsx`, a simple centred skeleton. *Error* — the hash
banner above. *Permission-denied* — `notFound()`, never a "you are not allowed" page.

## Interaction with prompts 14 and 15 — noted, not built

- **Prompt `14` (sponsor recognition tiers) can make the "no goods or services" statement
  false.** The moment a sponsorship confers a benefit with fair market value — a logo on a
  robot, a named tier, event tickets — the contribution becomes quid pro quo and Pub 1771
  requires the description plus a good-faith FMV estimate, with the deduction limited to the
  excess. `goods_or_services_description` and `goods_or_services_fmv_cents` exist for exactly
  that, and `receiptCopy` already switches on them. **Prompt `14` must populate them and must
  re-open the copy for legal review.** Leave a comment saying so on both columns and in
  `lib/receipt-copy.ts`. Build nothing for it here.
- **Prompt `15` (CSR/ESG impact report) consumes receipts as input.** The annual report's
  "total charitable giving" figure should aggregate `funding_receipts` where
  `status = 'issued'` and `variant = 'charitable_501c3'`, grouped by
  `EXTRACT(YEAR FROM contribution_date)` per sponsor — *not* `transactions_ledger`, which
  records commitments, and *not* `funding_fulfillments`, which includes non-charitable
  payments. The `idx_receipts_sponsor` index is shaped for that read. Build nothing for it
  here.

## Out of scope

- Any PDF library, PDF attachment, or server-side PDF rendering. Decision above.
- Recognition tiers, FMV valuation, the CSR report.
- Form 1099 issuance, backup withholding, TIN matching against the IRS API.
- **Non-cash / in-kind contributions.** Those are Form 8283 territory with donor-side
  appraisal rules and a completely different acknowledgment. The platform tracks cash
  pledges only; do not add an in-kind path.
- Mailing a paper receipt, or a bulk "send me all my 2026 receipts" export. Both are
  reasonable follow-ups and neither is this slice.
- State charitable-solicitation registration disclosures (several states require specific
  language on solicitations). Flag it in the PR as a launch-blocker for legal review; do not
  guess at the wording.
- Changing `teams.tax_status`, `team_payout_profiles`, the EIN encryption scheme,
  `transactions_ledger`, or the capacity model.
- Multi-currency. Everything is USD cents.
- Adding a `notifications.type` CHECK value. Use `'general'`.

## Guardrails specific to this slice

1. **The tax copy is a draft.** Do not remove or condition away the draft banner. Do not
   describe it to a user as advice. `RECEIPT_COPY_REVIEWED_AT` stays `null` until a human
   sets it.
2. **Default down, never up.** Any missing, unverified, or contradictory tax data resolves to
   `non_charitable`. A receipt that under-claims costs the sponsor a deduction they can chase
   with a reissue; one that over-claims costs them an audit.
3. **Never print an individual TIN.** `unincorporated` → `non_charitable` → `showEin: false`.
   Not the full number, not the last four.
4. **A receipt is never edited.** No UPDATE policy exists. The only UPDATEs either RPC
   performs on `funding_receipts` are the void fields, `emailed_at`, and
   `superseded_by_receipt_id`. `document_html`, `document_sha256`, `receipt_number`,
   `amount_cents`, and every denormalised field are write-once.
5. **Never join a stored receipt back to live data when rendering.** The denormalised columns
   and `document_html` are the record. A renamed team must not retroactively rewrite last
   year's acknowledgment.
6. **Never `auth.uid()`.** Use `current_profile_id()`, `is_admin()`,
   `is_trusted_server_context()` — and the three-branch actor form, not `0065`'s bare `ELSE`.
7. **REVOKE EXECUTE FROM PUBLIC, anon, authenticated; GRANT TO service_role** on both new
   functions, with full argument lists. **Do not revoke `can_read_fulfillment`** — it runs
   inside an RLS policy (prompt `01` guardrail 3).
8. **`SET search_path = public, extensions`** on `issue_funding_receipt`; it calls `digest`
   and pgcrypto is not in `public` (`0059`).
9. **Issuance is idempotent.** `confirmPaymentReceived` may be retried, and a retry must
   return the existing receipt rather than mint a second number. The partial unique index is
   the backstop, not the mechanism.
10. **Gap-freedom is a transaction property.** Never `nextval`. Never mint the number outside
    the transaction that inserts the row. Never reuse a voided number.
11. **`payment_reference` and `payment_method` never appear on a receipt** — not in the
    document, not in the email, not in `audit_log.metadata`.
12. **COPPA:** a receipt names organisations and, at most, an adult coach. Never a student, an
    age, or a photo.
13. **`$$`-quoted blocks ⇒ apply with `psql -f`** (_CONTEXT §8.2), and run it twice to prove
    idempotency.

## Files you will touch

**Create:**
- `supabase/migrations/0078_funding_receipts.sql`
- `lib/receipt-copy.ts`
- `lib/receipt-document.tsx`
- `lib/receipts.ts`
- `emails/funding-receipt-email.tsx`
- `app/actions/receipt.ts`
- `app/receipts/[receiptNumber]/page.tsx`
- `app/receipts/[receiptNumber]/loading.tsx`
- `components/receipts/print-button.tsx`
- `components/admin/receipt-actions.tsx`
- `lib/__tests__/receipt-copy.test.ts`
- `lib/__tests__/receipt-document.test.ts`
- `tests/e2e/receipts.spec.ts`

**Modify:**
- `app/actions/fulfillment.ts` (replace prompt `01`'s marker with the issuance call)
- `lib/notify.ts` (`sendFundingReceiptEmail`)
- `app/(sponsor)/sponsor/funding/page.tsx` (receipt links + Receipts section)
- `components/coach/funding-tab.tsx` (receipt links in the Received section)
- `components/admin/reconciliation-table.tsx` (number, link, and the three controls)
- `lib/supabase/types.ts` (the new table, the counter table, and the two enums — match the
  file's existing style, hand-added or regenerated)
- `lib/dev-preview.ts`, `lib/dev-coach-preview.ts`, `lib/dev-bypass.ts` (a `funding_receipts`
  fixture keyed to the fulfillment fixtures prompt `03` added, so the links render in
  preview; include one `voided` row so the banner can be eyeballed)

## Tests

**Unit — `lib/__tests__/receipt-copy.test.ts` (Vitest):**

- `resolveReceiptVariant` truth table, exhaustive over
  `teamTaxStatus × taxClassification × (w9VerifiedAt | null)`. Named cases that must hold:
  - `'501c3'` + `'501c3_org'` + verified → `charitable_501c3`
  - `'501c3'` + `'501c3_org'` + **unverified** → `non_charitable` *(the safety default)*
  - `'501c3'` + `'unincorporated'` + verified → `non_charitable` *(disagreement defaults down)*
  - `'School'` + `'school_district'` + verified → `governmental_school`
  - `null` payout profile → `non_charitable`
- `charitable_501c3` copy contains the exact substring
  `No goods or services were provided`.
- `non_charitable` copy contains `not a section 501(c)(3) organization` and
  `must not be used to substantiate a charitable contribution deduction`, and contains
  **neither** `deductible under section 170` **nor** `tax-deductible`.
- `governmental_school` copy contains `not a determination of deductibility` and does not
  assert that the contribution *is* deductible.
- `showEin` is `false` for every `non_charitable` case, including when an `ein_last4` is
  supplied.
- Supplying `goodsOrServicesDescription` swaps in the quid-pro-quo statement and it mentions
  the good-faith estimate.
- `formatReceiptNumber(2026, 1) === 'PF-2026-000001'` and
  `formatReceiptNumber(2026, 123) === 'PF-2026-000123'`.
- `draftBanner` is non-null while `RECEIPT_COPY_REVIEWED_AT` is `null`.

**Unit — `lib/__tests__/receipt-document.test.ts`:**

- Rendering the same context twice yields identical `html` and identical `sha256`
  (determinism — this is what the on-render verification depends on).
- Changing one cent of `amount_cents` changes the hash.
- The rendered HTML contains no `<script`, no `http://`, no `https://` asset reference, and
  no occurrence of `payment_reference` / `paymentReference`.
- A `non_charitable` render contains no nine-digit EIN-shaped string.

**Unit — extend `lib/__tests__/remediation-invariants.test.ts`:**

- `supabase/migrations/0078_funding_receipts.sql` contains `REVOKE EXECUTE` for both new
  functions and no occurrence of `auth.uid()`.
- `funding_receipts` has no `CREATE POLICY … FOR UPDATE`, `FOR INSERT`, or `FOR DELETE` in
  that file.

**E2E — `tests/e2e/receipts.spec.ts` (Playwright). Security boundaries are mandatory:**

- A coach confirming receipt produces exactly one `funding_receipts` row, moves the
  fulfillment to `receipted`, emails the sponsor, and notifies the coach in-app.
- **Retrying `confirmPaymentReceived` produces no second receipt and no second number.**
- **Sponsor B `GET /rest/v1/funding_receipts?select=*` returns none of Sponsor A's rows;
  anon returns `[]`.**
- **A coach of Team Y opening `/receipts/{A's number}` gets a 404 page, not the document.**
- **Unauthenticated `/receipts/{number}` redirects to `/login`.**
- **No authenticated role can UPDATE or DELETE `funding_receipts`: a PATCH of
  `document_html` and a DELETE both affect 0 rows.**
- **`GET /rest/v1/funding_receipt_counters` returns `[]` for coach, sponsor, admin and anon,
  and a PATCH is denied.**
- **A sponsor and a coach each calling `rpc('issue_funding_receipt', …)` directly are denied
  by the EXECUTE revoke** — assert the error, not just the absence of a row.
- Corrupting `document_html` directly with the service role makes the page render the
  verification error instead of the document.
- **Gap-freedom under failure:** force a `document_hash_mismatch` (pass a wrong hash), then
  issue a real receipt — the number is `n+1`, not `n+2`. The failed attempt consumed nothing.
- **Uniqueness under concurrency:** issue receipts for two different fulfillments in parallel
  → two distinct, consecutive numbers, no duplicate, no gap.
- Void → the document still renders with a void banner and the reason; the sponsor and the
  coach are both notified.
- Reissue → a new number, `supersedes_receipt_id` set on the new row and
  `superseded_by_receipt_id` on the old, and the old one is still readable.
- A team with `teams.tax_status = '501c3'` but no verified W-9 receives a `non_charitable`
  receipt, and the rendered document does not contain the string `section 170`.
- Admin "Resend receipt email" re-sends the stored HTML and updates `emailed_at`, and the
  re-sent body is byte-identical to the stored `document_html`.

## Acceptance criteria

- [ ] A coach confirming payment receipt causes a receipt to be issued, emailed to the
      sponsor, and linked from all three portals — with no admin action.
- [ ] The sponsor's copy and the coach's copy of a given receipt are the same document.
- [ ] A receipt for a team with `teams.tax_status = '501c3'`, `tax_classification` of
      `501c3_org` or `fiscal_sponsor`, and a verified W-9 contains the date, the amount, the
      payee legal name, the EIN, and the sentence "No goods or services were provided".
- [ ] A `School` payee's receipt makes no assertion that the contribution is deductible.
- [ ] A `None` / unverified / unincorporated payee's receipt says on its face that it is not
      a charitable contribution receipt, and contains no EIN.
- [ ] A team with a `501c3` self-declaration but no verified W-9 gets the non-charitable
      variant — the platform never upgrades a receipt on unverified data.
- [ ] Every issued document carries the DRAFT banner while `RECEIPT_COPY_REVIEWED_AT` is
      `null`, and that banner is inside the stored HTML, not applied at render time.
- [ ] Receipt numbers are `PF-YYYY-NNNNNN`, unique, and contain **no gaps** across a run that
      includes at least one failed issuance.
- [ ] Two concurrent issuances never produce the same number.
- [ ] Issuing twice for the same fulfillment yields one receipt.
- [ ] No role other than `service_role` can execute either new function, and no authenticated
      role can INSERT, UPDATE, or DELETE `funding_receipts`.
- [ ] A party to a receipt can open and print it; a non-party gets a 404; anon gets `/login`.
- [ ] Tampering with `document_html` in the database makes the page refuse to render it.
- [ ] Voiding preserves the original document and notifies both parties; reissuing links the
      pair in both directions.
- [ ] `grep -rn "payment_reference\|paymentReference" lib/receipt-document.tsx emails/funding-receipt-email.tsx`
      returns nothing.
- [ ] The three preview modes still render their funding surfaces with receipt links.
- [ ] The migration applies cleanly twice in a row with `psql -f`.
- [ ] `npm run typecheck && npm run lint && npm run build && npm run test` all pass.

## Rollback

> **Read this first: dropping `funding_receipts` destroys issued tax documents.** Sponsors may
> already be relying on them. Export before you drop:
> ```
> \copy (SELECT receipt_number, issued_at, contribution_date, amount_cents,
>               payee_legal_name, sponsor_legal_name, variant, status, document_html
>          FROM funding_receipts ORDER BY receipt_number)
>    TO 'funding_receipts_backup.csv' CSV HEADER
> ```
> Pre-launch this table is empty and the warning is theoretical. It will not stay that way.

```sql
BEGIN;

-- Fulfillments already moved to 'receipted' are left there deliberately: the money WAS
-- received and receipted, and rewinding the state machine would be a bigger lie than a
-- dangling status. Use adminOverrideFulfillmentStatus if a specific row needs correcting.

DROP FUNCTION IF EXISTS void_funding_receipt(uuid, uuid, text);
DROP FUNCTION IF EXISTS issue_funding_receipt(uuid, uuid, receipt_variant, text, text, text,
  text, text, text, bigint, text, text, text, timestamptz, uuid);

DROP TABLE IF EXISTS funding_receipts;              -- self-referencing FKs drop with it
DROP TABLE IF EXISTS funding_receipt_counters;

DROP TYPE IF EXISTS receipt_variant;
DROP TYPE IF EXISTS receipt_status;

COMMIT;
```

`funding_fulfillments`, `transactions_ledger`, `team_payout_profiles`, and the capacity model
are not modified by `0078`, so nothing about them needs reverting. Revert the code with
`git revert` of this prompt's commit — **the SQL above must run before the deploy that
removes `lib/receipts.ts`**, or an in-flight `confirmPaymentReceived` will call an RPC that
no longer exists. Deploys are manual: `vercel deploy --prod --yes`.

## Commit

```
feat(receipts): issue donation acknowledgments when a payment is confirmed

A sponsor's controller needs a written acknowledgment to substantiate a
deduction, and the platform issued nothing — funding_fulfillments could
reach payment_received and stop there. Adds funding_receipts with an
immutable rendered document plus its SHA-256, a gap-free PF-YYYY-NNNNNN
number minted from a transactional per-year counter, and issuance on the
payment_received -> receipted transition. Three copy variants: full IRS
Pub 1771 language for a verified 501(c)(3) payee, a no-claim variant for
public schools, and an explicit "not a charitable contribution receipt"
for everyone else — defaulting down on any unverified or contradictory
tax data. Emails the sponsor, gives both parties a print-optimised page,
and models corrections as void + reissue with the original retained.

The drafted tax language is a draft and carries a DRAFT banner until
counsel signs off via RECEIPT_COPY_REVIEWED_AT.
```
