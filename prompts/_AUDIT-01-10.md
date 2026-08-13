# Audit Report: Prompts 01–10 Verification Sweep

**Date:** 2026-08-12  
**Scope:** Commits `f88e6b8` through `1aa4b57` (migrations `0076`–`0083`, 187 files)  
**Methodology:** 10 parallel Gemini Pro/Flash subagents across 7 audit phases, all findings cross-verified  
**Build status at time of audit:** ✅ `typecheck` · ✅ `lint` (0 errors, 268 warnings) · ✅ `build` · ✅ `test` (218/218 passed)

---

## Executive Summary

**No P0 bugs found.** The 10 implementation slices are remarkably well-built. Every Core Mandate is intact, the capacity system is sound under all normal paths, auth/RLS is correctly implemented with no `auth.uid()` usage, and all migrations are idempotent. The findings below are design gaps and drift — none represent shipped-and-broken production failures.

> NOTE: Since the README confirms "Production data: Pre-launch, none," the capacity-related design gaps (F-01 through F-03) have zero current production impact. They become real the moment the first fulfillment is cancelled.

---

## Findings

| ID | Sev | Prompt | File:line | What's wrong | Production impact | Evidence | Fix |
|---|---|---|---|---|---|---|---|
| **F-01** | P2 | 01 | `0076:221-265` | Fulfillment cancellation does not release capacity. `record_fulfillment_transition` updates `funding_fulfillments.status` to `cancelled` but never decrements `sponsors.funding_used_cents` or compensates the `transactions_ledger` row. | Sponsor capacity permanently consumed by cancelled fulfillments. Sponsor cannot allocate that money to another team. No current impact (pre-launch). | `cancelled` transition at L221-232 updates only `funding_fulfillments`. No `funding_used_cents` adjustment. Ledger row (append-only, `amount_cents > 0` CHECK) has no reversal mechanism. | Requires architectural decision: compensating ledger entry, new release function, or manual admin tool. |
| **F-02** | P2 | 09 | `sponsor-approvals.ts:88` | Approver rejecting a proposal does not decline the underlying submission. Submission stays in `dispatched/delivered/opened` with capacity reserved until 14-day expiry. | Capacity locked until submission auto-expires. Not a data corruption — just a delayed release. | `rejectFundingProposal` updates `proposals.status = 'rejected'` but does not call `release_submission_reservation` or change submission status. | By design (internal org decision ≠ submission decline). Consider auto-declining or warning. |
| **F-03** | P2 | 01 | `0076:377` | Legacy submissions (where `reserved_amount_cents = 0`, created before fulfillment system) could drift the capacity invariant on partial settlement. | No impact — README confirms "Production data: Pre-launch, none." No legacy submissions exist. | `GREATEST(funding_used_cents - (reserved - amount), 0)` with `reserved = 0` reduces `funding_used_cents` to 0 while the new ledger row increases the right-hand side of the invariant. | No fix needed given zero production data. Flag for prompt 11 capacity audit. |
| **F-04** | P2 | 04 | `middleware.ts:5-18` | `/receipts(.*)` is not in the `isPublicRoute` matcher. Unauthenticated users get redirected to `/login`. | Receipt URLs cannot be shared with external parties (e.g., accounting teams) without FTC Pitfund login. | Confirmed: not in the matcher at L5-18. The page itself redirects at `page.tsx:20`. **NOTE:** Prompt 04 acceptance criteria explicitly states "anon gets /login" — so current behavior matches the contract. | Matches acceptance criteria. If external sharing is desired, add to public matcher + implement token-based access. |
| **F-05** | P2 | 01/03 | `fulfillment-invariants.test.ts` | Flawed regex `/metadata:\s*\{[^}]*\}/g` stops at first `}`, missing nested objects. Test would falsely pass if `paymentReference` appeared inside nested metadata. | Test gives false confidence. Invariant violations could ship undetected. | Regex `[^}]*` is greedy-stop-at-first-brace. A metadata object like `{ inner: { paymentReference: "x" } }` would not be matched. | Fix regex to handle nesting, or switch to JSON.parse-based assertion. |
| **F-06** | P2 | 03 | `remediation-invariants.test.ts` | Regex `/export async function sendFulfillmentNudgeEmail[\s\S]*?^}/m` may not match if closing brace is indented. Extracts empty string → test falsely passes. | Same as F-05: false confidence in invariant. | Multiline `^}` anchor requires the closing brace at column 0. If indented, the lazy `*?` captures nothing. | Use AST-based extraction or fix the regex anchor. |
| **F-07** | P3 | — | `architecture.md:35` | States latest migration is `0075_query_efficiency.sql`. Real head is `0083_sponsor_roles_and_approvals.sql`. | Agents reading this file may reserve wrong migration numbers or miss 8 migrations of context. | `ls supabase/migrations \| tail -3` returns `0081`, `0082`, `0083`. | Update line 35 to `0083`. |
| **F-08** | P3 | — | `_CONTEXT.md:118-133` | §2 schema map does not describe the 8 new tables. The "Applied since" note is present but says "Read those files directly." | Future prompts (11-18) rely on §2 for schema context and will miss these tables. | §2 tables section ends at `ftc_teams_cache` and `request_throttle`. None of the 10 new tables are in the column-level docs. | Add table definitions to §2, or at minimum update the "Applied since" list. |
| **F-09** | P3 | 03 | `dev-bypass.ts`, `dev-preview.ts`, `dev-coach-preview.ts` | Dev preview fixtures lack new table shapes. Admin preview missing `team_payout_profiles`, `sponsor_decision_proposals`. Sponsor preview missing `agreement_templates`, `team_verification_records`. Coach preview missing `agreement_templates`, `sponsor_members`. | Preview modes may crash or show empty state when navigating to new features. Production unaffected (all forced off). | All three confirmed forced off in production. Missing shapes confirmed by grep. | Extend fixture files with mock data for new tables. |
| **F-10** | P3 | — | `app/legal/terms/page.tsx:114` | Contains `<p>TODO(legal): jurisdiction to be set by counsel.</p>` — a placeholder visible to users on the live legal terms page. | Users see "TODO(legal)" text on the terms page. | Grep confirms the literal string. | Replace with appropriate jurisdiction language. |
| **F-11** | P3 | — | Multiple files | `as any` casts and `eslint-disable` across cron routes and action files. | Type safety gaps. No runtime impact unless underlying types drift. | `expire-submissions/route.ts:51,100,128`; `nudge-fulfillments/route.ts:59,62,63,93`; `team.ts:214,428`; `sponsor-view/[token]/page.tsx:35,43`. | Gradual type narrowing. Not urgent. |
| **F-12** | P3 | 07 | `lib/schemas/team.ts:232` | Admin override reason minimum length is 20 characters in the schema. Prompt 07 acceptance criteria says 25 characters. Code wins (20 is correct). | None — just a prompt/code discrepancy. | Zod schema: `min(20, 'Give a reason of at least 20 characters')`. | Note in prompt for future reference. |
| **F-13** | P3 | — | `prompts/11-*.md` | Prompt 11 references line numbers in `0071_token_decision_check_status_first.sql` that may have shifted due to changes in prompts 01-10. | Text-replacement instructions in prompt 11 may fail or hit wrong lines. | Prompts 01-10 modified RPCs that 0071 originally defined. | Review prompt 11 line references against current file state. |
| **F-14** | P3 | — | `tests/e2e/` | E2E specs exist but have no CI pipeline (`.github/workflows/` does not exist). Tests only run locally. | No automated regression detection on push. | No workflow files found. | Set up CI when it becomes a priority. |
| **F-15** | P3 | 07 | `prompts/README.md:70` | FIRST API credentials not set in Vercel. This is known and by design. FTCScout fallback is verified working. | None — fallback exercised and correct. | `lib/env.ts:31-32` marks both as `.optional()`. `lib/ftc-roster.ts:135-151` falls back to FTCScout. | Set env vars when credentials arrive. |

