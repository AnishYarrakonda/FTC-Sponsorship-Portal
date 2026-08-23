# Finish everything — the last session of the audit pack

**Written 2026-08-23**, at the close of the P0 + P1 sweeps. This is the complete remaining
surface. When this file is done, there is nothing left in the 102-finding Gemini audit pack.

**Start this session with `--dangerously-skip-permissions`.** Phase 0 cannot run without it —
the auto-mode classifier denies production `psql` even for `SELECT 1`, regardless of the
`Bash(psql *)` allow-rule already in `.claude/settings.local.json`.

---

## Read first

- `CLAUDE.md`, `.claude/rules/{architecture,auth-supabase,conventions,workflows}.md`
- `prompts/audits/_ORCHESTRATOR-STATE.md` — what the P0/P1 sweeps actually found
- `prompts/audits/_RESUME-AFTER-RESTART.md` — **the Phase 0 runbook, not optional**
- The per-finding detail lives in `prompts/audits/handoff/<ID>-claude-prompt.md` and the
  evidence in `prompts/audits/findings/<ID>-findings.md`. Both are gitignored on purpose and
  exist only on this machine. Read the relevant block before touching a finding.

## Non-negotiable rules (unchanged from every handoff)

- `.env.local` points at **PRODUCTION** Supabase and Clerk. There is no staging. Every DB write
  from this repo is a production write.
- **Never** run `node scripts/seed-test-accounts.mjs` — it truncates production tables.
- **Never** run `supabase db reset` or `supabase db push`. `db push` is especially dangerous
  here: the ledger thinks 0076–0105 are unapplied, so it would try to replay 30 migrations
  against a database that already has most of them.
- **Never** rebuild a Postgres function body from an older migration file. Dump the **live**
  body with `pg_get_functiondef` and edit that. Doing otherwise has silently deleted later
  fixes three times in this repo, once costing a P0 tenant takeover.
- Migrations are numbered, sequential, idempotent. `ls supabase/migrations | tail -3` before
  adding one — **the latest is `0105`**.
