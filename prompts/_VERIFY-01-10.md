# Verification sweep — prompts 01–10

You are auditing ten already-shipped implementation slices for silent bugs, drift, and
half-landed work. **You are not building features.** Your job is to prove each slice is
actually correct and actually live, find what quietly broke, and fix only what you can prove
is broken.

## Ground truth to read first (in this order)

1. `CLAUDE.md` and `.claude/rules/*.md` — Core Mandates and the auth/Supabase patterns.
2. `prompts/_CONTEXT.md` — the schema and architecture ground truth prompts 01–18 share.
3. `prompts/README.md` — the Progress table and locked decisions.
4. `prompts/01-*.md` through `prompts/10-*.md` — each prompt's acceptance criteria. Treat
   the acceptance criteria as the contract each commit was supposed to satisfy.

## Scope

Everything between `f88e6b8~1` and `HEAD` (187 files, migrations `0076`–`0083`), i.e. these
commits:

```
f88e6b8 feat(fulfillment): funding fulfillment machine            (01)
3c9d7cc feat: Team Payout Profiles and W-9 collection             (02)
701e268 feat(payout): enhance W-9 handling and payout profile     (02)
108f203 feat(funding): sponsor, coach and admin surfaces          (03)
f96f117 feat: funding receipts and acknowledgment letters         (04)
89b7ac4 feat(agreements): versioned sponsorship agreement templates (05)
f3130f6 feat(esign): in-house ESIGN capture + agreement gate      (06)
a3d0d8c feat(verification): verify FTC teams against FIRST roster (07)
01df546 feat(sponsors): Clerk Organizations multi-user accounts   (08)
1ab5acf feat(sponsors): org roles and two-step funding approver   (09)
1aa4b57 feat(auth): enterprise SSO via Clerk connections          (10)
```

Read the real diffs (`git show <sha>`), don't infer from commit messages.

## Rules of engagement

- **Evidence or it didn't happen.** Every claim in your report cites `file:line`, a command
  you ran with its output, or a query you executed. No "should work", no "appears correct".
- **Investigate everything before fixing anything.** Produce the full findings list first.
- **Do not rebuild working code.** If something looks missing, grep harder — this pack has a
  documented history of agents rebuilding features that already existed (capacity release,
  FTC lookup, sponsor-apply throttling all already exist; see the README table).
- **The code wins over the prompt.** Where a prompt's "Current state" text contradicts the
  code, the code is truth and the prompt is stale — note it, don't code around it.
- **Stay in scope.** Bugs outside prompts 01–10 get reported, not fixed.
- Never violate a Core Mandate (COPPA, admin-gatekept outreach, capacity integrity,
  portfolio-vs-submission separation) in the name of a fix.

## Phase 1 — Is it even live?

The single highest-value check, because this repo has already been bitten by it: **code
merged is not code deployed, and a migration in `supabase/migrations/` is not a migration
applied.** Deploys here are manual (`vercel deploy --prod --yes`); pushing to `main` does
nothing.

1. `ls supabase/migrations | tail -12` — confirm `0076`–`0083` exist and the numbering has no
   collisions or duplicates.
2. Connect to the live Postgres and confirm each of `0076`–`0083` is actually applied: the
   tables, columns, enum values, constraints, indexes, triggers, and functions they declare
   all exist. A migration file with no corresponding live object is a **P0**.
3. Confirm every migration is genuinely idempotent — re-runnable from scratch and re-runnable
   on top of itself. Check for enum values added after type creation, bare `CREATE POLICY`
   without a `DROP POLICY IF EXISTS`, `ALTER TABLE ADD COLUMN` without `IF NOT EXISTS`.
4. Confirm the deployed Vercel build actually contains these commits (`vercel ls` / project
   inspect), and that every new env var the code reads (`lib/env.ts`, plus anything read via
   `process.env` in the changed files — e.g. `PAYOUT_ENCRYPTION_KEY`, `FIRST_API_USERNAME`,
   `FIRST_API_TOKEN`) is present in the Vercel project for Production. Missing = report with
   the exact runtime failure it causes and whether it fails open or closed.
5. Confirm every cron route added by these prompts is registered in `vercel.json`
   (`/api/cron/nudge-fulfillments`, `/api/cron/refresh-ftc-roster`, plus the pre-existing
   `expire-submissions`), and that each route authenticates the caller rather than being an
   open endpoint.

## Phase 2 — Core Mandate integrity

For each, prove it with a query or a traced code path, not by reading a comment.

