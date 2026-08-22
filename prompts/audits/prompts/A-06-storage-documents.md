# A-06 — Storage, files & generated documents

**Lane A (static — parallel-safe).** Audit id `A-06`.
**Outputs:** `prompts/audits/findings/A-06-findings.md` · `prompts/audits/handoff/A-06-claude-prompt.md`

> Read `prompts/audits/_CONTEXT-AUDIT.md` in full first.
> This audit owns the most sensitive documents in the product: government ID, EIN/W-9, and
> signed agreements. Exposure of any of them is a P0.

---

## You own

Supabase Storage buckets and their RLS, `lib/file-validation.ts`, `lib/credentials-retention.ts`,
`lib/payout-retention.ts`, `lib/safe-url.ts`, `lib/receipt-document.tsx`, `lib/receipts.ts`,
`lib/agreements/*` (`hash.ts`, `in-house-provider.ts`), `lib/impact-report/*`,
`app/actions/{credentials,payout,admin-payout,receipt,agreements,agreements-sign,impact,team}.ts`,
`app/(auth)/upload-credentials`, `app/receipts/*`, `app/agreement-records/*`,
and the tables `team_payout_profiles`, `agreement_templates`, `agreement_signatures`,
`funding_receipts`, `impact_report_snapshots`.

## Investigate

1. **Path partitioning.** The rule is that the first path segment must equal
   `auth.jwt()->>'sub'`. Read every storage policy and every upload call site and prove the
   path is constructed **server-side from the session**, never from client input. A traversal
   (`../`), an absolute path, or a client-supplied prefix is a P0.
2. **Per-bucket access matrix.** For each bucket: public or private, who can read, who can
   write, who can delete, and what an anonymous user with a URL gets. If any bucket serving ID
   documents, W-9s, or signed agreements is public, stop and report it as P0 immediately.
3. **Signed URLs.** Every `createSignedUrl` call: what TTL, who can mint one, is the mint
   authorized against the requester's ownership, and can the URL be re-shared? A long-lived
   signed URL to a photo ID is a serious finding.
4. **Upload validation.** `lib/file-validation.ts` — is the type checked by magic bytes or only
   by extension/`Content-Type`? Is there a size cap, and is it enforced server-side? Are SVG
   and HTML uploads (stored XSS) blocked? Is the stored filename sanitized and non-guessable?
   What happens on a corrupt or zero-byte file?
5. **Retention.** Read `lib/credentials-retention.ts` and `lib/payout-retention.ts`. What is
   the stated retention period for a coach's photo ID and a team's W-9, what actually deletes
   them, is that deletion scheduled and monitored, and does it delete the **storage object** as
   well as the row? An orphaned object after a row delete is a compliance finding.
6. **The EIN boundary.** `get_payout_ein()` / `set_payout_ein()` and `PAYOUT_ENCRYPTION_KEY`.
   Where is the plaintext EIN in memory, is it ever logged, does it ever reach a client
   component, a Sentry breadcrumb, an email, or a CSV export? Is key rotation possible at all —
   and if not, that is an enterprise gap worth stating.
7. **Document integrity.** `lib/agreements/hash.ts` and the append-only guards
   (`guard_agreement_signature_append_only`, `guard_agreement_template_immutable`,
   `guard_agreement_template_no_delete`, `publish_agreement_version`). For an ESIGN/UETA
   in-house flow, verify: the exact bytes signed are the bytes hashed, the hash is stored, the
   signed record cannot be mutated afterwards, the signer's intent and identity are captured
   with a timestamp and IP, and a superseded template version can still be rendered for an old
   signature. Any way to alter a signed agreement without detection is a P0.
8. **Generated documents.** Receipts and impact reports: deterministic output for the same
   input, no PII beyond what is intended, correct numbering, and no server-side fetch of a
   user-supplied URL (SSRF) during rendering — check `lib/safe-url.ts` is actually used at
   every such point.
9. **Storage economics.** Estimate bytes per team (ID + W-9 + logo + agreements + receipts) and
   per sponsor per year, project to a few hundred teams, and compare against the Supabase free
   tier's 1 GB storage / 5 GB egress versus Pro's 100 GB. **This is the single most likely
   place the free tier actually breaks** — give the human a real number, an assumed growth
   rate, and the month it crosses. That is a `Fix by subscription` item.

## Done when

The bucket matrix is complete, every upload path's construction is traced to a server-side
source, retention is proven or proven absent, and the storage projection has real numbers.
