# `_RUNNER.md` — How to actually run these prompts

This file exists so you never have to think about *how* to launch a session. Copy one
block, fill in two blanks, paste. Works with Claude Code, Codex, Gemini, Cursor — any
agent with filesystem + shell access.

---

## The paste-able launcher

Copy this whole block. Replace `{PROMPT_PATH}` and `{ADDITIONAL_DIRECTIONS}`.
Leave everything else exactly as written — the contract below is what stops these
sessions from introducing bugs.

````text
Execute prompts/{PROMPT_PATH}.

════════════════════ EXECUTION CONTRACT — follow exactly ════════════════════

You are implementing ONE vertical slice in a production Next.js + Clerk + Supabase
codebase that handles money commitments and adult-identity verification. Bugs here are
expensive. Precision beats speed. If you are unsure about anything, STOP AND ASK rather
than guessing.

── PHASE 1 · ORIENT (no edits yet) ──────────────────────────────────────────
1. Read, in this order, in full:
      a. CLAUDE.md
      b. .claude/rules/architecture.md
      c. .claude/rules/auth-supabase.md
      d. .claude/rules/conventions.md
      e. .claude/rules/workflows.md
      f. prompts/_CONTEXT.md          ← shared ground truth, non-negotiable
      g. prompts/{PROMPT_PATH}        ← the actual task
2. Open every file the prompt names under "Files you will touch" and read it. Do not
   work from the prompt's description of a file — read the real file.
3. Run `git status`. The tree must be clean. If it is not, stop and report.
4. Confirm the prompt's prerequisite prompts are already done (each prompt lists them).
   If a prerequisite is missing, stop and say so — do not work around it.
5. Verify the reserved migration number is still free:
      ls supabase/migrations | tail -3
   If the reserved number is taken, use the next free one and note the change.
6. State back, in under 10 lines: what you are building, which files you will create vs
   modify, and any discrepancy you found between the prompt and the real code.
   If a discrepancy would change the design, STOP AND ASK. The code wins over the prompt.

── PHASE 2 · IMPLEMENT ──────────────────────────────────────────────────────
7. Work strictly inside the prompt's scope. No drive-by refactors, renames, dependency
   bumps, or reformatting of untouched files. If you spot an unrelated bug, write it down
   and report it at the end — do not fix it.
8. Match the surrounding code's conventions exactly: the canonical 5-step server-action
   shape, Zod `safeParse` (never `parse`), limits from lib/schemas/limits.ts, auth guards
   from lib/actions-utils.ts, notifications via lib/notify.ts, sponsor outreach only via
   lib/dispatch.ts.
9. Migration rules are load-bearing — re-read prompts/_CONTEXT.md §8 before writing SQL.
   In particular: idempotent DDL; RLS enabled + per-role policies on every new table;
   `current_profile_id()`/`is_admin()`, NEVER `auth.uid()`; explicit
   REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated + GRANT TO service_role on every
   SECURITY DEFINER function; `SET search_path = public, extensions` if you touch pgcrypto;
   `is_trusted_server_context()` never a raw `sub IS NULL` test; and if you add a column to
   `submissions` that coaches must write, add it to the
   `guard_submission_writable_columns()` allowlist in the SAME migration.
10. Never violate a Core Mandate (COPPA / admin-gatekept outreach / capacity integrity /
    portfolio-vs-submission separation) to satisfy this prompt. If the prompt seems to
    require it, stop and report.
11. Write the tests the prompt asks for. Tests that assert the security boundary
    (wrong role blocked, wrong org blocked, RLS denies) are mandatory, not optional.

── PHASE 3 · VERIFY LOCALLY (all must pass; do not proceed on a failure) ────
12. Apply the migration and confirm it is idempotent:
       psql "$DATABASE_URL" -f supabase/migrations/<file>.sql
       psql "$DATABASE_URL" -f supabase/migrations/<file>.sql   # second run must also succeed
    (Files containing $$-quoted blocks MUST use `psql -f`, not the Supabase CLI.)
13. Run the full gate and paste the real output:
       npm run typecheck
       npm run lint
       npm run build
       npm run test
14. Exercise the feature in a real browser. Use the relevant preview mode
    (`npm run dev:admin-preview` / `dev:sponsor-preview` / `dev:coach-preview`) or a
    seeded account (`node scripts/seed-test-accounts.mjs`, Clerk test OTP `424242`).
    Confirm the happy path AND at least one failure path actually behave correctly.
    Do not claim a UI works because the code looks right.
15. Walk the prompt's Acceptance Criteria list item by item and mark each ✅ or ❌ with the
    evidence that proves it. An unproven item is ❌.

── PHASE 4 · GO LIVE ────────────────────────────────────────────────────────
16. Do NOT deploy if any check in Phase 3 failed or any acceptance criterion is ❌.
    Report and stop instead.
17. If the prompt added or renamed an environment variable, set it in Vercel BEFORE
    deploying, or production throws on the first request:
       vercel env add <NAME> production
18. Apply the migration to the production database before deploying code that depends on it.
19. Deploy. This project has NO Git integration — pushing to main does not deploy:
       vercel deploy --prod --yes
20. Verify the live deployment, not just the build:
       curl -fsS https://ftc-sponsorship-portal.vercel.app/api/health
    Then load the affected page(s) in a browser against production and confirm the feature
    is really there. Check Vercel runtime logs and Sentry for new errors.
