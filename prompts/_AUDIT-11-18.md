# Audit Report: Prompts 11–18 Verification Sweep

**Date:** 2026-08-20
**Scope:** migrations `0084`–`0096`, commits `232fc49~1..HEAD`
**Method:** live production database (read-only; every write-shaped probe wrapped in
`BEGIN; … ROLLBACK;`), the `rls-auditor` and `action-reviewer` agents, and direct measurement
**Gates at time of report:** ✅ typecheck · ✅ lint (0 errors, 341 warnings) · ✅ build ·
✅ test (409/409) · `verify-backlog.mjs` 65 pass / 1 fail (DMARC, registrar-side)

---

## Executive summary

**One P0, found and fixed.** It was not in prompts 11–18's own logic — those slices are
well-built and their tables are correctly isolated. It was in the *tenancy primitive
underneath all of them*: migration `0084` rebuilt `prevent_role_elevation()` from a pre-`0073`
version and silently deleted two guards, leaving `profiles.sponsor_id` rewritable by its own
owner. Every sponsor-scoped policy in the range resolves through that column's fallback, so
one PATCH re-pointed all of them at once.

The pattern worth naming: **three of the most serious defects in this range are the same
mistake** — `CREATE OR REPLACE` losing something the file being replaced never mentioned.
`0093` (an undeclared variable that broke every e-signature), `0094` (a sponsor branch left on
the pre-`0082` pattern), and now `0096`. The migrations already warn about this for `REVOKE`.
The warning needs to cover function bodies too.

---

## Findings

