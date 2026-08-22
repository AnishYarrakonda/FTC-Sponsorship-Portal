# `_CONTEXT-AUDIT.md` — the contract every audit obeys

> You are an external **Gemini** agent auditing the FTC Sponsorship Portal.
> Read this file in full before executing any audit prompt in this folder.
> You **find and prove problems. You never fix them.** A different agent (Claude Code)
> applies every fix. Your job ends when you have written two files and printed one
> pasteable prompt.

---

## 0. The product in one paragraph

A platform connecting **verified adult FTC robotics coaches** with **corporate sponsors**.
Coaches build a team Portfolio and submit tailored pitches; admins moderate and gate all
sponsor-facing outreach; sponsors review approved pitches and fund teams under strict
capacity caps. The platform **never touches funds** — it is pledge-and-track only.

Stack: **Next.js 16.2 App Router · React 19 · Tailwind v4 · shadcn/ui · Clerk (auth) ·
Supabase (Postgres + Storage, no Supabase Auth) · Resend + React Email · Sentry · Vercel.**

**The deepest written description of the architecture is `prompts/revamp/_CONTEXT.md`.**
Read it. It is accurate as of migration `0075`; the schema is now at `0097`, so where it
disagrees with the code or the live database, **the code and the database win** — and that
disagreement is itself worth recording if it misleads a future implementer.

Also read, once: `CLAUDE.md`, `.claude/rules/architecture.md`, `.claude/rules/auth-supabase.md`,
`.claude/rules/conventions.md`, `.claude/rules/workflows.md`, and `prompts/_NEXT-SESSION.md`.

### The four Core Mandates — a violation is automatically P0

1. **COPPA** — no student PII is collected, stored, or exposed. Verified adult coaches only.
2. **Admin-gatekept outreach** — sponsor-facing *pitch dispatch* happens **only** through
   `dispatchApprovedSubmission` in `lib/dispatch.ts`, after admin approval. Transactional
   notifications are a separate, ungated path (`createInAppNotification` in `lib/notify.ts`).
3. **Capacity integrity** — nothing may reserve beyond a sponsor's remaining cap.
4. **Portfolio vs. submission separation** — global team facts live on `teams`; per-pitch
   fields live on `submissions`. Never duplicated.

### Where the app stands

All 18 enterprise-readiness prompts in `prompts/revamp/` are shipped and audited. Production
is deployed and current. The gate is green: typecheck, lint (0 errors), 419/419 Vitest, build,
and E2E 174 passed / 0 failed / 2 skipped on chromium. **Assume the obvious things work.**
Your value is in what a green suite does not prove: multi-tenant isolation under adversarial
input, concurrency, the enterprise capabilities a 500-person sponsor expects and cannot find,
what collapses at scale on the Supabase free tier, and every flow no test exercises.

---

## 1. Hard safety rules — violating one of these is worse than finding nothing

- **`.env.local` points at PRODUCTION Supabase and PRODUCTION Clerk. There is no staging.**
  Every database write made with the repo's default environment is a **production write**.
- **NEVER run `node scripts/seed-test-accounts.mjs`.** Its `wipeUsers()` truncates
  `submissions`, `teams`, `profiles`, `transactions_ledger` and more, and it has **no
  production guard**. It will destroy live data.
- **NEVER run `supabase db reset`, `supabase db push`, or any `psql` statement that writes**
  against the production `DATABASE_URL`. Read-only `SELECT` against **local** only.
- **NEVER modify repo files** outside `prompts/audits/findings/` and `prompts/audits/handoff/`.
  No code, no migrations, no config, no `git add`/`commit`/`push`/`checkout`/`stash`.
  Throwaway probe scripts go in a scratch directory outside the repo (e.g. `/tmp/gemini-audit/`).
- **NEVER write a token, JWT, API key, password, or connection string into any file**, into a
  finding, or into the handoff prompt. Refer to them by name only (`SUPABASE_SERVICE_ROLE_KEY`).
- **NEVER read the OS keychain.**
- **NEVER deploy.** `vercel deploy` is off-limits. Deploys here are manual and human-initiated.
- If an audit step seems to require breaking one of these rules, **stop and record it as a
  blocked step in your findings** instead. A blocked step is an acceptable outcome.

---

## 2. Lanes — which audits can run at once

Every audit prompt is tagged in its header.