21. Commit with the message the prompt specifies. Branch off main first if you are on main.

── PHASE 5 · REPORT ─────────────────────────────────────────────────────────
22. Finish with exactly this structure:

    ## Done
    - <what shipped, one line each>

    ## Verification
    - typecheck: <pass/fail>   lint: <pass/fail>   build: <pass/fail>   test: <n passed>
    - migration applied + replayed idempotently: <yes/no>
    - browser-verified: <what you actually clicked, and what you saw>
    - production health check: <status>
    - acceptance criteria: <n>/<n> ✅

    ## Deviations
    - <anything you did differently from the prompt, and why. "None" if none.>

    ## Found but did not fix
    - <unrelated bugs or debt you noticed. "None" if none.>

    ## Next
    - <the next prompt to run>

NEVER report something as working that you did not observe working. If a step failed,
say so plainly and paste the output. A truthful failure is worth more than a confident
guess — the whole point of this pack is that nothing breaks silently.
════════════════════════════════════════════════════════════════════════════
````

---

## Short form (once you trust the flow)

After the first few sessions you'll know the contract holds. This shorter version keeps
the parts that actually prevent bugs:

````text
Execute prompts/{PROMPT_PATH}.

Additional directions: {ADDITIONAL_DIRECTIONS}

Rules: Read CLAUDE.md, .claude/rules/*.md, and prompts/_CONTEXT.md in full first, then
read every file the prompt names before editing. Stay strictly in scope — no drive-by
refactors. Follow the migration rules in _CONTEXT.md §8 exactly (idempotent, RLS on new
tables, REVOKE/GRANT on SECURITY DEFINER, never auth.uid()). Then: apply the migration
twice to prove idempotency, run typecheck + lint + build + test and paste real output,
verify the feature in a browser (not just by reading code), walk the Acceptance Criteria
and mark each ✅/❌ with evidence. Only if everything is green: set any new env vars in
Vercel, apply the migration to prod, `vercel deploy --prod --yes` (no Git integration —
pushing does not deploy), curl /api/health, and confirm the feature live. Report what you
verified vs. what you assumed. Never claim something works that you didn't watch work.
````

---

## Recommended order

Run these one at a time, in a **fresh session** each. Dependencies are strict where noted.

| # | Prompt | Depends on | Migration |
|---|---|---|---|
| 01 | `01-funding-fulfillment-state-machine.md` | — | `0076` |
| 02 | `02-team-payout-profile-w9.md` | — | `0077` |
| 03 | `03-fulfillment-ui-and-reconciliation.md` | 01, 02 | none |
| 04 | `04-receipts-and-acknowledgment-letters.md` | 01, 02 | `0078` |
| 05 | `05-sponsorship-agreement-templates.md` | — | `0079` |
| 06 | `06-esign-capture-flow.md` | 05, 01 | `0080` |
| 07 | `07-first-official-team-verification.md` | — | `0081` |
| 08 | `08-sponsor-organizations.md` | — | `0082` |
| 09 | `09-org-roles-and-approver-workflow.md` | 08 | `0083` |
| 10 | `10-enterprise-sso.md` | 08 | none |
| 11 | `11-admin-roles-and-capacity-audit.md` | — | `0084` |
| 12 | `12-sponsor-coach-qa-thread.md` | — | `0085` |
| 13 | `13-coach-appeals-path.md` | 11 | `0086` |
| 14 | `14-sponsor-recognition-tiers.md` | 01 | `0087` |
| 15 | `15-csr-impact-report-export.md` | 01, 14 | `0088` |
| 16 | `16-botid-and-corporate-email-gating.md` | — | `0089` |
| 17 | `17-email-deliverability.md` | — | none |
| 18 | `18-accessibility-wcag-aa.md` | — | none |

Prompts **01–06 are the blocking set** — the two things that separate "platform" from
"toy". Everything after 06 is important but not blocking.

You can safely stop after any prompt. None of them leave the repo in a half-migrated state.

---

## If a session goes wrong

- **Agent reports a failed check and stops** — that is the contract working. Read the
  output, fix or amend the prompt, re-run. Do not tell it to "just continue".
- **Agent deviated from the prompt** — check the *Deviations* section of its report before
  accepting. Deviations are allowed when the code contradicted the prompt; they are not
  allowed as shortcuts.
- **Migration number collision** — the agent is instructed to bump to the next free number
  and say so. Update the table above so later prompts stay accurate.
- **Something broke in production** — `vercel rollback` reverts the deployment, but it does
  **not** revert the database migration. Every prompt includes a rollback note for its
  migration; use that.
- **Context ran out mid-session** — do not resume blindly. Run `git status` and `git diff`,
  establish what actually landed, then start a fresh session pointed at the same prompt
  with a note describing the partial state.

---

## A note on "no more bugs"

Nothing guarantees zero bugs. What this pack does is remove the three things that
actually cause them in agent-run sessions:

1. **Missing context** — solved by `_CONTEXT.md`, which encodes the non-obvious traps
   (`auth.uid()` is NULL, SECURITY DEFINER defaults to PUBLIC, the `submissions` column
   allowlist fails closed, the anon key has no `sub`).
2. **Scope creep** — solved by one-slice prompts and an explicit no-drive-by-refactor rule.
3. **Unverified claims** — solved by Phase 3/5 of the contract, which demands pasted output
   and browser evidence rather than "should work".

Read the *Verification* section of every report. If it says "browser-verified: n/a", the
feature is not done.