| ID | Sev | Prompt | File:line | What's wrong | Production impact | Evidence | Status |
|---|---|---|---|---|---|---|---|
| **G-01** | **P0** | 11 | `0084:173-190` | `CREATE OR REPLACE FUNCTION prevent_role_elevation()` rebuilt the body from the pre-`0073` version, deleting the `sponsor_id` and `clerk_user_id` immutability branches `0073:72-81` had added — with the threat spelled out in `0073`'s own comment. `profiles_update_own` has USING but no explicit WITH CHECK, so Postgres defaults the check to the USING clause, which pins `clerk_user_id` **by coincidence** and says nothing about `sponsor_id`. | Any sponsor user, with only their own valid Clerk session and the public anon key, could re-scope themselves into another sponsor's tenant straight from PostgREST — no vulnerable server action needed. `sponsor_ids_for_profile()` keeps the legacy `profiles.sponsor_id` branch, so one column rewrite re-points `current_sponsor_ids()` and therefore *every* sponsor policy: submissions, funding_fulfillments, funding_capacity_releases, recognition awards/deliveries, impact snapshots, Q&A threads. | Reproduced on production in a rolled-back transaction: as `authenticated` with sponsor B's claims, `current_sponsor_ids()` → `{…B}`; `UPDATE profiles SET sponsor_id='<A>'` → **`UPDATE 1`**; `current_sponsor_ids()` → `{…A}`; tenant A's row readable. | **FIXED** — `0096`, applied twice. Same UPDATE now raises `sponsor_id modification not permitted`; coach self-edit still works; `service_role` can still stamp `sponsor_id`. |
| **G-02** | **P1** | 01/03 | `fulfillment.ts:190` | `adminOverrideFulfillmentStatus` runs on `requireAdmin()`, but since `0095` the `cancelled` transition decrements `sponsors.funding_used_cents`. Editing a funding cap is `requireSuperAdmin`, and that guard's own contract says it gates "the acts that move money." | A `reviewer` admin could hand back arbitrary sponsor capacity. **Regression introduced by `0095` in this same session** — before it, cancelling moved no money. | `fulfillment.ts:190` vs `sponsor.ts:18,64`; `0095:152` writes the release row. | **FIXED** — the `cancelled` branch alone is raised to `requireSuperAdmin()`; other overrides stay on `requireAdmin`. |
| **G-03** | **P1** | 09 | `sponsor-approvals.ts:89`, `:150` | `rejectFundingProposal` / `withdrawFundingProposal` filter on `.eq('status','pending')` but never check the rowcount. A guarded UPDATE matching nothing returns zero rows and **no error** in PostgREST. | When a racing approver confirmed the proposal — committing the money — a millisecond earlier, the action still wrote an `audit_log` row saying it was rejected and emailed the proposer to say so. The `status !== 'pending'` pre-read is a TOCTOU window, not a guard. | Both writes inspect only `updateError`. The correct pattern is already in `appeals.ts:281/:392/:464`. | **FIXED** — both `.select('id')` and refuse on zero rows. |
| **G-04** | **P1** | 01/03 | `fulfillment.ts:148`, `:243` | Sponsor notification fan-outs resolved recipients with `profiles.role='sponsor' AND profiles.sponsor_id = …`. | That column is stamped only on the original account holder, so a teammate invited through a Clerk Organization has it NULL forever. "Your payment was received" and "an administrator changed the payment status" reached **nobody** in a multi-user sponsor — and failed silently, because an empty recipient list is indistinguishable from a successful send. Same omission as `0094`, in the notification layer. | `recognition.ts:120-129` and `messages.ts:342-352` each already carried a correct union, with a comment warning about this exact case. | **FIXED** — helper hoisted to `lib/sponsor-recipients.ts`; `fulfillment.ts` uses it. |
| **G-05** | **P1** | 14 | `recognition.ts:307` | `waiveBenefit` used `requireSponsor()`, which admits any member regardless of rank, and `record_benefit_delivery` (`0087:414-434`) classifies the actor only as sponsor/coach/admin — never by rank. | A sponsor-org `viewer` could waive a benefit, permanently discharging an obligation the team owes. Nothing at either layer stopped it. | Read both layers; the RPC's role branch has no rank check. | **FIXED** — raised to `requireSponsorRole('submitter')`, matching the argument at `messages.ts:125`. |
| **G-06** | **P2** | 18 | `coach/dashboard-shell.tsx:457` | `hover:opacity-80` stacked on `text-primary` composites toward the cream canvas. | **3.69:1** on canvas, **3.88:1** on a card, against a 4.5:1 AA floor. axe does not evaluate hover, so the prompt 18 suite structurally could not catch it. One instance missed by the 2026-08-20 sweep of nine. | Measured against `--primary #1F6F5C` on `--background #F7F3EE`. | **FIXED** — darkens to `--primary-hover` (6.80:1). |
| **G-07** | **P2** | 18 | `ui/sheet.tsx:68` | The sheet close button carries shadcn's stock `opacity-70` **at rest**. | **2.90:1** for a non-text control against WCAG 1.4.11's 3:1 floor. The axe suite never opens a Sheet, so its contents have never been audited at all. | Measured against `--muted-foreground #6B6459`. | **FIXED** — 5.29:1 at rest, 16.07:1 on hover. |
| **G-08** | **P2** | 01/03 | `fulfillment.ts:48` | Ownership compared against a single `sponsorId` (`user.sponsor_id ?? sponsorIds[0]`). | A member of two sponsor orgs got a false "Fulfillment not found." on whichever org was not their primary seat. | `sponsor-decision.ts:90` and `recognition.ts:313` both scope by the full set. | **FIXED** — scoped by `sponsorIds`. |
| **G-09** | P2 | 14 | `recognition.ts:217` | `uploadBenefitProof` has **no Zod schema at all**; `deliveryId` is a raw client string interpolated into a storage key at `:258`. | Saved in practice by `loadDelivery` + the owner check running first, but it is the only mutating action in the range with zero validation — step 1 of the canonical shape. | Read the action. | **FIXED** — `uploadBenefitProofSchema` (`lib/schemas/recognition.ts`); the parsed uuid is what reaches the storage key. |
| **G-10** | P2 | 14 | `recognition.ts:351-396` | `adminSetBenefitStatus` notifies nobody. | An admin can force a benefit to `waived`/`delivered`, changing what the coach owes and what the sponsor believes was delivered, with no notice to either party. `adminVoidBenefitProof:431` does notify both. | Read the action. | **FIXED** — notifies the team owner (with the admin's reason verbatim) and every sponsor recipient; skipped when the RPC reports `already_in_status`, since nothing moved. |
| **G-11** | P2 | — | `sponsor.ts:96` | `metadata: data as any` writes the **unparsed** client argument into `audit_log`, including `contactEmail`. | Any extra key a caller attaches lands permanently in an admin-readable log. Staff email, not student PII — no COPPA breach — but an unredacted identifier kept forever. | Read the action; `result.data` is the parsed value and is not what is logged. | **FIXED** — both create and update log `auditFields(result.data)`: company identity plus the capacity-bearing fields, with contact name/email/title and `notes` deliberately excluded. |
| **G-12** | P2 | 15 | `app/api/admin/impact-report/route.ts:21` | A `reviewer` admin can export the platform impact report, while `/api/admin/export` is `requireSuperAdmin`. | Payload is aggregates-only, so a policy inconsistency rather than a leak — but `setAdminLevel`'s own copy tells users "exports … now need a super admin." | Compared the two routes. | **CLOSED — documented exemption.** Not raised: the whole impact feature (`/impact`, generation, publishing) is `requireAdmin`, so a reviewer would read the same numbers on screen and be refused the download. The route header now states the exemption and the condition that voids it (any per-sponsor or per-team breakdown). |
| **G-13** | P3 | — | `increment_sponsor_funding()` | The schema's only `SECURITY DEFINER` function with **no pinned `search_path`**. | Not exploitable: `EXECUTE` is revoked from anon and authenticated (`0062`), and it has zero call sites. It is dead code carrying a capacity-mutating `UPDATE sponsors`. | `has_function_privilege` → `f/f`; no call sites in app code. | **FIXED** — `0097`, applied to production. `pg_depend`/`pg_trigger` confirmed zero dependants first; the stale entry is also gone from `lib/supabase/types.ts`. |
| **G-14** | P3 | 13 | `appeals.ts:91` | `TODO(prompt 07): once team_verification_records and overrideTeamVerification exist…` — both shipped. | `team_verification` appeals still return "not available yet" against a dependency that has existed since prompt 07. A deliberate refusal, but the stated reason is now false. | `to_regclass('team_verification_records')` → exists; `overrideTeamVerification` at `admin.ts:709`. | **FIXED — wired up.** `createAppeal` accepts a record with `outcome='rejected'` owned by the caller (`checked_at` is the decision date, `original_decider_id` null — the matcher is not a person); `resolveAppeal` applies an overturn by **delegating** to `overrideTeamVerification` behind a still-rejected guard rather than duplicating it; `listAppealableSubjects` surfaces it. Six new action-level tests. |
| **G-15** | P3 | 01 | `lib/__tests__/fulfillment-invariants.test.ts:9` | `_AUDIT-01-10.md` F-05, re-examined. The original description was **wrong**: a leak nested *inside* an inner object IS caught. The real blind spot is a leak appearing *after* an inner object closes — `[^}]*` stops at the first `}`. | Test-coverage gap only. The invariant itself holds: `payment_reference` appears exactly once in the whole app, in the RPC argument list (`fulfillment.ts:57`), verified independently of the regex. | Ran all three shapes through the regex; `MISSED` on "leak after a nested object". | **FIXED** — brace-balanced extraction (`lib/__tests__/helpers/source-blocks.ts`); the missed shape is now caught, verified against a synthetic leak. |
| **G-16** | P3 | 03 | `lib/__tests__/remediation-invariants.test.ts:185` | `_AUDIT-01-10.md` F-06, re-examined — **does not currently reproduce.** The extraction returns 350 chars, so the test is live. | It stays fragile: the `^}` anchor requires the closing brace at column 0, so indenting `sendFulfillmentNudgeEmail` would silently make the test assert against an empty string. | Ran the extraction; length 350. | **FIXED** — `functionBody()` counts braces and **throws** when the declaration is absent, so a non-match can no longer masquerade as a pass. |
| **G-17** | P3 | — | six trigger functions | `prevent_role_elevation`, `guard_submission_writable_columns`, `guard_payout_profile_writable_columns`, `prevent_duplicate_team_owner`, `release_reservation_before_submission_delete`, `expire_proposals_on_submission_exit` are EXECUTE-granted to `authenticated`. | Not exploitable — Postgres rejects direct invocation of a `RETURNS TRIGGER` function — but inconsistent with the blanket-revoke stance elsewhere. | `has_function_privilege`. | **FIXED** — `0097` revokes ALL from `PUBLIC, anon, authenticated` on all six; re-verified `f/f`, and a trigger-firing write inside a rolled-back transaction still succeeded (Postgres does not check EXECUTE when a trigger fires). |

---

## Follow-on findings (2026-08-20, second pass)

Found by `action-reviewer` while reviewing the G-09…G-14 fixes, each re-verified by hand
before being acted on. Two of them are on the money path and predate this session.

| ID | Sev | File | What | Status |
|---|---|---|---|---|
| **H-01** | P1 | `sponsor.ts:97` | `adminUpdateSponsor` ran an unguarded `.update().eq('id', id)` with no `.select()`. A zero-row UPDATE is not an error in PostgREST, so a stale id returned `{ success: true }` **and** wrote an `update_sponsor` audit row whose `entity_id` names a sponsor that does not exist — on the platform's only funding-cap write path. Same defect class as G-03. | **FIXED** — `.select('id')` + refuse on zero rows; the `id` argument is also `safeParse`d as a uuid (it never was). |
| **H-02** | P2 | `sponsor.ts:44` | `adminCreateSponsor`'s audit row had no `entity_id`, so a company's creation could not be joined to its later cap changes. | **FIXED** — `.select('id').single()` and `entity_id: created.id`. |
| **H-03** | P2 | `sponsor.ts:118` | The update audit recorded only the new values, and `sponsors` holds only the current one — so the log could say what a cap became, never what it was. | **FIXED** — reads the row first and logs `{ from, to }`. |
| **H-04** | P2 | `recognition.ts:277` | `uploadBenefitProof` wrote the file to the public `pitch-media` bucket **before** the RPC ran. `0087` deliberately gave that bucket no DELETE path, so any RPC rejection left a permanently public, unreferenced photo — contradicting the action's own "a refused upload writes nothing to storage". | **FIXED** — the reachable rejection (`already_waived`) is checked from the already-loaded row before the upload. The narrow concurrent-waive race is documented in place rather than papered over; deleting from that bucket with the service role remains the separate change `0087` says it is. |
| **H-05** | P2 | `appeals.ts` (new code) | `team_verification_records` is append-only — one row per check attempt — so a coach who retried a number three times would see three independently appealable rejections, and a rejection later overturned by a passing re-check would still be offered. | **FIXED** — `listAppealableSubjects` keeps only the latest row per `(team_id, ftc_team_number)` and offers it only if that row is the rejection; `createAppeal` refuses a superseded record. |
| **H-06** | P2 | `admin.ts:728` | `overrideTeamVerification`'s UPDATE has no outcome filter, so a caller's pre-read is check-then-act: a concurrent override gets re-stamped and the incubator→existing flip re-fires. | **FIXED** — an optional `expectedOutcome` compare-and-set with a rowcount check. Optional on purpose: the admin verification card overrides `needs_review` and the appeal path overrides `rejected`, so the filter cannot be unconditional. |
| **H-07** | P3 | `appeals.ts` / `admin.ts` | A successful `team_verification` overturn sent the coach two notifications and two emails saying the same thing. | **FIXED** — `notifyCoach: false` on the delegated call; the appeal's own message stands. |
| **H-08** | P3 | four UI files | `subject_type` was rendered by two-way ternaries, so a `team_verification` appeal displayed as "Declined pitch" in the coach list and detail page, and as "coach verification" in the admin queue. | **FIXED** — one `APPEAL_SUBJECT_LABELS` map, plus the composed rejection reason and `FTC Team #N` label in the admin queue. |
| **H-09** | P2 | `appeals.ts` resolveAppeal | A partially applied overturn was unrecoverable: the subject effect is applied before the `appeals` UPDATE, so if that update failed the appeal stayed `under_review` while the subject had moved, and every retry died on the state guard (`.eq('status','declined')`, `.not('denied_at','is',null)`, `outcome='rejected'`). All three branches shared it. | **FIXED.** Inverting the order is NOT representable — `guard_appeal_transitions` (0086) rejects `overturned -> under_review` as un-resolving a terminal state, so claim-then-roll-back cannot work. Instead each overturn branch now re-reads its subject when the guarded UPDATE matches zero rows and treats *already in the exact post-state* as applied: `changes_requested` + `reviewed_at IS NULL` for a pitch, `denied_at IS NULL` for a profile, `outcome='overridden'` for a check (which also SKIPS the delegate, whose own compare-and-set would fail). Any other state is still a conflict. Four tests, incl. three ACCEPTANCE retries; the pre-existing `'overridden'`-is-a-conflict test was repointed at `auto_pass`. |
| **H-10** | P3 | `sponsor.ts:38,84` | Both entry points returned the flat string `'Invalid data provided'` instead of the joined issue messages conventions require. | **FIXED**. |

---

## Status of every `_AUDIT-01-10.md` finding

That report's findings went stale unread for eight days. Carried forward explicitly so it
cannot happen twice.

| Prior | Was | Now |
|---|---|---|
| F-01 cancellation does not release capacity | P2 | **CLOSED** — `0095`, this session. Proven on production: capacity 200000 → 0, one release row, drift zero, second attempt a no-op. |
| F-02 approver rejection doesn't decline the submission | P2 | **STILL OPEN, by design.** An internal org decision is not a submission decline; capacity releases at the 14-day expiry. Unchanged. |
| F-03 legacy `reserved_amount_cents = 0` drift | P2 | **MOOT** — zero such rows; `detect_capacity_drift()` returns zero rows against production. |
| F-04 `/receipts` not in the public matcher | P2 | **NOT A DEFECT** — prompt 04's acceptance criteria say "anon gets /login". Behaviour matches the contract. |
| F-05 fulfillment-invariants regex | P2 | **RE-SCOPED** — see G-15. Original example was wrong; a narrower blind spot is real. |
| F-06 remediation-invariants regex | P2 | **DOES NOT REPRODUCE** — see G-16. |
| F-07 `architecture.md` names `0075` | P3 | **CLOSED** this session — now names the real head. |
| F-08 `_CONTEXT.md` §2 stale | P3 | **CLOSED** this session — "applied since" now runs to `0095`. |
| F-09 preview fixtures lack new shapes | P3 | **CLOSED** — all 29 preview routes render clean across the three modes (`verify-previews.mjs`). |
| F-10 `TODO(legal)` on the live terms page | P3 | **CLOSED** this session. |
| F-11 `as any` / eslint-disable | P3 | **PARTIALLY OPEN** — the `as never` casts on `.update()` remain (a documented Supabase-types workaround, `team.ts:153`). Worth noting they mask a column-name typo, which is exactly how two a11y test fixtures referenced a column that never existed. |
| F-12 override reason 20 vs 25 chars | P3 | **PROMPT DRIFT ONLY** — code wins. |
| F-13 prompt 11 line references | P3 | **MOOT** — prompt 11 shipped. |
| F-14 no CI pipeline | P3 | **CLOSED** — `.github/workflows/ci.yml`, this session. Runs typecheck · lint · test · build on every push and PR with inert placeholder env (verified locally: the build completes with `.env.local` moved aside). The Playwright suite is deliberately excluded — it needs the Docker Supabase stack. |
| F-15 FIRST API credentials | P3 | **STILL OPEN** — yours. Running correctly on the FTCScout fallback. |

---

## Verified correct

Checked and genuinely fine — a report that only lists problems doesn't say what is safe.

**Liveness.** All of `0084`–`0096` are applied. The nine tables exist with RLS enabled;
`profiles.admin_level` exists. The five `CREATE OR REPLACE`-only migrations were verified via
`pg_get_functiondef`, not by trusting the file: `record_fulfillment_transition` carries both
the `0094` `sponsor_ids_for_profile` fix and the `0095` release block, and survived three
successive replacements with its REVOKE correctly re-issued each time. All four cron routes
are in `vercel.json` and all four return JSON `401` unauthenticated in production —
`/api/cron/impact-rollup` included, which closes the backlog's finding #1 (it used to 404
while firing daily).