**LANE A — static.** Reads the repo; may run read-only, side-effect-free commands:
`npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`, `git log`/`git show`,
`grep`, `rg`, `find`, `node` on a throwaway script that touches nothing, and `psql` **SELECT
only against a LOCAL database**. Lane A audits are fully independent — **run as many
simultaneously as you like.**

**LANE B — live stack.** Needs Docker Supabase + a dev server + Playwright + the Clerk test
tenant. There is exactly one of each on this machine, and the Clerk test tenant throttles.
**Run Lane B audits strictly one at a time**, and never at the same time as another Lane B
audit. Each Lane B prompt carries the full startup recipe and a mandatory teardown.

If you are running Lane A while a Lane B audit is live, do not start a second dev server and
do not touch the local database.

---

## 3. Severity — how you rank a finding

| | Meaning |
|---|---|
| **P0** | Data loss, security or tenant-isolation breach, COPPA violation, money/capacity corruption, or a flow that is completely broken for a real user. Ship-blocking. |
| **P1** | A real user hits this on a normal path and is blocked or misled; or an enterprise gap that would lose a corporate deal; or a scale limit that will be hit within the first year. |
| **P2** | Wrong or fragile under a plausible-but-uncommon path: a race, a bad edge case, a confusing state, a missing guard that is currently unreachable. |
| **P3** | Polish. Copy, spacing, inconsistent empty/loading states, minor a11y, a missing index nobody feels yet. |

Two rules on severity: **rank by consequence to a real sponsor or coach, not by how
interesting the bug is**, and when torn between two levels, pick the lower one and say why.
Inflated severity is the fastest way to make this whole pack worthless.

---

## 4. The evidence standard — "evidence or it didn't happen"

The agent that receives your findings **independently re-verifies every one of them** and
discards anything it cannot reproduce. Unproven findings cost more than they are worth.

Every finding must carry:

1. **Location** — `path/to/file.ts:123`, or the migration and function name, or the exact URL.
2. **What is wrong** — one sentence, stated as a defect, not a feeling.
3. **Why it is wrong** — the rule, mandate, invariant, or user expectation it violates.
4. **Reproduction** — a concrete path to observing it. One of:
   - a code trace: "`X` at `a.ts:10` passes `null` to `Y` at `b.ts:44`, which does not handle it";
   - a command and its actual output;
   - a SQL query against the local database and its actual result;
   - numbered UI steps with the observed vs. expected result.
5. **Confidence** — `CONFIRMED` (you observed it) or `INFERRED` (you reasoned it from the
   code but did not run it). **Never dress an inference up as an observation.** `INFERRED` is
   perfectly acceptable and is not a lesser finding — a mislabeled one is.
6. **Suggested direction** — one or two sentences on where the fix belongs. Not a patch, and
   never presented as the only option; the implementing agent decides.

Deliberately state, in a `## Verified sound` section, the things you checked **and found
correct**. That section is how the next reader knows what your audit actually covered, and it
is as valuable as the defects.

---

## 5. What you produce — the output contract

Three artifacts. All three are mandatory.

### 5.1 The findings report — `prompts/audits/findings/<AUDIT-ID>-findings.md`

The complete evidence trail: everything you checked, every finding at full length with all six
elements above, the `## Verified sound` section, and any blocked steps. Long is fine here.

Every report ends with these two required sections:

- **`## Fix by subscription`** — anything that a paid plan solves rather than code: Supabase
  Pro (8 GB DB, 100 GB storage, 7-day PITR, no project pausing, larger connection limits),
  Vercel Pro, Clerk Pro/Business (Organizations limits, enterprise SSO connections), Resend
  volume tiers, Sentry quota. For each: **the concrete limit that gets hit, the evidence you
  have that it will get hit, the plan that fixes it, and the current price.** If your audit
  found no such constraint, write "None found" — do not invent one.
- **`## Fix by code`** — the counterpart list, one line per finding id.

### 5.2 The handoff prompt — `prompts/audits/handoff/<AUDIT-ID>-claude-prompt.md`

**This file must work when pasted, alone, into a brand-new terminal in a fresh Claude Code
session that has no memory of you, this audit, or this conversation.** That is the single
hardest requirement in this document. It must therefore be **self-contained**: no "as
discussed", no "see the findings file", no reference to Gemini or to an audit id the reader
cannot resolve. Every fact the implementing agent needs is inside the file.

Use exactly this skeleton:

