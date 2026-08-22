# A-11 — Observability, ops & failure recovery

**Lane A (static — parallel-safe).** Audit id `A-11`.
**Outputs:** `prompts/audits/findings/A-11-findings.md` · `prompts/audits/handoff/A-11-claude-prompt.md`

> Read `prompts/audits/_CONTEXT-AUDIT.md` in full first.
> The question behind this audit: **when this breaks at 2 a.m. for one sponsor, does anyone
> find out, and can it be repaired without a database surgeon?**

---

## You own

`instrumentation.ts` / `instrumentation-client.ts` and the Sentry setup, `app/error.tsx`,
`app/not-found.tsx` and every `error.tsx` boundary, `lib/errors.ts`, `lib/client-errors.ts`,
`app/api/health`, `app/api/cron/*`, `vercel.json`, `.github/workflows/ci.yml`,
`scripts/*.mjs` (`verify-backlog`, `verify-capacity-invariant`, and the rest), the `audit_log`
table, and every runbook in `docs/`.

## Investigate

1. **Error boundaries.** Every route segment: is there an `error.tsx`, does it recover or dead
   end, does it show the user something actionable, and is the error actually reported? Note a
   documented trap in this project: **an error boundary returns HTTP 200**, so a page that
   "works" in a status check may be rendering a crash. Find every place a monitoring check
   would be fooled by that.
2. **Sentry coverage.** Server actions, route handlers, the cron, client components, and the
   webhook handlers. Where are errors swallowed by a bare `catch` that returns `{ error }` and
   never reports? List each. Then check the opposite: PII, EIN, tokens, or full request bodies
   being sent to Sentry. Check source maps, release tagging, and environment separation, and
   whether the free event quota would be exhausted by one noisy loop.
3. **The health check.** Read `app/api/health`. What does it actually prove — that Next is up,
   or that the database, storage, Clerk, and Resend are reachable? A health check that returns
   200 while the database is unreachable is a finding. Is anything polling it?
4. **Alerting.** For each of these, name what alerts and who sees it: the cron did not run; a
   dispatch email failed permanently; a webhook has been failing for an hour; the capacity
   invariant is violated; the database is near a tier limit; the Supabase project paused. If
   nothing alerts, say "nothing alerts" plainly — that is the finding.
5. **Idempotency and retries.** The cron, both webhooks, and dispatch. Are handlers safe to run
   twice? Does a failed webhook get retried by the provider, and does the handler tolerate
   out-of-order delivery? Is there a dead-letter path or is a failure simply lost?
6. **Recovery runbooks.** For each realistic incident — a sponsor's capacity is wrong; a
   receipt was issued in error; a submission is stuck in a state with no transition out; a
   coach was verified by mistake; a signed agreement points at the wrong template; the cron
   missed a week — is there an admin UI path, a script, or only raw SQL? Anything answerable
   only by raw SQL against production is at least P1, because the standing rules forbid casual
   production writes.
7. **The audit trail as an operational tool.** Can `audit_log` actually answer "what happened
   to this submission, in order, with actors"? Check `distinct_audit_actions()`, the admin UI
   over it, retention, and whether every state-changing path writes one. Immutability matters:
   can a row be edited or deleted?
8. **Backups and restore.** What is the actual recovery position on the current Supabase plan
   (backup frequency, retention, PITR availability), and what would restoring cost in lost
   data? Storage objects are **not** covered by a database restore — check whether anything
   backs those up. This feeds the `Fix by subscription` section directly.
9. **CI.** `.github/workflows/ci.yml` runs the four-command gate with placeholder env and
   deliberately excludes E2E (it needs Docker). Confirm the gate is genuinely enforcing, that
   placeholder env cannot mask a real failure, and identify what a green CI does **not** prove.
10. **Verification scripts.** Read `scripts/verify-backlog.mjs` and
    `scripts/verify-capacity-invariant.mjs`. Do their assertions actually test what their names
    claim? A check that always passes is worse than no check.

## Done when

Every incident in item 6 has a named recovery path or an explicit "none exists", the alerting
list has an owner or a "nothing", and the backup position is stated in concrete terms.