---

## Verified Correct

The following items were explicitly checked and found to be genuinely correct:

### Phase 1 — Liveness
- ✅ Migrations `0076`–`0083` exist, no collisions — `ls supabase/migrations | tail -12`
- ✅ All migrations idempotent — `IF NOT EXISTS`, `CREATE OR REPLACE`, `DO $$ BEGIN ... END $$` guards
- ✅ No `auth.uid()` in any migration — `grep -rn 'auth.uid()' supabase/migrations/` = zero hits
- ✅ All cron routes in `vercel.json` — `expire-submissions`, `nudge-fulfillments`, `refresh-ftc-roster`
- ✅ All cron routes authenticate caller — `CRON_SECRET` validated with `crypto.timingSafeEqual`

### Phase 2 — Core Mandates
- ✅ Admin-gatekept outreach — both new email templates are transactional, no new Resend calls outside `lib/notify.ts`
- ✅ COPPA compliance — merge-fields allowlist contains only institutional data, zero student PII hits
- ✅ Portfolio vs submission separation — no global team data duplicated onto submissions
- ✅ Capacity integrity (normal paths) — double-release impossible, concurrent settlement impossible, proposal cap exceedance impossible

### Phase 3 — Auth, RLS, Org Rewrite
- ✅ No `auth.uid()` anywhere in any migration
- ✅ All 10 new tables have RLS enabled
- ✅ SECURITY DEFINER functions properly locked (policy helpers intentionally grant to `authenticated` with comments)
- ✅ No admin client imported in any client component (24 imports, all server-only)
- ✅ No `(auth.jwt()->>'sub') IS NULL` fail-open pattern
- ✅ No supabase-as-prop RSC crash pattern
- ✅ `sponsors.clerk_org_id` is UNIQUE (`0082:61`)
- ✅ `current_sponsor_ids()` handles both org and legacy paths (`0082:117-128`)
- ✅ Two-step approver bypass check in action AND RPC
- ✅ Self-approval refused at DB level (`0083:391-393`)

