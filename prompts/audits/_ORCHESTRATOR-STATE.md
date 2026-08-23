# Audit pack — orchestrator state (COMPLETE 2026-08-22 · P0 tier executed 2026-08-23)

## Status: 16 of 16 audits complete, quality-gated and accepted. **P0 tier closed.**

### Complete and quality-gated
A-01…A-12, B-01, B-02 (pre-existing; re-gated this session — all pass)
B-03 (ran this session; ACCEPTED)

Gate applied to all 15: findings file has `## Verified sound` + `## Fix by subscription` +
`## Fix by code`; every finding carries all six section-4 evidence elements; handoff matches the
5.2 skeleton (`## Read first`, `## Non-negotiable rules for this work`,
`## Verify each finding before you fix it`, per-finding blocks, `## P3 batch`,
`## Definition of done`); zero self-containment leaks.

---

## P0 sweep executed — 2026-08-23

All 9 P0s worked in one pass, cherry-picked across the seven packs carrying them. Every finding
was reproduced before it was fixed. **7 fixed, 2 phantoms.**

| ID | Verdict | What was actually true |
|---|---|---|
| A-02-01 | **FIXED** (`0098`) | Real and remotely exploitable. Forged a notification over public REST with only the anon key: **HTTP 201**. The policy was a redundant service-role bypass. |
| B-02-01 | **FIXED** (`0099` + action + UI) | Real. A sponsor `viewer` could execute a binding agreement. Now gated in the action, the RPC, and the button. |
| B-03-01 | **FIXED** (code only) | Real and total. `confirmPaymentReceived` passed the coach's id to an RPC requiring `admin`, so it returned `unauthorized` **100% of the time** — no receipt was ever issued by the automatic path — and the dialog only branched on `res.error`, so the coach saw a green success toast. |
| A-04-01 | **FIXED** (`0100`) | Real, **but the audit's stated mechanism was wrong** — it described the release path as the reserve path. The actual bug: the whole capacity block was gated on `v_amount < reserved`, so a legacy row (`reserved = 0`) skipped both the cap check and the increment. Proven: **900,000 funded against a 100,000 cap returned ok**. |
| A-06-01 | **FIXED** | Real. Full decrypted EIN was rendered into receipt HTML, persisted and emailed — outliving `PAYOUT_ENCRYPTION_KEY`. Last-4 only now. Already-issued receipts are **not** backfilled; see `_RESUME-AFTER-RESTART.md` step 4. |
| A-09-02 | **FIXED** | Real. Capped at 200 with a visible total, matching the sibling query on the same page. |
| A-09-05 | **FIXED** | Real. Three crons had **never run in production**. Consolidated behind a `daily-maintenance` dispatcher. |
| B-01-1 | **DOES NOT REPRODUCE** | Audited page-in-isolation. `app/(sponsor)/layout.tsx` returns the awaiting-verification screen instead of `children`, so the page never renders and `requireSponsor()` never throws. |
| B-01-2 | **DOES NOT REPRODUCE** | Same class. `app/(coach)/layout.tsx` redirects to `/complete-profile` before `if (!authed) return null` is reachable. Dead defensive code. |

**Phantom rate: 2 in 9.** Both phantoms came from reading a page without its route-group layout.
Treat every remaining finding the same way — reproduce first, and check the layout chain before
believing any page-level claim.

### Corrections to the pack itself

- The P1 tally is **48**, not 47. The table below undercounts by one, the same way `A-09`'s
  header undercounts its blocks.
- Three premises are stale and must not drive design:
  - `A-09-03` argues from "Vercel Hobby's 10-second timeout". The default is now **300s across
    all plans**. Fix the N+1 because it is wasteful, not because it times out.
  - Group 6 (a11y) scans need animations settled — axe skips `opacity:0` elements entirely and
    reports phantom contrast failures mid-fade.
  - `A-09-05`'s "Vercel Pro required" framing was resolved by consolidation instead.

### Where the output lives

`findings/` and `handoff/` are **gitignored on purpose**. They enumerate 93 still-unfixed
findings with working repro steps — the same document class as the `*QA-REPORT*` /
`*REMEDIATION*` patterns already excluded in `.gitignore`. The audit *prompts* stay committed;
the evidence does not. They are present on Anish's machine only.

### P1 sweep executed — 2026-08-23

