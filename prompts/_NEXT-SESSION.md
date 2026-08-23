# Next session — start here

**Written:** 2026-08-23, at the end of the session that executed `_FINISH-EVERYTHING.md` —
the **P2 tier, the P3 tier, and the five deferred items**.
**Branch:** `main`.
**Production:** migrations `0098`–`0110` are **all applied**, each with its post-condition
asserted before COMMIT. `detect_capacity_drift()` returns **0 rows**.

---

## The Gemini audit pack is CLOSED. Do not re-open it.

All **102 findings** (9 P0 · 48 P1 · 30 P2 · 16 P3) have been worked. The per-finding record,
including every finding that did not reproduce and the evidence for that, is in
`prompts/audits/_ORCHESTRATOR-STATE.md`. `prompts/audits/` is now history, not a queue —
the same status `prompts/revamp/` already had.

`findings/` and `handoff/` remain gitignored and exist only on this machine.

---

## THE ONE THING THAT IS NOT AN ENGINEERING TASK

> **Anish: the platform cannot execute a sponsorship agreement until you get a governing-law
> clause from counsel.**

Section 11 of the effective `sponsorship_agreement` template reads, verbatim:

```
TODO(legal): jurisdiction to be set by counsel.
```

What is needed, and nothing else:

1. Ask a lawyer for the governing-law / jurisdiction clause (which state's law governs, and
   where disputes are heard).
2. Publish it as a new template version through `/agreements` in the admin portal.
3. Clear `needs_legal_review` on that version — the admin **Mark reviewed** control.

Until step 3, `sign_agreement_atomic` **refuses** to record a signature
(`template_needs_legal_review`, migration `0106`) and the signing panel says so plainly. That
is deliberate: migration `0079`'s own header states an attorney must review the seeded body
"before this platform relies on it in a real transaction", and until this session nothing
enforced it. No jurisdiction was invented — the executed record attests to the exact bytes
shown and is SHA-256'd as evidence, so fabricating one would be worse than the gap.

**Production is pre-launch (0 submissions, 0 teams), so nothing is blocked today.** But no
sponsor can sign until this is done.

---

## State of the world

Gate at close of this session:

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | **0 errors** |
| `npm run test` | **735 passing** (baseline entering the session: 550) |
| `npm run build` | exit 0 |
| `scripts/verify-capacity-invariant.mjs` | 10/10, now including a negative control |
| `detect_capacity_drift()` in production | **0 rows** |

### Production database — what changed this session

`0098`–`0105` had been proven on local only. **Production had none of them.** They are now
applied, plus five new ones written this session:

| Migration | What |
|---|---|
| `0098` | Drops the anon notification INSERT hole |
| `0099` | Sign-agreement approver-rank gate |
| `0100`/`0101` | Capacity signed-delta + anon actor fall-through |
| `0102` | `teams_update` requires a verified coach |
| `0103` | `pending_storage_deletions` |
| `0104` | `override_reason` survives actor deletion |
| `0105` | `submissions` indexes |
| **`0106`** | `needs_legal_review` gate + orphaned-fulfillment gate |
| **`0107`** | `withdrawn` submission status |
| **`0108`** | Explicit `WITH CHECK` on 4 UPDATE policies |
| **`0109`** | Sponsor self-serve audit log |
| **`0110`** | PO numbers + fiscal-year boundary |

> **A-02-01 was live and remotely exploitable in production until this session.** Anyone with
> the public anon key could forge a notification to any user. The probe now returns 401 both
> with and without `Prefer: return=representation` — that header matters, and is how the
> exploit was nearly missed.

The migration **ledger is repaired**: `0076`–`0110` are stamped, so
`supabase migration list --linked` no longer claims production is at `0075`.

---

## Product decisions made this session (do not relitigate)

Two were escalated rather than decided unilaterally, and Anish answered both:

- **Multi-org sponsor membership is SUPPORTED.** A sponsor user may belong to two
  organizations, with a switcher in the portal. The active org is a cookie and is therefore
  treated as a *preference* — it is re-validated against real memberships on every request and
  can never introduce an org the caller does not hold.
- **PO numbers and fiscal years are BUILT**, but `funding_cap_cents` remains the **single**
  enforcement point for capacity. The fiscal year is a reporting boundary; nothing resets
  `funding_used_cents` automatically, because a silent reset is money state changing with no
  actor and no audit row.

Closed as decisions rather than code:

- **IdP group → role mapping** stays unbuilt. An SSO first login lands on `viewer` because an
  IdP-authenticated stranger must not be able to move money on day one, and `approver` is the
  rank that countersigns funding. Shipping the mapping would hand budget authority to whoever
  controls a customer's directory groups. Invariant pinned by tests.

Still locked from earlier sessions: the platform **never touches funds** (pledge-and-track),
e-sign is **in-house** (ESIGN/UETA), sponsor multi-user is **Clerk Organizations**, FTC
verification uses the **official FIRST API** with FTCScout as fallback.

---

## Things worth knowing before you touch anything

### Migrations
The latest is **`0110`**. Confirm with `ls supabase/migrations | tail -3` — this line has been
stale before. Apply with `psql -f`, never `supabase db push`.

**Never rebuild a function body from an older migration file.** Dump the live body with
`pg_get_functiondef` and patch that. `0106` was written that way — a script patched the dumped
text — precisely because transcribing has silently deleted later fixes three times here.

### The E2E suite collects 531 tests in 22 files
`tests/e2e/payout-w9.spec.ts` could not be **collected** before this session: it imported a
validator through a `'use server'` module, which drags in `server-only`, and Playwright failed
the whole file. Every payout/W-9 security-boundary test in it was silently absent. Confirmed
pre-existing by reproducing it at the session's starting commit. The validator now lives in
`lib/file-validation.ts`.

That is the same failure class as B-04-12, where a dialog-focus test skipped on every clean run
and skipped read as a pass. **If a test can't run, it isn't a test.**

### Cron: Vercel Hobby honours only 2 entries
`vercel.json` schedules exactly two. `refresh-ftc-roster`, `nudge-fulfillments` and
`impact-rollup` run inside the `daily-maintenance` dispatcher. **A new cron job goes inside the
dispatcher, not into `vercel.json`**, unless the project moves to Pro.

### Deploys are manual
`vercel deploy --prod --yes`. Pushing to `main` deploys nothing.

---

## What is actually left

Nothing from the audit pack. The open items are yours, not the code's:

1. **The governing-law clause** — see the top of this file. This is the only thing blocking a
   real sponsorship from being executed.
2. **DMARC** — still outstanding from an earlier session.
3. **Subscription decisions** — the consolidated list is at the bottom of
   `prompts/audits/_ORCHESTRATOR-STATE.md`. The one with a real functional consequence is
   Vercel Pro: on Hobby, only 2 cron entries run, which is why the dispatcher exists.
