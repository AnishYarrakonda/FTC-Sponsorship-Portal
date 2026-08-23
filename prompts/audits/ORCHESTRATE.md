# Orchestrator prompt — paste this into one Antigravity chat

Hand the block below to a single Gemini agent. It spawns the twelve static audits in
parallel, then runs the four live-stack audits one at a time, and finishes by printing the
sixteen handoff prompts.

---

You are the orchestrator for a 16-part audit of this repository (the FTC Sponsorship Portal, a
Next.js 16 + Clerk + Supabase platform connecting FTC robotics coaches with corporate
sponsors). You will not audit anything yourself. You spawn subagents, hold them to a contract,
and assemble their output.

**Step 1 — read the contract yourself, first.** Read `prompts/audits/_CONTEXT-AUDIT.md` in
full. It defines the safety rules, the severity scale, the evidence standard, and the exact
output format. Then read `prompts/audits/_RUNNER-AUDIT.md`. Do not skip this; you are
responsible for enforcing it on every subagent.

**Step 2 — spawn all twelve Lane A subagents in parallel.** They are static (read-only
analysis plus side-effect-free commands), fully independent, and safe to run simultaneously.
Give each subagent exactly this instruction, substituting its own file:

> Read `prompts/audits/_CONTEXT-AUDIT.md` in full, then execute
> `prompts/audits/prompts/<FILE>`. Obey its output contract exactly: write
> `prompts/audits/findings/<ID>-findings.md` and `prompts/audits/handoff/<ID>-claude-prompt.md`,
> and return the complete text of the handoff prompt as your final answer. Write no other
> files. Modify no code, migration, or config. Run no git command that changes state.

| ID | File |
|---|---|
| A-01 | `A-01-auth-identity.md` |
| A-02 | `A-02-rls-tenant-isolation.md` |
| A-03 | `A-03-server-actions.md` |
| A-04 | `A-04-capacity-funding-ledger.md` |
| A-05 | `A-05-email-notifications.md` |
| A-06 | `A-06-storage-documents.md` |
| A-07 | `A-07-ui-ux-ia.md` |
| A-08 | `A-08-accessibility-static.md` |
| A-09 | `A-09-performance-scale-tiers.md` |
| A-10 | `A-10-security-posture.md` |
| A-11 | `A-11-observability-recovery.md` |
| A-12 | `A-12-enterprise-gaps.md` |

**Step 3 — run the four Lane B audits strictly one at a time**, in order `B-01`, `B-02`,
`B-03`, `B-04`, each in its own subagent, each started only after the previous one has reported
that its teardown is complete. They need a live stack, and this machine has exactly one Docker
Supabase, one dev server on `:3000`, and one Clerk test tenant that throttles under repeated
use. Running two at once corrupts both. Each subagent gets:

> Read `prompts/audits/_CONTEXT-AUDIT.md` and `prompts/audits/prompts/_LANE-B-SETUP.md` in
> full, then execute `prompts/audits/prompts/<FILE>`. Follow the startup recipe and both
> pre-run verification checks exactly — they are the only thing keeping this off the
> production database. Complete the mandatory teardown before you report. Write only the two
> output files, and return the complete text of the handoff prompt as your final answer.

Files: `B-01-auth-flows-live.md`, `B-02-sponsor-orgs-live.md`, `B-03-full-journeys-live.md`,
`B-04-a11y-responsive-live.md`. Do not start Lane B until every Lane A subagent has finished —
a Lane A agent running `npm run build` alongside a live-stack audit will muddy its results.

**Non-negotiable, enforce on every subagent.** `.env.local` points at PRODUCTION Supabase and
PRODUCTION Clerk; there is no staging, so every database write from this repo with default
environment is a production write. No subagent may: run `node scripts/seed-test-accounts.mjs`
(it truncates production tables with no guard); run `supabase db reset` or `db push`; write to
the production database; modify any repo file outside `prompts/audits/findings/` and
`prompts/audits/handoff/`; run `git add`, `commit`, `push`, `checkout`, or `stash`; deploy;
write any token, key, or connection string into a file or a finding; or read the OS keychain.
If a subagent reports that a step required breaking one of these, that step is recorded as
blocked — which is an acceptable outcome — and the audit continues.

**Step 4 — quality gate before you accept any subagent's work.** Reject and send back any
handoff prompt that: refers to this conversation, to Gemini, to an audit id, or to a findings
file the reader cannot see; lacks `file:line` locations; lacks reproduction steps; fails to
label each finding `CONFIRMED` or `INFERRED`; or omits the `Fix by subscription` /
`Fix by code` sections in its findings report. Each handoff prompt must work when pasted,
alone, into a brand-new terminal by someone with no memory of this audit. That is the whole
point of the exercise.

**Step 5 — report.** Print, in this order:

1. A single table: audit id, subsystem, P0/P1/P2/P3 counts, and anything blocked.
2. A consolidated **`Fix by subscription`** list merged across all sixteen audits — every
   limit that binds, the evidence, the plan that fixes it, and the price — ending with one
   ranked recommendation for what to pay for first and what is not worth paying for yet.
3. The **ten highest-severity findings across the whole pack**, ranked, one line each, so the
   worst thing found is impossible to miss.
4. Then the sixteen handoff prompts, **each as its own fenced code block, in the order
   `A-01`…`A-12`, `B-01`…`B-04`, with a single line naming the audit before each block and
   nothing else between them.** No commentary inside or after the blocks. Each block is copied
   whole and pasted into a fresh terminal, so anything that forces the reader to edit or stitch
   the block is a failure of this run.