- **Capacity integrity.** Reservation and release must balance under every path the new code
  introduces: fulfillment state transitions, admin override, agreement decline/expiry,
  approver rejection in the two-step workflow, submission delete, nightly expiry cron, and
  bounce. Write out the full state machine from `lib/` + the migrations and look for a
  transition that reserves without a matching release, double-releases, or lets a reservation
  exceed a sponsor's remaining cap under concurrency. Check the numbers actually reconcile in
  the live DB (`sum(reserved) vs sponsors.capacity`).
- **Admin-gatekept outreach.** No path added in 01–10 may email a sponsor a pitch outside
  `dispatchApprovedSubmission` in `lib/dispatch.ts`. Grep every new Resend call and new email
  template (`emails/*`) and classify each as transactional-notification (allowed, both inbox
  and email) or sponsor outreach (must be gated). Receipts, acknowledgment letters,
  fulfillment nudges, and agreement notices each need this call made explicitly.
- **COPPA.** No new column, query, export, PDF, receipt, acknowledgment letter, agreement
  merge field, or CSR-adjacent surface may expose student PII to non-admins. Check the
  agreement merge-field allowlist (`lib/agreements/merge-fields.ts`) and receipt/letter
  rendering especially — those interpolate team data into documents.
- **Portfolio vs submission separation.** Confirm 01–10 didn't duplicate global team facts
  onto `submissions` or vice versa.

## Phase 3 — Auth, RLS, and the riskiest change in the pack

Prompt `08` rewrote how a sponsor is resolved in RLS (previously `profiles.sponsor_id`, now
also `sponsor_members` / `sponsors.clerk_org_id`). That is the most likely source of a silent
data-exposure bug in this entire range.

- Run the `rls-auditor` agent over every table touched or created by `0076`–`0083`.
- Confirm **no** policy anywhere uses `auth.uid()` (it is NULL under Clerk). Grep all of
  `supabase/migrations/` — a single stale `auth.uid()` policy silently denies or, worse,
  combined with a permissive sibling policy, silently allows.
- Confirm every new table has RLS **enabled** (not just policies written — enabled).
- Prove the negative cases by executing them, not by reading policies: sponsor A cannot read
  sponsor B's payout profiles, receipts, agreements, signatures, members, or approvals; a
  `viewer` cannot approve funding; a coach cannot read another team's submission-specific
  data; an unverified coach cannot submit.
- Check every `SECURITY DEFINER` function added by `0076`–`0083` has an explicit
  `REVOKE ... FROM PUBLIC` / restricted grant and a pinned `search_path`. Defaulting to
  PUBLIC is a documented trap in `_CONTEXT.md`.
- Storage: any new bucket path (W-9 uploads, signed agreement artifacts) must partition by
  the Clerk user id in the first path segment, with matching storage RLS.
- Confirm the two-step approver workflow can't be bypassed by calling the underlying server
  action directly — check the guard is in the action, not only in the UI.

## Phase 4 — Server action and webhook correctness

- Run the `action-reviewer` agent over every file in `app/actions/` changed in this range.
  Each mutating action needs all five steps: Zod `safeParse` (never `parse`), auth/role guard,
  mutation with the right client, `audit_log` insert via the admin client, notification.
  Flag any action missing audit or notification on a sensitive mutation.
- Confirm no `lib/supabase/admin.ts` import reached a Client Component, and no service-role
  key is referenced in anything shipped to the browser.
- Check for the RSC crash pattern this repo has hit before: a Supabase client instance passed
  as a prop between Server Components. It must be `await Comp({...})`, never
  `<Comp supabase={x} />`.
- `app/api/webhooks/clerk/route.ts` grew substantially in 08/09/10. Verify: signature
  verification still runs before any side effect; every branch returns 200 for
  structurally-unfixable events so Clerk stops retrying; handlers are idempotent under Clerk's
  at-least-once redelivery (replay the same event twice and confirm no duplicate rows, no role
  downgrade, no clobbering); role reconciliation in `lib/sponsor-roles.ts` never demotes a
  ranked member; and every role literal written matches the live `sponsor_members` CHECK
  constraint from `0083` (a mismatch here was already a live retry-loop bug once).
- `app/api/webhooks/resend/route.ts` drives `delivered`/`opened`/`bounced` submission
  statuses. Confirm 01–10 didn't change the shape of what it writes into the now-larger
  fulfillment state machine, and that an out-of-order or duplicate delivery event can't move
  a submission backwards.

## Phase 5 — Feature-level correctness, per slice

For each of 01–10, open the prompt's acceptance criteria and check each one against the code.
Specifically hunt for:

- **01/03 fulfillment machine** — unreachable states, transitions with no guard, a status
  rendered in the UI that the machine can never produce, the reverse (a machine state with no
  UI), and terminal states that can still be mutated.
- **02 payout / W-9** — encryption actually applied (not a no-op when the key is missing:
  does it fail closed?), retention/deletion logic correct, no tax ID in logs, Sentry breadcrumbs,
  audit metadata, or error messages.
- **04 receipts** — receipt number uniqueness enforced at the DB level (unique index, not
  application-side), public receipt URLs unguessable and not enumerable, and the public route
  present in the `middleware.ts` public matcher.
- **05/06 agreements & e-sign** — the SHA-256 hash covers exactly the document the signer saw
  (merge fields resolved, not the template); signature rows are immutable (no UPDATE policy,
  ideally a trigger); the DB-level agreement gate can't be bypassed by an action that writes
  the funding row directly; IP/UA/UTC timestamp all captured; the typed-name match is
  validated server-side.
- **07 FIRST verification** — the FTCScout fallback path is exercised and correct while the
  FIRST creds are absent (this is the current production state); cache staleness handled;
  a lookup failure fails closed on verification rather than silently verifying.
- **08/09/10 orgs, roles, SSO** — `sponsors.clerk_org_id` uniqueness; orphaned
  `sponsor_members` rows; a profile that belongs to two orgs; JIT-provisioned SSO profiles
  correctly carrying `false` legal acks and `viewer` role; and what happens on the first
  login of a user whose email already belongs to a different profile.

## Phase 6 — Consistency and dead ends

- **Preview fixtures drift.** `lib/dev-bypass.ts`, `lib/dev-preview.ts`,
  `lib/dev-coach-preview.ts` all carry static mock data. Confirm they still match the real
  shapes after eight migrations, and that all three are still hard-forced off in production.
- **Type drift.** `lib/supabase/types.ts` must match the live schema after `0083`. Regenerate
  and diff.
- **Orphaned UI.** Routes, sidebar links, or loading states added by these prompts that lead
  to a page nothing links to, or a link to a route that doesn't exist.
- **Dead code / TODOs.** Grep the changed files for `TODO`, `FIXME`, `XXX`, `@ts-expect-error`,
  `eslint-disable`, `any` casts hiding a real type mismatch, and `catch {}` blocks that
  swallow errors. Run the `silent-failure-hunter` agent over the changed set.
- **Test honesty.** 218 unit tests pass. Check they test behavior rather than restating the
  implementation, and specifically that the invariant tests
  (`fulfillment-invariants`, `remediation-invariants`, `sponsor-roles`, `sso-jit-provisioning`)
  would actually fail if the invariant were violated — try mutating the source and confirm the
  test goes red. A test that can't fail is worse than no test.
- **E2E coverage.** `tests/e2e/*` gained specs in this range. Determine whether they actually
  run in any pipeline or are dead weight.
- Docs consistency: `prompts/README.md` Progress table, `prompts/_CONTEXT.md` §2 schema map,
  `.claude/rules/architecture.md` (latest-migration line), and prompts `11`–`18` — later
  prompts describing code that 01–10 changed underneath them are landmines for the next
  session. Report each stale statement.

## Phase 7 — Report, then fix

**Deliverable 1: the findings report.** Write it to `prompts/_AUDIT-01-10.md`. One row per
finding:

| ID | Severity | Prompt | File:line | What's wrong | How it fails in production | Evidence | Fix |

Severity: **P0** shipped-and-broken (data exposure, Core Mandate violation, missing migration,
money/capacity corruption) · **P1** broken under a realistic path · **P2** correctness risk or
missing guard · **P3** drift, stale docs, cosmetic.

Include an explicit **"verified correct"** section too — the things you checked that are
genuinely fine. A report that only lists problems doesn't tell me what's safe.

**Deliverable 2: the fixes.** After the report is written, fix every P0 and P1, each as its
own commit with a regression test that fails before the fix and passes after. Do not fix P2/P3
without asking. If a P0 needs a migration, it is `0084` — confirm with
`ls supabase/migrations | tail -3` first, make it idempotent, and apply it with `psql -f`
(the Supabase CLI splitter mishandles multi-`$$` files).

**Deliverable 3: green.** `npm run typecheck && npm run lint && npm run build && npx vitest run`
all pass at the end. Report the actual output.

If a finding is uncertain, say so and say what evidence would settle it. Do not round
uncertainty up to confidence, and do not round problems down to "minor" to make the report
look better.
