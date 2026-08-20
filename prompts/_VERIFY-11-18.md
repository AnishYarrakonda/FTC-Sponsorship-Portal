# Verification sweep — prompts 11–18

You are auditing eight already-shipped implementation slices for silent bugs, drift, and
half-landed work. **You are not building features.** Your job is to prove each slice is
actually correct and actually live, find what quietly broke, and fix only what you can prove
is broken.

This is the sequel to `_VERIFY-01-10.md`. That sweep produced `_AUDIT-01-10.md`, 15 findings,
no P0s — and two of its P2/P3 findings (`F-01` capacity on cancel, `F-07`/`F-08`/`F-10` doc
drift) then sat open for eight days because nobody re-read the report. **Read
`_AUDIT-01-10.md` first and confirm which of its findings are still open**; a finding that
survives two audits is worse than one nobody found.

## Ground truth to read first (in this order)

1. `CLAUDE.md` and `.claude/rules/*.md` — Core Mandates and the auth/Supabase patterns.
2. `prompts/_CONTEXT.md` — the schema and architecture ground truth. §2's "applied since"
   list is current to `0095` as of this sweep; if it is not current when you read it, that is
   itself a finding.
3. `prompts/README.md` — the Progress table and locked decisions.
4. `prompts/_AUDIT-01-10.md` — the prior sweep's findings and which remain open.
5. `prompts/11-*.md` through `prompts/18-*.md` — each prompt's acceptance criteria. Treat
   them as the contract each commit was supposed to satisfy.
6. `docs/verification-backlog.md` (gitignored, local only) — the 287 acceptance checks and
   which routes have actually been run. **Its "full 287" table is frozen at 2026-08-12; the
   session logs above it are the live record.**

## Scope

Everything between `232fc49~1` and `HEAD`, i.e. migrations `0084`–`0095` and these commits:

```
232fc49 feat: implement admin roles and capacity audit               (11)
  ...   feat: moderated sponsor<->coach Q&A                          (12)
  ...   feat: coach appeals path                                     (13)
  ...   feat: sponsor recognition tiers                              (14)
  ...   feat: CSR/ESG impact report export                           (15)
d950a3c feat(sponsor): Vercel BotID and corporate-email gating       (16)
6036d34 feat(email): handle Resend complaint events                  (17)
07e27ee feat(a11y): WCAG 2.2 AA pass + axe regression guard          (18)
```

plus everything that landed after them to fix them: `0089`, `0091`–`0095`, the a11y
follow-ups (`8662a54`, `cba59a0`), the security fixes (`0c49153`, `4ae4925`), the E2E
unlocks (`bcc4446`, `ad7d2a4`, `5bcdb3e`, `806e460`), and the migration replay work
(`6ede458`). Resolve the real SHAs with `git log --oneline 232fc49~1..HEAD`.

Read the real diffs (`git show <sha>`), don't infer from commit messages.

## Rules of engagement

- **Evidence or it didn't happen.** Every claim cites `file:line`, a command you ran with its
  output, or a query you executed. No "should work", no "appears correct".
- **Investigate everything before fixing anything.** Full findings list first.
- **Do not rebuild working code.** This pack has a documented history of agents rebuilding
  features that already existed — capacity release, FTC lookup, and sponsor-apply throttling
  all already exist. See the README table.
- **The code wins over the prompt.** Where a prompt's "Current state" contradicts the code,
  the code is truth and the prompt is stale — note it, don't code around it.
- **Stay in scope.** Bugs outside 11–18 get reported, not fixed.
- Never violate a Core Mandate in the name of a fix.
- **`.env.local` points at PRODUCTION.** There is no staging. Every write from this repo is a
  production write. Read freely; wrap any write-shaped probe in `BEGIN; … ROLLBACK;`.
- **Never run `scripts/seed-test-accounts.mjs` against production** — it wipes users.

## Phase 1 — Is it even live?

Code merged is not code deployed, and a migration in `supabase/migrations/` is not a
migration applied. Deploys here are manual (`vercel deploy --prod --yes`).

1. `ls supabase/migrations | tail -5` — confirm `0084`–`0095`, no collisions, no duplicates.
2. Connect to the live Postgres and confirm each is genuinely applied: tables, columns, enum
   values, constraints, indexes, triggers, functions. A migration file with no corresponding
   live object is a **P0**. Pay attention to the ones that only `CREATE OR REPLACE` a
   function — `0091`/`0092`/`0093`/`0094`/`0095` leave no new table behind, so the only proof
   they took is `pg_get_functiondef`. `0093` is the precedent: it was recorded as applied
   while every sponsor e-signature was still failing.
3. Confirm the deployed Vercel build contains these commits, and that every env var the code
   reads is present in Production. `BOTID`-related config and `PAYOUT_ENCRYPTION_KEY`
   especially. Missing = report with the exact runtime failure and whether it fails open.
