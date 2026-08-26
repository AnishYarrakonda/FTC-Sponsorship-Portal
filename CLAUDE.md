# FTC Sponsorship Portal

A platform connecting verified adult FTC robotics coaches with corporate sponsors.
Coaches build a team Portfolio and submit tailored pitches; admins moderate and
gate sponsor-facing outreach; sponsors accept in full or for a smaller amount under strict
capacity caps. The platform never touches the money and tracks nothing after acceptance —
both parties get each other's contact details and settle up directly. Next.js 16 (App Router) + Clerk (auth) + Supabase (Postgres + Storage) + Resend.

## Core Mandates (never violate)
- **COPPA Compliance**: No student PII collected or exposed. Verified adult coaches only.
- **Admin-Gatekept Outreach**: Sponsor-facing **pitch dispatch** requires Admin approval via the review queue (`lib/dispatch.ts`). This gate is ONLY for outreach to sponsors. **Transactional notifications** (status changes, decisions, new-submission alerts) auto-send to BOTH the in-app inbox AND the recipient's email via `createInAppNotification` in `lib/notify.ts`. (Auth-flow emails — email verification, password reset — are owned by Clerk, separate from this path.)
- **Capacity Integrity**: Sponsor funding caps are strictly enforced. Never let a submission reserve beyond a sponsor's remaining cap.
- **Data Architecture Distinction**: Keep Global Team Data (the Portfolio — reused across pitches) strictly separate from Submission-Specific Data (custom pitch alignment, specific needs, local connection — unique per pitch).

## Detailed rules (auto-loaded)
@.claude/rules/architecture.md
@.claude/rules/auth-supabase.md
@.claude/rules/conventions.md
@.claude/rules/workflows.md

## Working here
- General-purpose commands: `/feature`, `/fix`, `/supa`, `/ship`.
- Project agents: `rls-auditor`, `action-reviewer`, `auth-flow-debugger`.
- Auth is **Clerk** (`@clerk/nextjs`); Supabase trusts Clerk via native third-party auth, and RLS keys off the Clerk user id in `auth.jwt()->>'sub'` (not `auth.uid()`). See `.claude/rules/auth-supabase.md`.
- Validate before pushing: `npm run typecheck && npm run lint`. Build uses Turbopack (`next build`); keep the `jsdom`/`cssstyle` `overrides` in `package.json`.
- Deploys are **manual** — there is no Git integration on the Vercel project. Pushing to `main` does not deploy. Ship with `vercel deploy --prod --yes`.

## `prompts/` — roadmap and audits

`prompts/_NEXT-SESSION.md` is the live handoff; read it first.

**The app is code-complete.** Everything remaining before launch is accounts, DNS and
dashboards, enumerated in **`docs/LAUNCH-CHECKLIST.md`**, which is now the SINGLE authoritative
launch doc (`GO-LIVE-CUTOVER.md` and `PURCHASE-CHECKLIST.md` were folded into it and deleted
2026-08-26). The app gets its **own domain** — `exodiusftc.com` is the team WEBSITE and is not
involved. Launch costs ~$28: a domain plus **Vercel Pro, which their terms require** because
soliciting donations is commercial use.

`prompts/revamp/` holds the 18 sequential enterprise-readiness prompts (funding fulfillment,
W-9s, e-sign, sponsor orgs, SSO, CSR reporting, accessibility). **All 18 are shipped and
audited** — that pack is history, not a queue. `prompts/revamp/_CONTEXT.md` is still the most
complete written snapshot of the schema and architecture (accurate as of migration `0075`;
later migrations have moved past it, so the code wins on conflict).

`prompts/audits/` holds the Gemini audit pack — 16 deep audit prompts written to be executed
by an external Gemini agent, which writes evidence to `prompts/audits/findings/` and emits a
self-contained fix prompt to `prompts/audits/handoff/` for Claude Code to execute. Start with
`prompts/audits/_RUNNER-AUDIT.md`; `prompts/audits/_CONTEXT-AUDIT.md` is their shared contract.

Decisions already locked there — do not relitigate: the platform **never touches funds**,
sponsor multi-user is built on **Clerk Organizations**, and FTC verification uses the
**official FIRST API** with FTCScout as fallback.

**REVERSED (migration `0111`).** These were locked decisions and are no longer true:
- ~~e-sign is in-house (ESIGN/UETA)~~ — **there is no e-signature layer.** Agreement
  templates, signatures, the signing pages and the executed-agreements bucket are gone.
- ~~pledge-and-track~~ — the platform tracks nothing after acceptance. The payment state
  machine, W-9/payout profiles, tax receipts and recognition tiers were all removed.

The product is now a **matchmaker**: coach pitches → admin moderates → sponsor accepts (in
full or for less) → both parties get each other's contact details → everything after that
happens off-platform. `prompts/revamp/05-*` and `06-*` describe the removed layers and are
history, not a spec.

The one post-acceptance capacity operation that remains is **voiding a match**
(`void_match_atomic`, `app/actions/void-match.ts`, exposed at `/admin/capacity`). It is the
only way to release capacity a sponsor committed, and it writes a compensating NEGATIVE
`transactions_ledger` row rather than deleting anything.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
