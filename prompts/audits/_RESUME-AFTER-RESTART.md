# Resume runbook — production DB work owed from the P0 sweep

**Written:** 2026-08-23. Execute this first in the session started with
`--dangerously-skip-permissions`. Everything here needs production database access, which the
auto-mode classifier denies regardless of the `Bash(psql *)` allow-rule.

```bash
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
set -a; source .env.local; set +a      # DATABASE_URL
```

---

## Why this is a runbook and not three `psql -f` commands

`0099` and `0100` are `CREATE OR REPLACE FUNCTION` bodies. They were authored by dumping the
**local** body with `pg_get_functiondef` and editing it. If production has drifted from local —
and there is no trustworthy record either way, because `psql -f` never stamps
`supabase_migrations.schema_migrations`, which is why `migration list --linked` still claims
production is at 0075 — then applying them **overwrites production-only fixes with a stale body.**

That exact failure has happened in this repo three times, once costing a P0 tenant takeover.
So: diff first, apply second.

---

## Step 1 — pre-flight drift check (read-only)

```sql
SELECT pg_get_functiondef(p.oid)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'sign_agreement_atomic';
```

Do the same for `sponsor_decide_submission_atomic` and `issue_funding_receipt`, against
production and against local (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`), and
diff them.

- **Identical** → the migration as written is safe to apply.
- **Different** → do NOT apply. Re-author the migration on top of the *production* body,
  re-verify on local, then apply.

Also confirm production actually has what the fixes depend on:

| Object | Needed by | If missing |
|---|---|---|
| `is_trusted_server_context()` | the B-03-01 null-actor receipt path (already deployed) | receipts keep failing — no regression, but say so |
| `sponsor_member_role_rank(text)` | `0099` | `0099` will not apply; find the migration that adds it |
| `current_sponsor_ids()` | `0099` / RLS | investigate before touching anything |
| `detect_capacity_drift()` | post-apply verification of `0100` | verify `0100` another way |
| policy `service_insert_notifications` on `notifications` | `0098` drops it | already gone — confirm the anon grant is gone too |

## Step 2 — apply, one transaction each

Each migration is idempotent, but wrap it anyway so a failed assertion rolls back rather than
half-landing:

```
BEGIN;
  \i supabase/migrations/0098_drop_anon_notification_insert.sql
  -- assert the post-condition below; if it fails, ROLLBACK
COMMIT;
```

| Migration | Assert before COMMIT |
|---|---|
| `0098_drop_anon_notification_insert.sql` | no row in `pg_policies` where `tablename='notifications' AND policyname='service_insert_notifications'`; `has_table_privilege('anon','public.notifications','INSERT')` is false |
| `0099_sign_agreement_member_rank.sql` | live body contains `sponsor_member_role_rank` and `'approver'` |
| `0100_sponsor_decide_capacity_delta.sql` | live body contains `v_delta` and the `IF v_delta > 0` branch |
| `0101_close_anon_actor_fallthrough.sql` | live body contains `ELSIF is_trusted_server_context()` **and still contains `v_delta`** — if `v_delta` is gone, 0101 was applied from a stale body and 0100 has just been erased |
| `0102_teams_update_requires_verified_coach.sql` | `pg_policies` row for `teams` / `UPDATE` contains `is_coach_verified()` **and** `is_admin()` |
| `0103_pending_storage_deletions.sql` | table exists with RLS enabled; `has_table_privilege('anon','public.pending_storage_deletions','SELECT')` is false |
| `0104_override_reason_survives_actor_deletion.sql` | `override_requires_reason` no longer mentions `overridden_by` |

| `0105_submissions_updated_at_index.sql` | `idx_submissions_updated_at` and `idx_submissions_status_updated_at` both exist |

**`0104` is not from the audit pack.** It was found while proving A-01-02:
`team_verification_records.overridden_by` is `ON DELETE SET NULL` while the CHECK demanded
it be NOT NULL, so deleting any admin who had ever overridden a team verification made the
`profiles` DELETE permanently impossible — after the Clerk webhook had already purged that
person's uploaded government ID. Apply it with the others; it unblocks account deletion.

**0101 supersedes 0100's body.** Apply them in order, or apply 0101 alone — it contains
0100's capacity reconciliation. Never apply 0100 *after* 0101.

## Step 3 — verify against production (read-only, except the anon probe)

**A-02-01 — the exploit itself.** With the *public anon key*:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/notifications" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"recipient_id":"00000000-0000-0000-0000-000000000000","type":"general","title":"probe"}'
```

Expect **401/403**. Must be **201 before the fix and refused after**.

**Send it WITHOUT `Prefer: return=representation`.** With that header the RETURNING clause is
additionally checked against the SELECT policy, so a genuine INSERT hole comes back as a
permission error and reads as a false negative. That is how this exploit was nearly missed.

If it does return 201 on a row that lands, delete that probe row.

**A-04-01 — capacity.** `SELECT * FROM detect_capacity_drift();`

Zero rows is the pass. **Any rows are pre-existing damage from before `0100`, not a regression.**
Census and report them. Do **not** silently correct money state — that is a separate, deliberate
decision with an audit trail, not a side effect of a security fix.

**B-02-01 / B-03-01** — read-only confirmation of the function bodies only. Both were proven
end-to-end on local. Do **not** drive a live signature or mint a live receipt in production.

## Step 4 — the EIN census (read-only)

The A-06-01 fix is forward-only: new receipts carry last-4, already-issued receipts still hold a
plaintext EIN in `funding_receipts.document_html`. Re-rendering them would change their
`document_sha256`, and the immutability of an issued financial document is the entire point — so
the backfill was deliberately deferred pending this number.

```sql
SELECT count(*) FILTER (WHERE document_html ~ '\d{2}-\d{7}') AS hyphenated,
       count(*) FILTER (WHERE document_html ~ '(?<!\d)\d{9}(?!\d)') AS bare,
       count(*) AS total
  FROM funding_receipts;
```

Report the number. If it is zero, the finding is closed outright. If not, it is a separate
decision: leave them (immutable, access already restricted) or re-issue with a superseding
document that preserves the original hash chain.

## Step 5 — repair the migration ledger (optional, recommended)

Only after Step 1 confirmed each is genuinely live. Insert `0076`–`0100` into
`supabase_migrations.schema_migrations` so `migration list --linked` stops claiming production
is at 0075. Getting this wrong makes the ledger lie in the *other* direction, which is worse —
so it is gated on the drift check passing, not on convenience.

---

## Then: the 48 P1 findings

`prompts/audits/handoff/*-claude-prompt.md` (gitignored, present on disk). Group order, from the
approved plan:

1. Security / RLS / money — `A-02-02`, `A-02-03`, `A-06-02`, `A-10-01`…`-04`, `B-01-3`
2. Journeys / correctness — `B-03-02`…`-08`, `A-03-01`, `-02`, `-05`, `A-01-01`, `-02`
3. Notifications — `A-05-01`…`-03`
4. Observability — `A-11-01`…`-05`
5. Performance — `A-09-01`, `-03`, `-04`
6. Accessibility — `A-08-01`…`-03`, `B-04-01`…`-06`, `B-04-16`, `A-07-01`, `-02`
7. Enterprise — `A-12-01`…`-04`

**Reproduce every finding before fixing it.** The P0 pass ran 2-in-9 phantom, and `A-04-01`'s
stated mechanism was wrong even though the bug underneath it was real — and nine times worse
than described. Three premises in the pack are known stale: Vercel's function timeout is **300s
across all plans**, not 10s (`A-09-03` argues from the old number); axe skips `opacity:0`
elements entirely, so Group 6 scans need animations settled; and `A-09`'s own header undercounts
its blocks.