4. Confirm every cron route is in `vercel.json` and authenticates its caller.
   `/api/cron/impact-rollup` returned **404 in production** when the backlog was written —
   a cron firing daily into a missing route. It now returns 401 to an unauthenticated call.
   Re-confirm, and confirm the same for `nudge-fulfillments` and `refresh-ftc-roster`.
5. Confirm the migrations replay. From-scratch replay is 0 failures and the 13 legacy
   migrations were made replay-safe in `6ede458` — re-verify rather than trust it.

## Phase 2 — Core Mandate integrity

Prove each with a query or a traced code path, not by reading a comment.

- **Capacity integrity.** The invariant is now three-termed (`0095`):
  `funding_used_cents = open reservations + settled ledger − released capacity`. Walk every
  path 11–18 added that can move any of the three terms: appeal **overturn** (13) putting a
  submission back to `changes_requested`, proposal expiry and the bounce/expire close (9's
  cron, exercised by 11's drift detector), recognition award creation on settle (14),
  fulfillment **cancellation** (0095, new — confirm the release is written exactly once), and
  the admin override (11). Look for a transition that reserves without a release,
  double-releases, or lets a reservation exceed remaining cap under concurrency.
  `detect_capacity_drift()` must return zero rows against production at the end.
- **COPPA.** The two surfaces that interpolate team data into documents are the impact-report
  projection (15) and recognition benefit proofs (14). Verify `findForbiddenKeys()` actually
  fires on a payload where every forbidden column is populated, that the projection uses no
  object spread (an allowlist a spread can bypass is not an allowlist), and that no proof
  without a `no_minors_confirmed_at` can exist. Then check the CSV export and the public
  platform stats for the same.
- **Admin-gatekept outreach.** No path added in 11–18 may email a sponsor a pitch outside
  `dispatchApprovedSubmission`. The Q&A release (12), appeal notifications (13), recognition
  ladder in the dispatched email (14), and the impact report (15) each need this call made
  explicitly. Grep every Resend call and classify it.
- **Portfolio vs submission separation.** Confirm 11–18 didn't duplicate global team facts
  onto `submissions`, particularly in the impact-report projection.

## Phase 3 — RLS and cross-tenant isolation

This is the largest block of never-run verification in the backlog: the `agent` route has
been open for prompts 08/09/11/12/13 since day one.

- Run the `rls-auditor` agent over every table created or touched by `0084`–`0095`:
  `appeals`, `submission_messages`, `recognition_tiers`, `sponsor_recognition_awards`,
  `recognition_benefit_deliveries`, `impact_report_snapshots`, `public_platform_stats`,
  `email_domain_rules`, `funding_capacity_releases`, plus `profiles` (for `admin_level`).
  Paste its output verbatim.
- Confirm **no** policy anywhere uses `auth.uid()` — it is NULL under Clerk.
- Confirm sponsor resolution everywhere goes through `current_sponsor_ids()` /
  `sponsor_ids_for_profile()`, never `profiles.sponsor_id`. That column is NULL forever for a
  teammate invited through a Clerk Organization, and missing it is what made `0094`
  necessary. Grep `pg_proc` as well as the migration files — a function body is where the
  last one hid.
- Prove the negatives by executing them: sponsor B cannot read sponsor A's awards,
  deliveries, impact snapshots, proposals or capacity releases; coach B cannot read coach A's
  appeal or Q&A thread; a `reviewer` admin cannot edit a funding cap or hit
  `/api/admin/export`; anon gets `[]` everywhere and one row from `public_platform_stats`.
- Every `SECURITY DEFINER` function added in this range needs an explicit
  `REVOKE … FROM PUBLIC`/`anon`/`authenticated` and a pinned `search_path`. Note that
  `CREATE OR REPLACE` does **not** preserve a REVOKE — check the live grants, not the file.
- Storage: recognition proof uploads must partition by the Clerk user id in the first path
  segment, with matching storage RLS.

## Phase 4 — Server action and webhook correctness

- Run the `action-reviewer` agent over every `app/actions/*` file changed in this range.
  Each mutating action needs all five steps: Zod `safeParse` (never `parse`), auth/role
  guard, mutation with the right client, `audit_log` via the admin client, notification.
- Confirm the two-step approver workflow and the reviewer/super-admin split are enforced in
  the **action**, not only the UI — call the action directly.
- `app/api/webhooks/resend/route.ts`: the `email.complained` branch (17) must not touch
  submission state or release capacity. An out-of-order or duplicate delivery event must not
  move a submission backwards.
- Check for the RSC crash pattern this repo has hit: a Supabase client passed as a prop
  between Server Components. It must be `await Comp({...})`, never `<Comp supabase={x} />`.
- Confirm no `lib/supabase/admin.ts` import reached a Client Component.

## Phase 5 — Feature-level correctness, per slice

Open each prompt's acceptance criteria and check it against the code. Specifically hunt for:

- **11 admin roles** — the zero-super-admins floor holds and the deferred trigger still
  allows a same-transaction hand-off; a reviewer is refused at the action layer *and* the
  database; `/api/admin/export` returns JSON 403, never a redirect.
- **12 Q&A** — a coach reply is invisible to the sponsor **in PostgREST**, not just the UI; a
  coach cannot open a thread; posting stops at terminal/expired but reading does not; the
  50-message cap; asking through `/sponsor-view/<token>` leaves `used_at` NULL.
- **13 appeals** — the different-reviewer rule; the 30-day window and what happens to an
  appeal already open when it closes; an overturn leaves `funding_used_cents` byte-identical;
  a sponsor-declined pitch cannot be appealed.
- **14 recognition** — editing a tier changes nothing about an existing award (the ladder is
  snapshotted, not joined); overlapping ranges refused; a sponsor cannot mark a benefit
  delivered; dispatch still succeeds with every tier archived.
- **15 impact report** — a closed year's payload is byte-identical after the underlying data
  changes; regeneration refused; the forbidden-key check is real.
- **16 BotID / domain gating** — a coach signing up at `/signup` with a `gmail.com` address
  is **not** blocked (the gate is sponsor-only); an admin allow-rule takes effect with no
  redeploy; no audit metadata stores a full email address.
- **17 deliverability** — the complaint path is inert until the Resend subscription exists;
  say so plainly rather than marking it verified.
- **18 accessibility** — the axe suite still passes with zero violations and no rule
  suppressed; hover states are covered, since **axe does not evaluate hover** and that is how
  nine failing surfaces survived the first audit.

## Phase 6 — Consistency and dead ends

- **Preview fixtures.** `lib/dev-bypass.ts`, `lib/dev-preview.ts`, `lib/dev-coach-preview.ts`
  must still match the real shapes after `0095`, and all three must be hard-forced off in
  production. Run `node scripts/verify-previews.mjs` — a 200 proves nothing here, because
  Next serves error boundaries with a 200.
- **Type drift.** `lib/supabase/types.ts` vs the live schema. Note the committed file has a
  hand-spliced region at non-standard indentation; a full regeneration produces ~2500 lines
  of unrelated formatting churn from a newer CLI, so diff semantically, not textually.
- **Orphaned UI.** Routes or links added by these prompts that lead nowhere, or links to
  routes that don't exist.
- **Dead code / TODOs.** Grep the changed files for `TODO`, `FIXME`, `@ts-expect-error`,
  `as never`, `as any` hiding a real mismatch, and `catch {}`. Note that an `as never` cast
  on a test fixture is what let two accessibility tests typecheck while referencing a column
  and an enum value that have never existed. Run `silent-failure-hunter` over the changed set.
- **Test honesty.** 409 unit tests pass. Check the invariant tests would actually fail if the
  invariant were violated — mutate the source and confirm the test goes red. A test that
  cannot fail is worse than no test. `_AUDIT-01-10.md` F-05/F-06 flagged two regex-based
  invariant tests as unfalsifiable; confirm whether those files still exist and still are.
- **E2E honesty.** Determine how many specs actually run versus how many are skipped for
  missing env, and whether any spec asserts only absence (which would pass on `/login`).

## Phase 7 — Report, then fix

**Deliverable 1: the findings report.** Write it to `prompts/_AUDIT-11-18.md`. One row per
finding:

| ID | Severity | Prompt | File:line | What's wrong | How it fails in production | Evidence | Fix |

Severity: **P0** shipped-and-broken (data exposure, Core Mandate violation, missing
migration, money/capacity corruption) · **P1** broken under a realistic path · **P2**
correctness risk or missing guard · **P3** drift, stale docs, cosmetic.

Include an explicit **"verified correct"** section. A report that only lists problems doesn't
say what's safe.

Carry forward an explicit **status of every `_AUDIT-01-10.md` finding** — closed, still open,
or no longer reproduces. That report's findings went stale unread once already.

**Deliverable 2: the fixes.** After the report is written, fix every P0 and P1, each as its
own commit with a regression test that fails before the fix and passes after. Do not fix
P2/P3 without asking. If a fix needs a migration it is `0096` — confirm with
`ls supabase/migrations | tail -3`, make it idempotent, apply it with `psql -f`, and replay
it a second time to prove it.

**Deliverable 3: green.** `npm run typecheck && npm run lint && npm run build && npm run test`
all pass, plus `node scripts/verify-backlog.mjs` against production. Report actual output.
The known-failing check is `17.3` (DMARC, registrar-side, not yours to fix).

If a finding is uncertain, say so and say what evidence would settle it. Do not round
uncertainty up to confidence, and do not round problems down to "minor" to make the report
look better.
