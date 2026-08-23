# Paste-and-go prompt for executing one fix pack

Replace <ID> with one of: A-01 A-02 A-03 A-04 A-05 A-06 A-07 A-08 A-09 A-10 A-11 A-12 B-01 B-02 B-03 B-04

---

Read `prompts/audits/handoff/<ID>-claude-prompt.md` in full. It is a self-contained fix pack
produced by an audit of this repository: it lists findings with file:line locations, reproduction
steps, and a severity + confidence label on each.

Then execute it, following its instructions exactly. Specifically:

1. Work through the findings in severity order — P0 first, then P1, then P2, then the P3 batch.
2. **Reproduce each finding before you fix it.** These came from an automated audit and were not
   independently confirmed. Anything labelled INFERRED was reasoned from the code, not observed.
   If a finding does not reproduce, say so explicitly and move on — do not fix a phantom.
3. Obey every rule in that file's "Non-negotiable rules for this work" section. The ones that
   matter most: `.env.local` points at PRODUCTION Supabase and Clerk and there is no staging, so
   every DB write from this repo is a production write; never run
   `node scripts/seed-test-accounts.mjs` (it truncates production tables); never run
   `supabase db reset` or `supabase db push`; and never rebuild a Postgres function body from an
   older migration file — dump the live body with `pg_get_functiondef` and edit that.
4. Satisfy every box in its "Definition of done" before you report, including
   `npm run typecheck`, `npm run lint`, `npm run test`, and `npm run build`.
5. If you need to reproduce UI behaviour, use a LOCAL Docker Supabase stack — `npx supabase start`,
   then export the local `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` /
   `SUPABASE_SERVICE_ROLE_KEY` (from `npx supabase status -o json`) plus `SUPABASE_LOCAL=1` INTO
   THE SHELL BEFORE starting `npm run dev`. dotenv does not override shell variables, and that
   ordering is the only thing keeping the run off the production database.

Do not commit or push unless I ask. When you are done, report: which findings you fixed, which did
not reproduce, and anything you deliberately left alone with the reason.