**Tenant isolation (post-`0096`).** No `auth.uid()` survives anywhere in the live catalog —
`pg_policies` across `public` and `storage` returns zero rows for it. Every sponsor-scoped
policy resolves through `current_sponsor_ids()`. Cross-tenant probes on two synthetic tenants
returned 0 rows for every private table; anon gets 0 on all eight and exactly one row from
`public_platform_stats`. Coach C1 cannot see a sponsor's `pending` question — the moderation
gate holds.

**Read-only tables are genuinely read-only.** All eight have SELECT policies only, zero
write policies, confirmed in `pg_policies`. An authenticated INSERT into
`funding_capacity_releases` raises `42501`; twelve further write probes as coach and sponsor
all failed.

**RPC lockdown is live, not merely written.** All 38 mutating RPCs in the range return
`f/f` from `has_function_privilege()` for anon and authenticated. The functions still granted
are exclusively RLS policy helpers, which is required — revoking those breaks policy
evaluation.

**COPPA.** `lib/impact-report/projection.ts` is a strict allowlist driving both the
PostgREST `.select()` and key-by-key output construction; it never joins `profiles`, and the
only `...` and `profiles` occurrences in the file are inside comments explaining their own
absence. Photo exposure is gated on `media_no_minors_confirmed_at`, enforced by a live CHECK
(`proof_requires_no_minors_affirmation`) rather than by application code.