- Anything behavioural gets reproduced on the **local Docker stack** (`npx supabase start`,
  API 54321 / DB 54322). Export the local `NEXT_PUBLIC_SUPABASE_URL` /
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` (from `npx supabase status -o
  json`) **plus a dummy `PAYOUT_ENCRYPTION_KEY`** into the shell **before** `npm run dev`.
  dotenv does not override shell variables, and that ordering is the only thing keeping the run
  off production. Without `PAYOUT_ENCRYPTION_KEY` (a Vercel-only var) every page 500s and it
  looks like a code regression.
- `SUPABASE_LOCAL` is a boolean gate for Playwright. Setting it truthy unskips E2E specs that
  INSERT/UPDATE/DELETE against whatever `NEXT_PUBLIC_SUPABASE_URL` points at. Verify the URL is
  local before you set it, or global-setup DELETEs from production.
- Deploys are manual: `vercel deploy --prod --yes`. Pushing to `main` deploys nothing.

## The discipline that matters most

**Reproduce every finding before you fix it.** Across the 57 P0+P1 findings already worked,
**6 were wrong**: 5 phantoms and 3 whose stated mechanism was wrong (the counts overlap). The
worst case, `A-08-02`, computed contrast against the wrong background — **its proposed fix would
have introduced the WCAG failure it claimed to fix.** Two phantoms came from reading a page
without its route-group layout. Assume the same error rate in P2/P3, which was audited to a
lower bar than P0/P1.

If a finding does not reproduce, **say so explicitly with the evidence** and move on. A phantom
you "fixed" is a regression you invented.

---

# Phase 0 — production database (do this first, nothing else is safe to claim done without it)

Execute `prompts/audits/_RESUME-AFTER-RESTART.md` end to end. Summary of what it covers:

```bash
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
set -a; source .env.local; set +a      # DATABASE_URL
```

**Migrations `0098`–`0105` are applied and proven on LOCAL ONLY. Production has none of them.**

1. **Pre-flight drift check (read-only).** `0099`, `0100`, `0101` are `CREATE OR REPLACE` bodies
   authored from **local** dumps. For each of `sign_agreement_atomic`,
   `sponsor_decide_submission_atomic`, and `issue_funding_receipt`: dump the **production** body
   with `pg_get_functiondef`, diff against local, and only proceed where they match. Where they
   differ, re-author the migration on top of the **production** body, re-verify on local, then
   apply. Also confirm production has `is_trusted_server_context()`,
   `sponsor_member_role_rank(text)`, `current_sponsor_ids()`, `detect_capacity_drift()`.

2. **Apply in order, one transaction each**, asserting the post-condition before `COMMIT`:

   | Migration | Assert before COMMIT |
   |---|---|
   | `0098` anon notification INSERT | `service_insert_notifications` gone from `pg_policies`; `anon` holds no INSERT/UPDATE/DELETE grant on `notifications` |
   | `0099` sign-agreement rank gate | live body contains `sponsor_member_role_rank(...) < ...'approver'` |
   | `0100` capacity signed delta | live body contains the `v_delta` reconciliation |
   | `0101` anon actor fall-through | live body contains `ELSIF is_trusted_server_context()` **AND still contains `v_delta`** |
   | `0102` teams_update verified-coach | `pg_policies` shows `is_coach_verified()` in both USING and WITH CHECK |
   | `0103` pending_storage_deletions | table exists, RLS enabled, `anon` has no grant |
   | `0104` override_reason CHECK | constraint no longer requires `overridden_by IS NOT NULL` |
   | `0105` submissions indexes | both `idx_submissions_updated_at` and `idx_submissions_status_updated_at` exist |

   **`0101` supersedes `0100`'s body.** Apply in order, or `0101` alone. **Never apply `0100`
   after `0101`** — it reverts the anon gate.

3. **Post-apply verification.**
   - **A-02-01** — with the public anon key, `POST /rest/v1/notifications` **without**
     `Prefer: return=representation` must be refused. That header matters: with it, the RETURNING
     clause is checked against the SELECT policy and a genuine INSERT hole reads as a false
     negative. This is exactly how the exploit was nearly missed. Then confirm
     `createInAppNotification` still works via the service-role path.
   - **A-04-01** — `SELECT * FROM detect_capacity_drift();`. Any rows are **pre-existing damage
     from before `0100`**, not a regression. **Census and report them. Do not silently correct
     money state** — bring the numbers back and let Anish decide.
   - **B-02-01 / B-03-01** — read-only confirmation only. Do **not** drive a live signature or
     mint a live receipt in production; both were proven end-to-end on local.

4. **Ledger repair** (recommended, gated on step 1 passing): insert `0076`–`0105` into
   `supabase_migrations.schema_migrations` so `migration list --linked` stops claiming
   production is at 0075.

> **Until `0098` lands, the anon notification-forgery hole is live and remotely exploitable in
> production with nothing but the public anon key.** Phase 0 is the highest-value work in this
> file. Do it before any P2.

---

# Phase 1 — the EIN census and its decision

Read-only, then a judgement call.

`A-06-01` was fixed **forward only** — receipts now render last-4. Receipts issued *before* that
fix still carry a full decrypted EIN in stored `document_html`, and those documents were emailed.

1. Count `funding_receipts` rows whose `document_html` matches `\d{2}-\d{7}` or a bare `\d{9}`.
2. **Then decide, and do not leave it open.** The tension: re-rendering an issued receipt changes
   its `document_sha256`, and the immutability of an issued financial document is the whole point
   of storing that hash. Options, in the order I'd weigh them:
   - **Zero rows** → nothing to do. Record it and close the item.
   - **A handful** → redact `document_html` in place, **preserve the original
     `document_sha256` in a new column** (e.g. `original_document_sha256`) plus a
     `redacted_at` timestamp, and write an `audit_log` row per receipt. The document's integrity
     record survives; the plaintext EIN does not. This is my recommendation.
   - **Many** → same mechanism, batched, but report the count to Anish before executing.
   Whichever you pick, the deliverable is a **decision plus its migration**, not another deferral.

---

# Phase 2 — the P2 tier (30 findings)

Work in blast-radius order, not pack order. Each group ends in its own gate + commit + PR +
merge + `vercel deploy --prod --yes`, the same rhythm the P1 sweep used.

### Group P2-A — money, capacity, and state correctness (9)
| ID | Claim |
|---|---|
| `A-04-02` | `needs_legal_review` does not gate agreement signing [INFERRED] |
| `A-04-03` | Orphaned fulfillments bypass signature gating on cancel [INFERRED] |
| `B-03-11` | The sponsor access token is never burned or revoked on a terminal decision |
| `B-03-12` | Nobody can withdraw a dispatched pitch; it holds the sponsor's capacity for the full 14 days |
| `B-03-14` | One receipt shows two different issue dates on two surfaces |
| `B-03-15` | An overturned appeal drops the pitch into "Changes requested", carrying the decline text that was just overturned |
| `B-03-16` | Deleting a coach account with a sponsor's paid commitment in flight warns nobody [INFERRED] |
| `A-11-06` | The capacity invariant script is a tautology — it asserts what it computed |
| `A-03-03` | Missing `revalidatePath` on sponsor decision |

`B-03-12` is the one to think hardest about: capacity is a Core Mandate, and a withdraw path
touches the same signed-delta reconciliation `0100`/`0101` just fixed. Reproduce on local against
the **live** function body, and add a `detect_capacity_drift()` assertion to the test.

### Group P2-B — security and access (5)
| ID | Claim |
|---|---|
| `A-02-04` | Missing `WITH CHECK` on UPDATE policies — a row can be updated into a state the USING clause would have refused |
| `A-06-03` | Long-lived signed URLs for government IDs |
| `A-06-04` | Missing safe-URL validation for `media_urls` in impact reports [INFERRED] |
| `A-10-05` | Unthrottled `/sponsor-view` token views risk DB exhaustion [INFERRED] |
| `A-01-03` | `requireSponsor` fails **closed** to `LEGACY_MEMBER_ROLE` on error [INFERRED] |

`A-02-04` needs a full `pg_policies` sweep, not a spot check — enumerate every UPDATE policy and
report the ones with a null `with_check`. `A-06-04` is an SSRF/stored-XSS shape; validate scheme
and host, do not just regex the string.

### Group P2-C — coach and sponsor journeys (7)
| ID | Claim |
|---|---|
| `B-03-09` | "Local Connection Notes" is collected from the coach, stored unsanitized, and rendered **nowhere** — including to the admin moderating the pitch |
| `B-03-10` | Draft autosave writes to `submissions` with **no validation at all** |
| `B-03-13` | Contradictory W-9 state: the funding page says "missing" and links to a page that says "verified" and offers no upload control |
| `A-05-04` | Duplicate emails to the coach on sponsor approval |
| `A-07-03` | Truncated cents on rendered currency amounts [INFERRED] |
| `A-07-04` | Raw status strings rendered for receipts instead of `StatusBadge` [INFERRED] |
| `B-01-4` | The `NEEDS_VERIFICATION` path is a UI dead end [INFERRED] |

`B-03-10` is the sharpest: an unvalidated write path into `submissions` sidesteps every Zod
schema in `lib/schemas/`. Check whether it can set `status`, `sponsor_id`, or any amount column —
if it can, it is a P0 wearing a P2 label, and it gets fixed first and said so plainly.
`A-07-03` is money on screen; verify against `Intl.NumberFormat` output, not by eye.

### Group P2-D — accessibility (7)
| ID | Claim |
|---|---|
| `B-04-07` | Read-only account fields are unlabelled disabled inputs on every settings surface |
| `B-04-08` | The landing page scrolls horizontally at 320 px |
| `B-04-09` | Horizontally scrollable regions with no keyboard access |
| `B-04-10` | The destructive text colour fails AA on both page backgrounds |
| `B-04-11` | The "Awaiting W-9" badge fails contrast |
| `B-04-12` | The E2E dialog-focus accessibility test can never run |
| `A-08-04` | The global command palette does not trap focus [INFERRED] |

**Compute contrast against the element's real ancestor background.** `A-08-02` was a phantom
precisely because the audit assumed the cream page background under an element sitting on a
`CharcoalCard`. Let animations settle before any axe scan — axe skips `opacity:0` elements
entirely and reports phantom failures mid-fade. Pin ratios with computed WCAG maths in the test,
not hard-coded hex values, the way `lib/__tests__/p1-group6-a11y.test.ts` does.

`A-08-04` was partly addressed when the palette was rebuilt on `<Dialog>` in the P1 sweep —
**verify against the current component before fixing anything.** See Phase 4 for the live-mount
problem.

### Group P2-E — enterprise (2)
| ID | Claim |
|---|---|
| `A-12-05` | Missing self-serve audit log for sponsor admins [INFERRED] |
| `A-12-06` | Missing marketing asset export [INFERRED] |

Both are net-new product surface, not bugs. `A-12-05` is genuinely useful and the data already
exists in `audit_log` — build it read-only, scoped through `current_sponsor_ids()`, and make
sure it cannot leak another org's rows or any student PII (COPPA). `A-12-06` — judge whether
there is a real asset to export; if the answer is "there is no asset library", say that and
close it as not-a-defect rather than inventing one.

---

# Phase 3 — the P3 tier (16 findings, 18 bullets across 6 packs)

One sweep, one commit. These are genuine polish and most are one-liners.

**`app/actions/`**
- `moderation.ts:12` and `sponsor-decision.ts:18` — hardcoded `z.string().max(2000)`; use
  `LIMITS.feedback`.
- `moderation.ts:122` — sponsor `createInAppNotification` on approval lacks `skipEmail: true`,
  so the sponsor gets the real pitch email from `dispatchApprovedSubmission` **and** a duplicate
  generic one.
- `moderation.ts:104-111` — the coach's approval notification has a title and no `body`, while
  the admin's dispatch preview promises specific wording.

**Components**
- `components/sponsor/review-shell.tsx:473` — the confirm dialog interpolates the raw enum:
  "Are you sure you want to **APPROVED** this submission?" — read at the moment money is committed.
- `components/admin/appeal-review-panel.tsx:256` — `Confirm {outcome ?? 'decision'}` renders
  "Confirm overturned".
- `components/messages/thread-panels.tsx:46,48` — the same sentence passed as both
  `closedNotice` and `emptyState`, printing it twice in a row.
- `components/coach/portfolio-tab.tsx:331-334` — `.single()` on `team_payout_profiles` throws a
  console `406` on every `/team/edit` load for a team with no payout profile; `.maybeSingle()` is
  the intended call and `app/(coach)/dashboard/page.tsx:63` already uses it.
- `components/coach/portfolio-tab.tsx:352,372` — "Please fix N errors above" without scrolling to
  the first invalid field.
- `components/impact/impact-report-view.tsx:99` — `t.tax_status` joined straight in, so a team
  with no charitable status renders "… · Dayton, OH · **None**", and `None` lands in the sponsor
  CSR CSV column too.
- `components/sponsor/sponsor-fulfillment-row.tsx:19` — `en-GB` date formatting where the rest of
  the app uses `en-US`.

**Accessibility polish**
- `components/ui/dialog.tsx` — base-ui `Popup` has no `aria-modal` and nothing outside is `inert`.
  **Use base-ui's own modal option, which applies real background inertness. Do NOT hand-add
  `aria-modal`** — that is worse than none, because it tells assistive tech the background is
  unreachable when it isn't.
- `components/admin/proof-review-queue.tsx` — the reason `<Input>` has only a placeholder: no
  label, no `aria-label`, and the destructive button stays disabled until 10 chars with the rule
  stated only in a placeholder that vanishes on the first keystroke. Add `id` + `<label htmlFor>`
  + persistent `aria-describedby`.
- `components/ui/table.tsx` — no `scope` attribute exists anywhere in the codebase while seven
  files render `<th>`. Add `scope="col"` in `TableHead`. Also give the audit-log table's empty
  fifth header cell visually hidden text.
- `components/ui/textarea.tsx` — **measured at 4.49:1 between rest and focus and 5.29:1 against
  the field background, so it PASSES 2.4.7 and 1.4.11. Not a violation.** It is a 1px border
  where the rest of the app uses a 2px ring — align it for consistency only.

**Docs**
- `.claude/rules/architecture.md:19` lists `cron/expire-submissions` as the only cron route.
  **This bullet is stale** — `A-09-05` consolidated the crons behind `daily-maintenance` and the
  rule file was already updated. Verify, then close it as already-done.

---

# Phase 4 — the five items deliberately left open (each gets a decision, not another deferral)

The user's instruction is that the app is **fully functioning** at the end. So none of these may
be handed back as "pending". Each needs either a build or a written, reasoned closure.

1. **`B-03-08` — the governing-law clause.** Section 11 of the effective `sponsorship_agreement`
   template still reads `TODO(legal): jurisdiction to be set by counsel.` The P1 sweep
   deliberately did not invent one and surfaced the existing `needs_legal_review` flag to the
   signer instead. **Do not fabricate a jurisdiction into an ESIGN/UETA-executed document whose
   exact bytes are SHA-256'd as evidence.** What you *can* do, and should: verify the
   `needs_legal_review` banner actually blocks or clearly warns before signature (this overlaps
   `A-04-02`), and add a test pinning that an agreement carrying the TODO cannot be
   countersigned. Then **tell Anish in one line what he has to get from counsel.** That is the
   honest close.

2. **`A-12-01` — the sponsor org switcher.** The app currently refuses second-org membership by
   design. Building a switcher reverses that invariant. **Ask Anish**: does a sponsor user ever
   legitimately belong to two orgs? If yes, build it. If no, delete the finding and keep the
   test that pins the invariant.

3. **`A-12-04` — PO numbers / fiscal-year budgets.** Net-new finance surface. Half-building it
   leaves money state in two shapes. **Ask Anish** whether any real sponsor has asked for a PO
   number. If yes, build it end-to-end (schema → action → sponsor UI → CSR export). If no, close
   it as a product decision with the reason recorded.

4. **The EIN backfill** — resolved by Phase 1. It does not survive this session as an open item.

5. **`B-04-05` — never verified live.** The command palette doesn't mount under coach-preview
   because Clerk 403s, which was confirmed pre-existing by testing the old component too. It is
   build- and type-verified only. **Fix the verification gap**: sign in for real against the
   local Docker stack with a seeded Clerk test user (OTP `424242`) so the palette actually
   mounts, then drive Cmd-K → focus trap → Escape → focus restoration with Playwright. This also
   clears `A-08-04` and `B-04-12` properly instead of by inspection.

---

# Phase 5 — prove the app actually works end to end

The user's bar is "the app should be fully functioning." Inspection is not proof. Do all of it:

1. **Full gate:** `npm run typecheck && npm run lint && npm run test && npm run build`.
   Baseline entering this session: typecheck clean, lint 0 errors, **550/550 tests in 45 files**,
   build exit 0. Anything below that is a regression you introduced.
2. **Full E2E against the LOCAL stack.** Export the local Supabase vars **plus**
   `PAYOUT_ENCRYPTION_KEY` into the shell, confirm `NEXT_PUBLIC_SUPABASE_URL` is `127.0.0.1`,
   *then* set `SUPABASE_LOCAL=1` and run `npx playwright test`. Last known: **166 pass / 0 fail /
   10 skipped**. Investigate every one of the 10 skips — some are the WebKit/Clerk limitation
   (real), some may now be runnable.
3. **Regression tests for every silent failure.** Both of the worst P0s were invisible because
   nothing asserted on them. Every P2/P3 whose failure mode is silent gets a test.
4. **Deploy:** `vercel deploy --prod --yes`.
5. **Production smoke** (read-only). Last known good:
   `/` 200 · `/api/health` `{"ok":true,"service":"up","db":"ok"}` · `/legal/terms` 200 ·
   `/sponsors/apply` 200 · `/dashboard` 307 · `/api/admin/export` 401 ·
   `/api/cron/daily-maintenance` 401.
6. **Update the records:** `prompts/audits/_ORCHESTRATOR-STATE.md` (a P2/P3 section in the same
   shape as the P0/P1 ones) and `prompts/_NEXT-SESSION.md`.

---

## Definition of done

- [ ] Migrations `0098`–`0105` live in **production**, each post-condition asserted
- [ ] Anon notification-forgery probe refused **without** `Prefer: return=representation`
- [ ] `detect_capacity_drift()` census reported (rows ≠ failure; unreported rows = failure)
- [ ] EIN census counted **and its decision executed**
- [ ] All 30 P2 findings fixed, or documented as not reproducing **with evidence**
- [ ] All 16 P3 findings fixed, or documented as already-done
- [ ] All five Phase-4 items closed with a build or a written decision — **zero left "pending"**
- [ ] `B-04-05` / `A-08-04` / `B-04-12` verified against a **live-mounted** command palette
- [ ] `npm run typecheck` clean · `npm run lint` 0 errors · `npm run test` ≥ 550 passing ·
      `npm run build` exit 0
- [ ] `npx playwright test` against local: 0 failures, every skip explained
- [ ] Deployed to production and smoke-tested
- [ ] `_ORCHESTRATOR-STATE.md` and `_NEXT-SESSION.md` reflect reality

## Report at the end

What was fixed · what did not reproduce (with the evidence, since the phantom rate is itself a
finding about the audit pack) · what was closed by decision rather than code, and why · anything
found that the pack never saw. The P0/P1 sweeps turned up two such defects — migration `0104`
and a raw-error leak — both discovered while *proving* other findings. Expect more.
