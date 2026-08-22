# A-04 — Capacity, funding & ledger integrity

**Lane A (static — parallel-safe).** Audit id `A-04`.
**Outputs:** `prompts/audits/findings/A-04-findings.md` · `prompts/audits/handoff/A-04-claude-prompt.md`

> Read `prompts/audits/_CONTEXT-AUDIT.md` in full first.
> Capacity integrity is a Core Mandate. Anything that lets a sponsor reserve beyond its cap,
> or that loses or duplicates money, is P0.

---

## You own

The money model end to end — noting that **the platform never moves funds**; it records
pledges and tracks fulfillment.

Tables: `sponsors` (caps), `transactions_ledger`, `submissions.reserved_amount_cents`,
`funding_fulfillments`, `funding_fulfillment_events`, `funding_capacity_releases`,
`funding_receipts`, `funding_receipt_counters`, `sponsor_recognition_awards`,
`recognition_tiers`, `recognition_benefit_deliveries`.

Functions: `increment_sponsor_funding`, `release_submission_reservation`,
`release_reservation_before_submission_delete`, `approve_submission_atomic`,
`sponsor_decide_submission_atomic`, `record_fulfillment_transition`,
`guard_fulfillment_requires_signed_agreement`, `issue_funding_receipt`,
`void_funding_receipt`, `detect_capacity_drift`, `expire_overdue_submissions`,
`create_recognition_award_for_fulfillment`, `recognition_tier_for_amount`,
`record_benefit_delivery`, `void_benefit_proof`.

Code: `app/actions/{submission,fulfillment,receipt,recognition,capacity-audit,sponsor-decision,sponsor-approvals}.ts`,
`lib/fulfillment-status.ts`, `lib/fulfillment-aging.ts`, `lib/recognition.ts`, `lib/receipts.ts`,
`scripts/verify-capacity-invariant.mjs`, `app/api/cron/expire-submissions`.

## Investigate

1. **State the invariant precisely, then find every way to break it.** Write the exact
   equation that must always hold between a sponsor's cap, its reservations, its settled
   ledger rows, and its fulfillments — in the form the code actually implements, quoting the
   SQL. Then enumerate every transition that touches any term: reserve at approval, decline,
   expire, cancel, appeal, overturn, fulfillment progress, cancellation, receipt issue, receipt
   void, capacity release, direct admin adjustment. For each, prove the invariant survives —
   including when the transition is repeated, interleaved, or half-applied.
2. **Rounding, units, and types.** Every amount should be integer cents. Find every place a
   float, a division, a percentage, a tier threshold comparison, or a currency format touches
   an amount, and check for drift, truncation, or sign errors. Check for negative and zero
   amounts, and for an amount larger than the cap being rejected at *every* entry point rather
   than only in the UI.
3. **Double-spend by concurrency.** Two approvers in one sponsor org confirming decisions
   simultaneously; an approve racing an expiry; a fulfillment cancel racing a receipt issue; a
   coach cancelling while an admin approves. For each, read the RPC's locking (`FOR UPDATE`?
   advisory lock? serializable?) and say whether it actually prevents the interleaving or just
   narrows the window.
4. **Orphaned ledger rows.** `transactions_ledger.submission_id` is `ON DELETE SET NULL`, so
   deleting a submission leaves a row that still counts against the cap. This is documented as
   having really happened during E2E runs. Find every path that can orphan a ledger row in
   production, not just in tests, and say what reconciles it.
5. **Drift detection.** Read `detect_capacity_drift()`'s **live** definition and compare it to
   `scripts/verify-capacity-invariant.mjs` and to any copy in the test harness. Two
   implementations of the same arithmetic have already drifted here. If they disagree, that is
   a finding — and say which one is right.
6. **The fulfillment state machine.** Extract every state and every legal transition from
   `record_fulfillment_transition` and the guards. Draw the complete graph. Find: unreachable
   states, terminal states that can be left, transitions with no audit event, transitions that
   skip the signed-agreement guard, and any state where the money and the status disagree.
7. **Receipts.** `funding_receipt_counters` implies sequential numbering — check for gaps,
   duplicates, and races under concurrent issue. Confirm a voided receipt cannot be reissued
   with the same number, that a receipt cannot be issued for money never pledged, and that
   `RECEIPT_COPY_REVIEWED_AT` / `needs_legal_review` actually gate what they claim.
8. **Expiry.** The 14-day expiry cron is the mechanism that releases capacity. What happens if
   it does not run for a week (Vercel Hobby cron reliability), runs twice concurrently, or runs
   mid-decision? Is it idempotent? Does anything alert when it fails?
9. **Recognition tiers.** Confirm a tier award follows the money and is revoked or adjusted
   when the money is. Compare `recognition_tier_for_amount()` against `lib/recognition.ts`.

## Enterprise lens

A corporate finance team will ask for: a statement of every pledge and its status, the ability
to correct a mis-entered amount, multi-year cap handling, fiscal-year boundaries, and proof
that an internal approval chain was followed. Record what is missing.

## Done when

The invariant is written down, every transition is checked against it, the state graph is
complete, and every concurrency claim names a specific interleaving and the specific lock (or
absence of one) that decides the outcome.
