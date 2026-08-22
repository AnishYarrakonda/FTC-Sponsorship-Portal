# A-03 — Server-action conformance & mutation integrity

**Lane A (static — parallel-safe).** Audit id `A-03`.
**Outputs:** `prompts/audits/findings/A-03-findings.md` · `prompts/audits/handoff/A-03-claude-prompt.md`

> Read `prompts/audits/_CONTEXT-AUDIT.md` in full first.

---

## You own

All 23 files in `app/actions/` — `account admin admin-payout agreements agreements-sign
appeals auth capacity-audit credentials fulfillment impact messages moderation notifications
payout receipt recognition sponsor sponsor-approvals sponsor-decision sponsor-members
submission team` — plus `lib/schemas/*` and the route handlers in `app/api/*`.

The canonical shape every mutating action must follow (`.claude/rules/conventions.md`):
**1 validate (Zod `safeParse`) → 2 auth/role guard → 3 mutate → 4 `audit_log` via the admin
client → 5 notify.** Missing 1, 2, 4, or 5 on a sensitive action is a bug.

## Investigate

1. **Build the conformance table.** One row per exported action across all 23 files. Columns:
   validates? which guard? which Supabase client? audits? notifies? returns `{ error }` rather
   than throwing? Every deviation gets a severity — but **judge by consequence**: a missing
   `audit_log` on a money or role mutation is P1; on a read-only preference toggle it is P3.
2. **Validation depth, not presence.** A `safeParse` that accepts `z.any()`, or a schema that
   omits a field the action then writes, is worse than no schema because it looks safe. For
   every action check: are all writable fields covered, are the max lengths from
   `lib/schemas/limits.ts` (not hardcoded), is rich text passed through the sanitizing helper
   (`richTextField` / `plainTextField`), and is any user string interpolated into SQL, HTML,
   an email body, a filename, or a URL without escaping?
3. **The IDOR sweep — do this for every action.** Trace each id the client supplies (submission
   id, team id, sponsor id, fulfillment id, receipt id, agreement id, member id, appeal id).
   Is ownership verified **in the action**, or is it left entirely to RLS, or is it done with
   the admin client (which has no RLS)? Any admin-client mutation keyed on a client-supplied
   id without an explicit ownership check is a P0 candidate. Prove it either way.
4. **Concurrency and atomicity.** The schema has atomic RPCs precisely because multi-statement
   flows raced: `approve_submission_atomic`, `admin_terminal_decision_atomic`,
   `sponsor_decide_submission_atomic`, `record_sponsor_decision_atomic`,
   `confirm_sponsor_decision_proposal`, `sign_agreement_atomic`, `issue_funding_receipt`,
   `increment_sponsor_funding`, `release_submission_reservation`. For each: find every call
   site, and find every place that does the *same* logical operation with separate statements
   instead. Then look for the remaining multi-step mutations with no RPC — double submit,
   double approve, simultaneous decisions by two approvers in the same sponsor org, an appeal
   filed while an admin is deciding — and state the interleaving that corrupts state.
5. **Partial-failure recovery.** In every action where step 3 succeeds and step 4 or 5 throws,
   what is left behind? An email sent for a mutation that rolled back, or a mutation with no
   audit row, are both real findings. `prompts/revamp/_AUDIT-11-18.md` records a partially
   applied overturn that was unrecoverable — look for that class again.
6. **Error surface.** Do any returned error strings leak internals — raw Postgres messages,
   constraint names, ids belonging to other tenants, stack traces? Conversely, is any failure
   swallowed and reported as success?
7. **Revalidation.** After a mutation, is the right path revalidated? A missing
   `revalidatePath` shows the user stale state and gets reported as "it didn't save".
8. **Dead and duplicated logic.** Actions no UI calls; two actions doing the same mutation with
   different guards (the weaker one is the finding); business rules implemented in both TS and
   SQL that can drift — `lib/fulfillment-status.ts` vs the fulfillment triggers,
   `lib/recognition.ts` vs `recognition_tier_for_amount()`. Compare the two implementations
   and report every disagreement.

## Enterprise lens

Who can undo a mistake? For each destructive or irreversible action, say whether an admin can
reverse it, whether the reversal is itself audited, and whether the audit trail is complete
enough to answer "who approved this $50,000 pledge and when" months later.

## Done when

The conformance table covers every exported action, the IDOR sweep names each client-supplied
id and its check, and every race you claim is described as a concrete interleaving.