**Capacity.** `detect_capacity_drift()` returns zero rows against production with the new
three-term invariant. An appeal overturn moves no capacity — correctly, because an
admin-stage decline never reserved any (`sent_at` is the marker, guarded at `appeals.ts:123`
*and* `:570`). A sponsor-declined pitch cannot be appealed.

**Config-vs-history separation.** Prompt 14 snapshots `tier_name`, `tier_rank`,
`tier_min_amount_cents` and `benefits` onto the award, so editing a tier structurally cannot
rewrite an existing award. Prompt 15's closed-year guard is in the database
(`upsert_impact_snapshot` returns `year_closed`), and since the table has no write policy that
RPC is the only write path.

**Prompt 16.** The corporate-domain gate is sponsor-only and says so at `auth.ts:200`, `:241`
and `:373`; the coach path never calls it, so a coach with a `gmail.com` address completes the
wizard. Audit metadata stores `email_domain`, never a full address.

**Preview modes.** All 29 routes across the three dev preview modes render clean — checked
in a real browser for error-boundary text and console errors, because a 200 proves nothing
here (Next serves error boundaries with a 200).

**Server actions.** The `action-reviewer` pass found the five-step shape intact across
`appeals`, `messages`, `impact`, `sponsor-approvals`, `sponsor-decision` and `admin`, with
correct client selection, no admin-client import reaching a Client Component, and no
message body, appeal statement, proof URL, payment reference, EIN or student PII in any
`audit_log` metadata or notification payload.