All 48 P1s worked in seven groups, each gated and deployed separately (PRs #6–#10).
**41 fixed, 3 do not reproduce, 4 deliberately not built.**

| Did not reproduce | Why |
|---|---|
| `A-02-03` | `remint_submission_access_token`'s **live** body already has the `is_trusted_server_context()` gate. The audit read migration `0070`; a later migration had closed it. |
| `A-11-01` | `instrumentation-client.ts` IS Next's supported convention (`sentry.client.config.ts` is the legacy one), and `initBotId` from that file is present in the built client bundle. Renaming would break BotID. |
| `A-08-02` | The element sits on a **CharcoalCard**, not the cream page background: 6.10:1, a pass. **The audit's proposed fix would have made it 2.91:1 — a real failure introduced by the fix.** |

| Deliberately not built | Why |
|---|---|
| `A-12-01` org switcher | The app refuses second-org membership by design; building it reverses a product invariant. |
| `A-12-04` PO / fiscal year | Net-new finance surface, not a bug. Half-building leaves money state in two shapes. |
| `B-03-08` governing-law clause | Content for counsel. Fabricating a jurisdiction into an ESIGN/UETA-executed document is worse than the gap; the signer is now warned instead. |
| stored-receipt EIN backfill | Re-rendering an issued receipt changes its `document_sha256`. Deferred pending a production census. |

**Correction rate: 3 phantoms + 3 findings whose stated mechanism was wrong (`A-04-01`,
`A-10-01`, `A-09-01`) out of 57 P0+P1.** Reproduce before fixing, every time.

### Found by this work, NOT in the pack

- `0104` — `team_verification_records.overridden_by` is `ON DELETE SET NULL` while its
  CHECK demanded NOT NULL, so deleting any admin who had overridden a verification made
  account deletion permanently impossible, after the webhook had already purged their
  government ID.

### Owed

`prompts/audits/_RESUME-AFTER-RESTART.md` — migrations **`0098`–`0105`** are applied and
proven on **local only**. Production DB access is blocked by the auto-mode classifier.
All code is merged to `main` and deployed. **The P2 (30) and P3 (16) tiers are untouched.**

---

### Final tally: 102 findings — 9 P0, 47 P1, 30 P2, 16 P3

| Audit | Findings | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|
| A-01 Auth & identity | 3 | 0 | 2 | 1 | 0 |
| A-02 RLS & tenant isolation | 4 | 1 | 2 | 1 | 0 |
| A-03 Server actions | 5 | 0 | 3 | 1 | 1 |
| A-04 Capacity/funding/ledger | 3 | 1 | 0 | 2 | 0 |
| A-05 Email & notifications | 5 | 0 | 3 | 1 | 1 |
| A-06 Storage & documents | 4 | 1 | 1 | 2 | 0 |
| A-07 UI/UX & IA | 6 | 0 | 2 | 2 | 2 |
| A-08 Accessibility (static) | 4 | 0 | 3 | 1 | 0 |
| A-09 Performance & scale | 5 | 2 | 3 | 0 | 0 |
| A-10 Security posture | 5 | 0 | 4 | 1 | 0 |
| A-11 Observability & recovery | 6 | 0 | 5 | 1 | 0 |
| A-12 Enterprise gaps | 7 | 0 | 4 | 2 | 1 |
| B-01 Auth flows (live) | 4 | 2 | 1 | 1 | 0 |
| B-02 Sponsor orgs (live) | 1 | 1 | 0 | 0 | 0 |
| B-03 Full journeys (live) | 24 | 1 | 7 | 8 | 8 |
| B-04 a11y & responsive (live) | 16 | 0 | 7 | 6 | 3 |
| **TOTAL** | **102** | **9** | **47** | **30** | **16** |

### Known defect IN the pack (fix before anyone works from it)
`handoff/A-09-claude-prompt.md` header says "4 findings (2 P0, 2 P1)". The file actually contains
**5 complete blocks (2 P0, 3 P1)** — A-09-01…A-09-05. Nothing is missing; the header undercounts.

### B-04 — attempt 1 stalled, attempt 2 succeeded
Attempt 1 (2026-08-21) passed its safety check but froze at 191 bytes and wrote nothing. Its
orphaned dev server survived on :3000 and was killed before relaunch — `_LANE-B-SETUP.md` warns a
stray server there is silently reused via `reuseExistingServer: true`.
Attempt 2 (2026-08-22) succeeded: 16 findings (0 P0, 7 P1, 6 P2, 3 P3), 196 settled axe scans.
The fix that worked: write findings incrementally, and do NOT attempt to automate VoiceOver
(recorded as a blocked step, substituted with DOM-level role/aria/label verification).

### Corrections applied during assembly
- `handoff/A-09-claude-prompt.md` header said "4 findings (2 P0, 2 P1)"; the file has 5 blocks
  (2 P0, 3 P1). Header corrected to 5.
- `handoff/B-04-claude-prompt.md` referred to "B-04-14", an id that appears only as an unlabelled
  P3 bullet. Repointed to the `proof-review-queue.tsx` item in the P3 batch so a fresh reader can
  resolve it.

### Live resources left running (local-only, safe)
- Next dev server, pid 85589, port 3000 — may die when the editor closes
- Local Docker Supabase, port 54321, at migration 0097 — persists until `npx supabase stop`

### Remaining work after B-04 lands
1. Quality-gate B-04 (same criteria as above).
2. Print the 16-part master report: summary table · consolidated "Fix by subscription" across all
   16 · top-10 highest-severity findings · all 16 handoff prompts as standalone fenced blocks in
   order A-01→A-12 then B-01→B-04.
   Parts 1–3 are already computed for the 15 finished audits; only B-04's rows are missing.

### Consolidated subscription items gathered so far
- Supabase Pro $25/mo — storage 1GB→100GB + egress (A-06); PITR for the financial ledger
  (A-09, A-11, A-12); connection limits under unthrottled `/sponsor-view` (A-10). Most-cited.
- Vercel Pro $20/user/mo — Hobby allows 2 crons, `vercel.json` declares 4 (A-09 P0, B-03
  INFERRED); 10s function timeout kills CSV export; cron failure alerting (A-11); commercial use.
- Resend Pro $20/mo — free tier 3,000/mo vs ~8,333/mo projected (A-05, A-09).
- Clerk Pro $29/mo (Orgs) / Business ~$300/mo+ (SAML SSO + SCIM) (A-09, A-10, A-12).
- Sentry Team $29/mo — 5k errors/mo free tier (A-09).
- No subscription findings: A-01, A-02, A-03, A-04, A-07, A-08, B-01, B-02.