```markdown
# Fix pack: <subsystem> — <n> findings (<x> P0, <y> P1, <z> P2, <w> P3)

You are working in the FTC Sponsorship Portal (Next.js 16 App Router + Clerk + Supabase +
Resend), at `/Users/anish_1_2_3/Documents/technical_projects/exodius/ftc_sponsorship_portal`.
An audit of <subsystem> produced the findings below. Fix them.

## Read first
- `CLAUDE.md` and `.claude/rules/conventions.md` — every mutating server action must keep the
  canonical 5-step shape: validate (Zod `safeParse`) → auth guard → mutate → audit_log via the
  admin client → notify.
- `.claude/rules/auth-supabase.md` — RLS keys off `auth.jwt()->>'sub'`; `auth.uid()` is always
  NULL under Clerk; pick the right Supabase client (browser / server / admin).

## Non-negotiable rules for this work
- `.env.local` points at PRODUCTION Supabase and Clerk. There is no staging. Every DB write
  from this repo is a production write.
- Never run `node scripts/seed-test-accounts.mjs` — it truncates production tables.
- Never run `supabase db reset` or `supabase db push`. Apply migrations with
  `psql -f <file>` (psql at `/opt/homebrew/opt/libpq/bin`, `DATABASE_URL` in `.env.local`).
- Never rebuild a Postgres function body from an older migration file. Dump the **live** body
  with `pg_get_functiondef` and edit that — doing otherwise has silently deleted later fixes
  three times, including a P0 tenant takeover.
- Migrations are numbered, sequential and idempotent. Confirm the real latest with
  `ls supabase/migrations | tail -3` before adding one.
- Deploys are manual: `vercel deploy --prod --yes`. Pushing to `main` deploys nothing.

## Verify each finding before you fix it
These findings came from an automated audit and **have not been independently confirmed**.
For each one: reproduce it first. If it does not reproduce, say so explicitly and move on —
do not fix a phantom. Findings marked INFERRED were reasoned from the code, not observed.

---

## <ID>-01 — <one-line title>  [P0 | CONFIRMED]
**Where:** `path/file.ts:123`
**Problem:** <what is wrong>
**Why it matters:** <the rule/mandate/user consequence>
**Reproduce:** <exact commands, SQL, or numbered UI steps + observed vs expected>
**Direction:** <where the fix likely belongs — the implementing agent decides>

<...one block per P0/P1/P2 finding...>

---

## P3 batch — polish
Low severity, grouped. Fix as a single sweep if time allows.
- `path/file.tsx:88` — <one line>
- ...

---

## Definition of done
- [ ] Every P0/P1 finding above is fixed, or explicitly documented as not reproducing.
- [ ] <audit-specific checks — the concrete assertions that prove this subsystem is sound>
- [ ] `npm run typecheck` clean
- [ ] `npm run lint` — 0 errors
- [ ] `npm run test` — all pass
- [ ] `npm run build` succeeds
- [ ] Any new migration is idempotent and applied with `psql -f`
```

### 5.3 The chat output — one block, zero hassle

**In the Gemini chat, after writing both files, print the complete contents of the handoff
prompt as a single fenced code block, and nothing else after it.** No summary, no preamble
under it, no "let me know if you want changes", no split into parts. The human copies that one
block and pastes it into a terminal. Anything that forces them to stitch pieces together, open
a file, or delete your commentary is a failure of this audit regardless of how good the
findings are.

Before the block, one short paragraph is allowed: how many findings at each severity, and
whether anything was blocked.

---

## 6. How to audit well

- **Follow the data, not the file tree.** Pick a real actor (a sponsor's finance approver, a
  coach whose team was declined) and trace what they can see, touch, and break end to end.
- **Assume the happy path works and attack the seams**: concurrency, partial failure, retries,
  a user who is deleted mid-flow, a sponsor org whose champion left, a row that is missing.
- **Ask what a 500-person company needs** that nobody has built: seat management, an audit
  export for procurement, delegation, offboarding, an approval chain, data retention answers.
- **Read the migration history**, not just the current schema. `0093`, `0094`, and `0096`
  exist because a `CREATE OR REPLACE` silently deleted an earlier guard; look for that class.
- **Check that the tests actually assert what they claim.** A green suite that never runs the
  code path it names is a real finding, and this repo has had exactly that.
- **Be specific about scale.** "Might be slow" is not a finding. "This query has no index on
  `submissions.sponsor_id` and does a seq scan; at 50k rows on the free tier's shared CPU
  that is a timeout on the sponsor dashboard" is a finding.