---

## The owed E2E sweep (2026-08-20)

The 22 `SUPABASE_LOCAL`-gated specs had not run since prompt 11. They now have, against the
local Docker Supabase stack at migration `0097` — never against production.

**Result: 166 passed · 0 failed · 10 skipped**, reproduced three times — chromium once, then
firefox twice back to back, because the defect that motivated the repeat run produced exactly
one failure per run in a *different* spec each time. WebKit is excluded from the sweep: it
cannot reach Clerk's FAPI at all, so every sign-in in that project fails for a reason that has
nothing to do with this codebase.

The suite did not simply pass — it had to be repaired first, and the first pass was
**silently under-reporting**. Seven harness defects, each confirmed before it was touched:

| # | File | Defect | Why it mattered |
|---|---|---|---|
| 1 | `admin-levels.spec.ts` | The skip gate required `REVIEWER_PASSWORD`, a credential the sign-in path **cannot use** — sign-in has been ticket-based since the Clerk migration. | Five reviewer-boundary tests had been skipping silently, reported as "skipped", never as missing. |
| 2 | `helpers/clerk-auth.ts` | `clerk.signIn()` resolves a beat **before** `window.Clerk.session` exists. A `goto` issued in that window carries no session, so `clerkMiddleware` redirected it to `/login` and the test asserted against the login form. | **The root cause of the one-random-failure-per-run pattern.** Both sign-in helpers now await the live session. |
| 3 | `helpers/clerk-auth.ts` | The `gotoStable` retry regex matched `NS_BINDING_ABORTED` and `frame was detached` but not `interrupted by another navigation` — the same race, a third message. | 22 firefox failures. |
| 4 | `helpers/clerk-auth.ts` + 11 specs | `gotoStable` returned `void`, so every `const r = await page.goto(...)` site that asserts on status had to bypass it. | It now returns the `Response`; those sites are routed through it. |
| 5 | `sponsor-domain-gating.spec.ts` | Keeps its **own local copies** of `gotoStable` and `signIn`. | Fixing the shared helper fixed nothing here; both copies needed the same two repairs. |
| 6 | `payout-w9.spec.ts` | The `beforeAll` fixture resolved a coach first and derived the team, and Postgres reorders rows physically on UPDATE. The fallback produced an all-zeroes uuid. | Order-dependent failures. Now resolves the team first and derives its owner. |
| 7 | `agreement-signing.spec.ts:105` + `global-setup.ts` | Two independent copies of the capacity re-sync arithmetic, **both wrong**. The spec force-zeroed a *sponsor-wide* counter after a cleanup that only removed ledger rows for one `(team, sponsor)` pair. Global setup re-synced with a formula that counted `changes_requested` as an open reservation (the real statuses are `dispatched`/`delivered`/`opened`) and omitted the `funding_capacity_releases` term entirely. | Either one hands the run a **non-zero starting drift**, and the CAPACITY NON-REGRESSION preconditions in `appeals` and `recognition-tiers` assert *global* zero drift. They failed on chromium and passed on firefox purely on run order. Both now mirror `detect_capacity_drift()`'s body exactly, dumped with `pg_get_functiondef` rather than read off a migration file. Proved in a rolled-back transaction: the old force-zero yields a drift row, the re-derivation yields zero. |

**A coverage gap the green run does not close.** Eight of the ten skips are in `qa-thread`,
and they are not optional-feature skips — they need a live `dispatched`/`delivered`/`opened`
submission, and `submissions` is empty on a clean local DB. **The `0085` database-enforcement
coverage for the Q&A moderation gate has therefore never actually executed**, in this sweep or
any earlier one. The remaining two skips are legitimate: one dialog-focus a11y test and one
reviewer funding-cap test. Closing the `qa-thread` gap needs a seeded dispatched submission,
which is its own change.

**Gate at the close of the sweep:** ✅ typecheck · ✅ lint (0 errors, 340 warnings) ·
✅ test (419/419) · ✅ build · ✅ e2e (166/0/10 ×3).

---

## Not verified, and why

- ~~**The E2E suite did not run.**~~ **CLOSED — the sweep ran clean on 2026-08-20.** See
  "The owed E2E sweep" below for the numbers and the seven harness defects it exposed.
- **Prompt 17's complaint path stays inert** until the Resend webhook is subscribed to
  `email.complained`. The code is correct and unit-tested; it has never received a real event.
- **DMARC** is still unpublished at `_dmarc.exodiusftc.com` — the one failing automated check.