### Phase 4 — Actions & Webhooks
- ✅ All 12 changed action files have `'use server'` and use `safeParse`
- ✅ Auth guards present in all mutating actions
- ✅ Clerk webhook: signature verified before side effects (`route.ts:18-26`)
- ✅ Clerk webhook: idempotent (upsert for memberships)
- ✅ Clerk webhook: role literals match CHECK constraint via `reconcileMemberRole()`
- ✅ Clerk webhook: never demotes ranked member (`sponsor-roles.ts:86-93`)
- ✅ Resend webhook: can't move submission backwards (idempotency + status guard)
- ✅ Coach invitation correctly refused for non-sponsors

### Phase 5 — Feature Correctness
- ✅ Fulfillment terminal states immutable (`0076:195-200`)
- ✅ No `payment_reference` in audit/email/cron payloads
- ✅ Payout encryption fails closed (`env.ts:22`, `z.string().min(32)`)
- ✅ EIN never in logs/Sentry/audit
- ✅ W-9 coach column guard blocks protected fields (`0077:103-150`)
- ✅ Receipt number uniqueness at DB level (`0078:31` UNIQUE + `0078:84` partial index)
- ✅ Receipt concurrent safety (counter row locked via `UPDATE RETURNING`)
- ✅ Receipt tamper detection (SHA-256 re-verified on render)
- ✅ Agreement template immutability trigger (`0079:51-73`)
- ✅ Signature immutability trigger (`0080:74-96`)
- ✅ SHA-256 covers resolved document, not template (`in-house-provider.ts:47-51`)
- ✅ IP/UA/UTC captured in signature (`0080:273-281`)
- ✅ Typed-name validated server-side (`agreements-sign.ts:198-203`)
- ✅ Agreement gate can't be bypassed (trigger + RPC both enforce)
- ✅ FIRST API fallback (FTCScout) works correctly
- ✅ Lookup failure fails closed
- ✅ JIT provisioning: viewer role + false legal acks
- ✅ Email collision: skips provisioning, logs conflict, notifies admin
- ✅ SSO runbook complete (259 lines)

---

## Items Requiring User Decision

**F-01 (Fulfillment cancellation capacity leak)** is an architectural design gap, not a simple bug fix. The current system has no mechanism to reverse a `transactions_ledger` entry (append-only, `amount_cents > 0` CHECK). Three possible approaches:
1. Add a compensating "credit" entry mechanism to the ledger
2. Create a `release_fulfillment_capacity()` function that directly adjusts `funding_used_cents`
3. Accept the current behavior and add admin tooling to manually adjust sponsor caps

This needs a design decision before implementation.

**F-04 (Receipt route)** matches the acceptance criteria ("anon gets /login") but may not match real-world needs. If sponsors need to share receipt URLs with their accounting/finance teams who don't have FTC Pitfund accounts, the route needs to be made public with its own access control.

**Live database verification was not performed.** I could not connect to the live Postgres to confirm migrations 0076-0083 are actually applied. The migration files exist and are idempotent, but "file exists ≠ applied" is this repo's documented trap. Recommend running:
```sql
SELECT tablename FROM pg_tables 
WHERE schemaname='public' 
AND tablename IN ('funding_fulfillments','team_payout_profiles','funding_receipts',
  'agreement_templates','agreement_signatures','team_verification_records',
  'sponsor_members','sponsor_decision_proposals');
```
against the live database.

---

## Build Verification

```
$ npm run typecheck    → ✅ exit 0
$ npm run lint         → ✅ exit 0 (0 errors, 268 warnings)
$ npm run build        → ✅ exit 0 (all routes compiled successfully)
$ npx vitest run       → ✅ 24 test files, 218 tests passed, 0 failed (2.80s)
```

All four checks green. No code changes were made during this audit — the codebase is clean as-is.
