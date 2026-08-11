# Prompt 11 — Admin roles (reviewer vs super admin) + capacity-invariant verification

> **Prerequisites:** None
> **Reserved migration:** `0084_admin_levels_and_capacity_audit.sql` — verify it is still free with `ls supabase/migrations | tail -3`
> **Scope:** large · ~22 files
> **Leaves the repo:** green and shippable on its own

## Why this exists

Today `profiles.role = 'admin'` is a single, total privilege. The same account that clears
the moderation queue can also rewrite `sponsors.funding_cap_cents`, approve sponsor
companies into existence, and (via direct DB access) mint more admins. There is no way to
hand the review queue to a volunteer without also handing them the money dial.

Separately, an external audit claimed the refund / capacity-release logic was missing. It
is **not** missing — see `_CONTEXT.md` §4 and the "Current state" section below. What is
missing is *proof* that the invariant holds and a *detector* for when it stops holding.
This slice adds the privilege split and the proof; it does not rebuild the money code.

## Current state (verified)

### Admin privilege — read these before writing anything

- `user_role` enum is `coach | admin | sponsor` (`_CONTEXT.md` §2). There is **no**
  `admin_level`, no `admin_permissions` table, and no `is_super_admin()`.
- `lib/actions-utils.ts:106-112` — `requireAdmin()` is the only admin gate. It checks
  `user.role !== 'admin'` and returns `{ supabase, user, clerkUserId, adminClient }`.
- SQL helpers live in `supabase/migrations/0051_clerk_auth.sql:41-63`:
  `current_profile_id()`, `is_admin()`, `is_coach_verified()`. All SECURITY DEFINER,
  STABLE, `SET search_path = public`. `is_trusted_server_context()` is in
  `0072_trusted_server_context.sql`.
- `prevent_role_elevation()` (`0051_clerk_auth.sql:66-81`) is a trigger on `profiles` that
  blocks `role` and `coach_verified` changes by non-admins. **It early-returns on a raw
  `(auth.jwt() ->> 'sub') IS NULL` test (line 70-72)** — the exact anti-pattern
  `_CONTEXT.md` §8 rule 6 forbids, because the anon key also has no `sub`. It also means
  the trigger never fires for anything the service-role admin client does, which is every
  server action.
- **There is no admin-provisioning code path at all.** Admins exist only because
  `scripts/seed-test-accounts.mjs:65,180` inserts them or because someone edited the row
  by hand. Grep confirms zero server actions write `role: 'admin'`.
- Clerk `publicMetadata.role` is mirrored for UX only (`app/actions/auth.ts:110-114`,
  `:365-369`) and is never trusted for authorization.

Everything currently gated on plain `requireAdmin()`:

| File | Export | Should become |
|---|---|---|
| `app/actions/moderation.ts:15` | `approveSubmission` | reviewer (unchanged) |
| `app/actions/moderation.ts:150` | `redispatchSubmission` | reviewer (unchanged) |
| `app/actions/moderation.ts:241` | `declineSubmission` | reviewer (unchanged) |
| `app/actions/moderation.ts:302` | `requestEdit` | reviewer (unchanged) |
| `app/actions/admin.ts:25` | `verifyCoach` | reviewer (unchanged) |
| `app/actions/admin.ts:185` | `denyCoach` | reviewer (unchanged) |
| `app/actions/admin.ts:269` | `approveSponsorApplication` | **super admin** |
| `app/actions/admin.ts:423` | `rejectSponsorApplication` | **super admin** |
| `app/actions/sponsor.ts:99` | `adminCreateSponsor` | **super admin** |
| `app/actions/sponsor.ts:144` | `adminUpdateSponsor` | **super admin** |
| `app/actions/sponsor.ts:193` | `deleteSponsor` | **super admin** |
| `app/actions/sponsor.ts:268` | `adminToggleSponsorStatus` | **super admin** |
| `app/actions/sponsor.ts:236` | `searchSponsors` | reviewer (unchanged) |
| `app/api/admin/export/route.ts:50-58` | `GET` | **super admin** |

`adminUpdateSponsor` is the funding-cap write: `app/actions/sponsor.ts:168` sets
`funding_cap_cents: result.data.fundingCapCents`. The UI is
`app/(admin)/sponsors/[id]/edit/page.tsx` → `components/sponsor/sponsor-form.tsx`.
`adminToggleSponsorStatus` is super-admin because flipping a capped sponsor back to
`active` is a capacity-governance act.

### Capacity release — ALREADY IMPLEMENTED, do not rebuild

Read these four files before you write a single line about money:

- `supabase/migrations/0047_reserve_at_approval.sql`
  - `approve_submission_atomic` (line 33) — RESERVE. Locks the sponsor `FOR UPDATE`,
    rejects `insufficient_sponsor_capacity`, sets `reserved_amount_cents`, bumps
    `funding_used_cents`, flips the sponsor to `inactive` at cap, mints the access token.
  - `release_submission_reservation(p_submission_id, p_new_status, p_reason)` (line 105) —
    RELEASE. Accepts only `expired | bounced | declined | changes_requested`, only from
    `dispatched | delivered | opened`, subtracts, zeroes the reservation, re-activates the
    sponsor, writes `audit_log.action = 'release_reservation'`.
  - `expire_overdue_submissions()` (line 156) — batch expiry loop used by the cron.
- `supabase/migrations/0065_fix_sponsor_decide_double_debit.sql` — portal SETTLE. Contains
  the `already_decided` ledger guard at lines 141-146 and releases the unfunded difference
  on a partial (lines 173-182).
- `supabase/migrations/0071_token_decision_check_status_first.sql` — token SETTLE. Resolves
  the token, validates status, *then* claims. **It has NO `already_decided` ledger check** —
  the only thing preventing a double settle on this path is the single-use token.
- `supabase/migrations/0067_release_reservation_on_submission_delete.sql` —
  `trg_release_reservation_on_delete`, a BEFORE DELETE trigger that catches the Clerk
  account-deletion CASCADE (no app code runs on that path).
- `app/api/cron/expire-submissions/route.ts` — daily 02:00 UTC. Calls
  `expire_overdue_submissions()`, cleans stale tokens, sweeps unpurged credentials,
  notifies each affected coach, and writes one `audit_log` row
  (`action = 'cron_expire_submissions'`).

The invariant, stated in `0047`'s own header (line 20) and re-stated in `0065`'s
verification block (lines 215-222):

```
sponsors.funding_used_cents
  = SUM(submissions.reserved_amount_cents WHERE status IN ('dispatched','delivered','opened'))
  + SUM(transactions_ledger.amount_cents)
```

Nothing in the repo asserts this. There is no drift detector, no test that exercises
decline / partial / expiry / bounce / delete, and no alarm if a sponsor's row goes wrong.
`sponsors` has a `CHECK (funding_used_cents <= funding_cap_cents)` but that catches only
the overflow direction, never under-counting or a stranded reservation.

## What you are building

1. `admin_level` on `profiles` (`reviewer | super_admin`), an `is_super_admin()` SQL
   helper, and a `requireSuperAdmin()` guard in `lib/actions-utils.ts`.
2. A database-enforced floor of **at least one `super_admin`** that no UI bug and no
   direct SQL statement can cross.
3. Tightened RLS policies and tightened server actions per the table above.
4. Two new super-admin-only server actions: `setAdminLevel` and `provisionAdmin`, plus an
   admin management page.
5. `already_decided` parity for the token decision path.
6. `detect_capacity_drift()` — a read-only SQL function that returns every sponsor whose
   row violates the invariant — surfaced on an admin page and checked nightly by the
   existing cron.
7. Tests that *prove* the invariant survives decline, partial fund, expiry, bounce, and
   coach-account-deletion cascade.

### Decision: column, not permissions table

Use **`profiles.admin_level`**, an enum column. Justification: the capability split is a
single ordered dimension with exactly two rungs and no foreseeable third axis, so a join
table would add a query to every RLS helper (`is_super_admin()` runs inside policies) to
model flexibility nobody has asked for. Revisit only when a third orthogonal capability
appears.

### Part (b) is VERIFICATION, not a rebuild — read this twice

**Do not modify `approve_submission_atomic`, `release_submission_reservation`,
`expire_overdue_submissions`, `sponsor_decide_submission_atomic`, or
`release_reservation_before_submission_delete` unless a test you wrote proves a real bug.**
If a test fails, **stop, write up the failing scenario with the exact SQL and the observed
vs expected `funding_used_cents`, and report it before changing anything.** A "fix" to
these functions written from a hunch is how `0053` created the double-debit that `0065`
had to undo.

The one change to money code that IS in scope is the `already_decided` asymmetry in
`record_sponsor_decision_atomic` (below) — that is a known, documented gap, not a
speculative fix.

## Data model

### Enum + column

```sql
DO $$ BEGIN
  CREATE TYPE admin_level AS ENUM ('reviewer', 'super_admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS admin_level admin_level;

COMMENT ON COLUMN profiles.admin_level IS
  'NULL for non-admins. reviewer = moderation queue + coach verification only. '
  'super_admin = additionally funding caps, sponsor applications, admin provisioning, exports.';

-- Only admins carry a level. Non-admins must be NULL.
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_admin_level_requires_admin;
ALTER TABLE profiles ADD CONSTRAINT profiles_admin_level_requires_admin
  CHECK (admin_level IS NULL OR role = 'admin') NOT VALID;
ALTER TABLE profiles VALIDATE CONSTRAINT profiles_admin_level_requires_admin;

-- Backfill: every existing admin becomes super_admin. Anything else is a lockout.
UPDATE profiles SET admin_level = 'super_admin'
 WHERE role = 'admin' AND admin_level IS NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_admin_level
  ON profiles (admin_level) WHERE admin_level IS NOT NULL;
```

Run the `UPDATE` **before** adding the lockout trigger, or a fresh replay on a database
whose admins are all NULL will trip it.

### Lockout floor (database-enforced, per the prompt requirement)

```sql
CREATE OR REPLACE FUNCTION assert_super_admin_floor()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE role = 'admin' AND admin_level = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'refusing to leave the platform with zero super admins'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_assert_super_admin_floor ON profiles;
CREATE CONSTRAINT TRIGGER trg_assert_super_admin_floor
  AFTER UPDATE OR DELETE ON profiles
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_super_admin_floor();
```

`CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED` is deliberate: it fires at COMMIT,
so a transaction that promotes B and demotes A in either order still succeeds, while a
transaction that ends with zero super admins always fails. A plain `AFTER` trigger would
reject the legitimate hand-off. Fires on `AFTER UPDATE OR DELETE` only — an INSERT can
never reduce the count.

### Helper functions

```sql
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
     WHERE clerk_user_id = (auth.jwt() ->> 'sub')
       AND role = 'admin'
       AND admin_level = 'super_admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;
```

Mirror `is_admin()` exactly — same language, same volatility, same `search_path`.
`is_admin()` itself is **unchanged**: a reviewer is still an admin.

Per `_CONTEXT.md` §8 rule 4, every SECURITY DEFINER function added in this migration —
`is_super_admin`, `assert_super_admin_floor`, `detect_capacity_drift` — gets:

```sql
REVOKE EXECUTE ON FUNCTION <sig> FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION <sig> TO service_role;
```

**Exception:** `is_super_admin()` is called from inside RLS policies evaluated as the
`authenticated` role, so it must keep `EXECUTE` for `authenticated` — exactly like
`is_admin()`. Do not revoke it; add a comment in the migration saying why, so a future
lock-down sweep does not break every policy.

### `prevent_role_elevation()` — replace, do not extend in place

```sql
CREATE OR REPLACE FUNCTION prevent_role_elevation()
RETURNS TRIGGER AS $$
BEGIN
  -- 0072 rule: is_trusted_server_context(), never a raw `sub IS NULL` test.
  IF is_trusted_server_context() THEN RETURN NEW; END IF;

  IF NEW.role IS DISTINCT FROM OLD.role AND NOT is_super_admin() THEN
    RAISE EXCEPTION 'role change requires a super admin';
  END IF;
  IF NEW.admin_level IS DISTINCT FROM OLD.admin_level AND NOT is_super_admin() THEN
    RAISE EXCEPTION 'admin_level change requires a super admin';
  END IF;
  IF NEW.coach_verified IS DISTINCT FROM OLD.coach_verified AND NOT is_admin() THEN
    RAISE EXCEPTION 'coach_verified modification not permitted';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
```

Two things changed and you must call both out in the migration comment:

1. The raw `sub IS NULL` early-return becomes `is_trusted_server_context()`. This closes a
   fail-open hole (the anon key satisfies the old test). Verify nothing legitimate
   regresses: anon has no policy that permits a `profiles` UPDATE, so nothing should.
2. `role` / `admin_level` now require super admin; `coach_verified` still only requires
   admin, so reviewers keep working the coach queue.

**Honest limitation, state it in the file:** every server action writes through the
service-role admin client, which has no Clerk `sub`, so this trigger returns early for all
of them. It is defence-in-depth against direct PostgREST calls. The *real* gate for server
actions is `requireSuperAdmin()`. Do not present the trigger as the primary control.

### RLS policies to tighten

Before editing, enumerate reality — do not trust this list blind:

```sql
SELECT tablename, policyname, cmd, qual, with_check
  FROM pg_policies
 WHERE schemaname = 'public'
   AND (qual LIKE '%is_admin%' OR with_check LIKE '%is_admin%')
 ORDER BY tablename, policyname;
```

Then `DROP POLICY IF EXISTS` + `CREATE POLICY` each of these, swapping `is_admin()` for
`is_super_admin()`:

- **`sponsors` INSERT** (`sponsors_insert`) — `WITH CHECK (is_super_admin())`. Creating a
  sponsor company sets a funding cap.
- **`sponsors` UPDATE** (`sponsors_update`) — `USING (is_super_admin()) WITH CHECK
  (is_super_admin())`. This is the funding-cap write.
- **`sponsors` DELETE** (`sponsors_delete`) — `USING (is_super_admin())`.
- **`sponsor_applications`** — every non-SELECT admin policy becomes `is_super_admin()`;
  leave the admin SELECT at `is_admin()` so a reviewer can still see the pipeline.

Leave **unchanged** (reviewers need them): `sponsors_select`, `sponsors_select_own`,
`profiles_select`, `submissions_*`, `teams_*`, `team_achievements_*`, `notifications_*`,
`audit_log` read, `transactions_ledger` read (`0069`).

`profiles_update_admin` stays at `is_admin()` — narrowing it would stop reviewers writing
`coach_verified`. The `role` / `admin_level` columns are protected by
`prevent_role_elevation()` above, which is the right layer for a *column* rule (RLS is
row-level only; this is exactly the reasoning in
`0064_submissions_policy_hardening.sql:182-185`).

If any policy name above does not exist under that name, use the name the catalog query
returned and note the substitution in your report.

### Token-path `already_decided` parity

`CREATE OR REPLACE FUNCTION record_sponsor_decision_atomic(text, text, bigint)` with the
body from `0071_token_decision_check_status_first.sql`, byte-identical except: immediately
after the status check (0071 line 73) and **before** the token claim (0071 line 77),
insert the same guard `0065` uses at lines 141-146:

```sql
  IF EXISTS (
    SELECT 1 FROM transactions_ledger tl
     WHERE tl.submission_id = v_submission_id AND tl.actor_type = 'sponsor'
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'already_decided');
  END IF;
```

Before the claim, so a sponsor who hits an already-settled pitch keeps a live link — the
whole point of `0071`. `already_decided` is already mapped to a user-facing string in
`app/actions/sponsor-decision.ts:35`, so no client change is needed.

Re-apply the explicit REVOKE/GRANT block from `0071:136-139` after the replace.

### Drift detector

```sql
CREATE OR REPLACE FUNCTION detect_capacity_drift()
RETURNS TABLE (
  sponsor_id uuid,
  company_name text,
  funding_cap_cents bigint,
  funding_used_cents bigint,
  open_reservations_cents bigint,
  settled_ledger_cents bigint,
  expected_used_cents bigint,
  drift_cents bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT s.id, s.company_name, s.funding_cap_cents, s.funding_used_cents,
         r.open_cents, l.settled_cents,
         r.open_cents + l.settled_cents AS expected_used_cents,
         s.funding_used_cents - (r.open_cents + l.settled_cents) AS drift_cents
    FROM sponsors s
    CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(sub.reserved_amount_cents), 0)::bigint AS open_cents
        FROM submissions sub
       WHERE sub.sponsor_id = s.id
         AND sub.status IN ('dispatched', 'delivered', 'opened')
    ) r
    CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(tl.amount_cents), 0)::bigint AS settled_cents
        FROM transactions_ledger tl
       WHERE tl.sponsor_id = s.id
    ) l
   WHERE s.funding_used_cents <> r.open_cents + l.settled_cents;
$$;
```

Returns zero rows in a healthy system. `drift_cents > 0` = the sponsor's cap is being
under-served (money reserved that nothing accounts for). `drift_cents < 0` = the books
under-count and the cap can be overrun.

Note the deliberate exclusion: `submissions.deleted_at` is **not** filtered, because a
soft-deleted row in an awaiting-sponsor state still holds its reservation and must still
count. If you find yourself wanting to add `deleted_at IS NULL`, stop — that would make
the detector agree with a bug instead of finding it.

SECURITY DEFINER + revoke from PUBLIC/anon/authenticated, grant to service_role. It is
called only through the admin client.

## Server actions

All follow the canonical 5-step shape in `_CONTEXT.md` §7.

### New guard — `lib/actions-utils.ts`

```ts
export async function requireSuperAdmin() {
  const { supabase, user, clerkUserId } = await requireAuth()
  if (user.role !== 'admin' || user.admin_level !== 'super_admin') {
    throw new Error('Forbidden')
  }
  return { supabase, user, clerkUserId, adminClient: createAdminClient() }
}
```

Place it directly under `requireAdmin()` (line 106-112) and match its shape exactly.
`requireAdmin()` is **unchanged** — a reviewer must still pass it.

You must also set `admin_level: 'super_admin'` on `MOCK_ADMIN_PROFILE` in
`lib/dev-bypass.ts:36` or `npm run dev:admin-preview` breaks the moment any page calls
`requireSuperAdmin()`.

### `setAdminLevel(input)` — `app/actions/admin.ts`

- Schema: `z.object({ profileId: z.string().uuid(), level: z.enum(['reviewer','super_admin']) })`
  in a new `lib/schemas/admin.ts`.
- Guard: `requireSuperAdmin()`.
- Refuse `parsed.data.profileId === user.id` when demoting to `reviewer` with the message
  `'You cannot demote yourself. Ask another super admin.'` — a UX guard on top of, never
  instead of, the DB floor trigger.
- Mutate via `adminClient` (`profiles.update({ admin_level })` with
  `.eq('role','admin')` so a coach can never be handed a level).
- Map error `23514` from the floor trigger to
  `'There must always be at least one super admin.'`
- `audit_log.action = 'set_admin_level'`, metadata `{ from, to, target_profile_id }`.
- Notify the target: `createInAppNotification({ type: 'general', ... })`.

### `provisionAdmin(input)` — `app/actions/admin.ts`

- Schema: `{ email: z.string().email(), level: z.enum(['reviewer','super_admin']) }`.
- Guard: `requireSuperAdmin()`.
- Look the profile up by **lowercased** email (`profiles.email` is Clerk-lowercased; this
  is the exact bug fixed in `approveSponsorApplication`, see `app/actions/admin.ts:350-359`)
  with `.limit(1).maybeSingle()`.
- Refuse if the profile is `role='sponsor'` with a non-null `sponsor_id`, or `role='coach'`
  with a team — promoting those strands their data. Return a specific message.
- Set `role='admin'`, `admin_level=<level>`, and mirror `publicMetadata.role = 'admin'`
  into Clerk with `clerkClient` exactly as `app/actions/auth.ts:110-114` does. A Clerk
  mirror failure is non-fatal: log to Sentry, return `{ success: true, warning }`.
- `audit_log.action = 'provision_admin'`. Notify the new admin.

### `demoteAdmin(input)` — `app/actions/admin.ts`

- Schema: `{ profileId: z.string().uuid(), newRole: z.enum(['coach','sponsor']) }`.
- Guard: `requireSuperAdmin()`. Self-demotion refused as above.
- Sets `role=newRole`, `admin_level=null`, mirrors Clerk metadata.
- `audit_log.action = 'demote_admin'`. Notify.

### Guard swaps (no other change to these functions)

Replace `requireAdmin()` with `requireSuperAdmin()` in exactly these places, leaving every
other line alone:

- `app/actions/admin.ts` — `approveSponsorApplication` (line 275-280),
  `rejectSponsorApplication` (line 429-434)
- `app/actions/sponsor.ts` — `adminCreateSponsor` (107), `adminUpdateSponsor` (152),
  `deleteSponsor` (199), `adminToggleSponsorStatus` (272)
- `app/api/admin/export/route.ts` — the `requireAdmin()` at line 53; keep the existing
  `catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }` (API routes
  return JSON, never a redirect — `_CONTEXT.md` §1).

### `runCapacityAudit()` — new `app/actions/capacity-audit.ts`

- No input. Guard: `requireAdmin()` (a reviewer may look; only a super admin may change
  anything, and this action changes nothing).
- `adminClient.rpc('detect_capacity_drift')`, returns `{ rows }`.
- Writes `audit_log.action = 'capacity_audit_run'` with `{ drift_count, sponsor_ids }`.
- No notification — it is a read.

## UI

- **`app/(admin)/admin/team/page.tsx`** — "Admin team". Lists every `role='admin'` profile
  with name, email, level, created_at. Server component reading through the RLS-respecting
  server client; renders `components/admin/admin-level-controls.tsx` (client) per row.
  - Gate the page itself: `requireSuperAdmin()` inside a `try/catch`, redirect a reviewer
    to `/admin` with a toast-free 403-style empty state rather than a crash.
  - States: **empty** — impossible (you are on it), but render "Only you" gracefully;
    **loading** — `loading.tsx` skeleton matching `app/(admin)/coaches/loading.tsx`;
    **error** — inherit `app/(admin)/error.tsx`; **permission-denied** — a card reading
    "Super admin access required" with a link back to `/moderation`.
  - The row for the signed-in user renders its level as static text with the hint
    "You cannot change your own level", not a disabled select that looks broken.
- **`app/(admin)/admin/capacity/page.tsx`** — "Capacity audit". Calls `runCapacityAudit()`,
  renders a table of drifting sponsors (company, cap, used, expected, drift). Empty state
  is the good one: a green "No drift detected across N sponsors" card. Reviewer-visible.
- **`components/admin/admin-sidebar.tsx`** — add two `NAV_ITEMS` entries, `Admin team`
  (`/admin/team`, icon `UserCog`) and `Capacity` (`/admin/capacity`, icon `Scale`).
  Hide `Admin team` when the level is not `super_admin`; pass `adminLevel` down from
  `app/(admin)/layout.tsx`, which already resolves the profile for `userName`/`userEmail`.
- **`components/sponsor/sponsor-form.tsx`** — when the viewer is a reviewer, render the
  funding-cap input `disabled` with helper text "Only a super admin can change a funding
  cap." The server action is the real gate; this only stops a pointless round trip.
- **`app/api/cron/expire-submissions/route.ts`** — after the existing audit write (line
  112-127), call `detect_capacity_drift()`. If it returns rows, `Sentry.captureException`
  with the row payload in `extra` and write a second `audit_log` row
  `action = 'capacity_drift_detected'`, metadata `{ count, rows }`. **A drift finding must
  never fail the cron response** — wrap it in its own try/catch and keep returning
  `{ expired }` on the happy path (add `drift: n` to the JSON body).

## Out of scope

- Any change to `approve_submission_atomic`, `release_submission_reservation`,
  `expire_overdue_submissions`, `sponsor_decide_submission_atomic`, or
  `release_reservation_before_submission_delete` — unless a failing test proves a bug, in
  which case you **report first**.
- A third admin tier, per-table permission grids, or an `admin_permissions` table.
- Auto-repairing drift. The detector reports; a human decides. Silent repair would erase
  the evidence of whatever caused it.
- Clerk Organizations. Roles stay authoritative in `profiles`.
- Any change to `is_admin()` semantics.

## Guardrails specific to this slice

- **Never `auth.uid()`.** It is NULL under Clerk (`_CONTEXT.md` §1).
- `is_super_admin()` must keep `EXECUTE` for `authenticated` because policies call it.
  Every *other* new SECURITY DEFINER function gets the full REVOKE/GRANT treatment.
- The `UPDATE profiles SET admin_level='super_admin'` backfill must run **before** the
  floor trigger is created, or a from-scratch replay fails.
- Use `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED`. A non-deferred trigger blocks
  the legitimate promote-then-demote hand-off inside one transaction.
- `prevent_role_elevation()` early-returns for the service-role client. Do not describe the
  trigger as the primary authorization control — `requireSuperAdmin()` is.
- The drift query must **not** filter `submissions.deleted_at`.
- `profiles.email` is lowercased by Clerk. Lowercase both sides of any email lookup and
  always `.limit(1)` — the fan-out bug documented at `app/actions/admin.ts:356-359`.
- Adding a column to `profiles` does **not** trip
  `guard_submission_writable_columns()` — that guard is on `submissions` only. No allowlist
  change is needed in this slice. (Mentioned because the rule is easy to over-apply.)
- Migration contains `$$`-quoted blocks → **must** be applied with `psql -f`.
- Do not touch `lib/dispatch.ts`. Admin-Gatekept Outreach is unaffected by this slice.

## Files you will touch

**Create:**
- `supabase/migrations/0084_admin_levels_and_capacity_audit.sql`
- `lib/schemas/admin.ts`
- `app/actions/capacity-audit.ts`
- `app/(admin)/admin/team/page.tsx`
- `app/(admin)/admin/team/loading.tsx`
- `app/(admin)/admin/capacity/page.tsx`
- `components/admin/admin-level-controls.tsx`
- `components/admin/capacity-drift-table.tsx`
- `lib/__tests__/admin-levels.test.ts`
- `lib/__tests__/capacity-invariant.test.ts`
- `scripts/verify-capacity-invariant.mjs`
- `tests/e2e/admin-levels.spec.ts`

**Modify:**
- `lib/actions-utils.ts` (add `requireSuperAdmin`)
- `lib/dev-bypass.ts` (`MOCK_ADMIN_PROFILE.admin_level`)
- `lib/supabase/types.ts` (regenerate or hand-add `admin_level`, `is_super_admin`,
  `detect_capacity_drift`)
- `app/actions/admin.ts` (guard swaps + 3 new actions)
- `app/actions/sponsor.ts` (4 guard swaps)
- `app/api/admin/export/route.ts` (guard swap)
- `app/api/cron/expire-submissions/route.ts` (drift check)
- `app/(admin)/layout.tsx` (pass `adminLevel`)
- `components/admin/admin-sidebar.tsx` (2 nav items, conditional)
- `components/sponsor/sponsor-form.tsx` (cap field disabled for reviewers)

## Tests

### Vitest — `lib/__tests__/admin-levels.test.ts` (security boundary, MANDATORY)

Follow the mocking style already used in `lib/__tests__/sponsor-application.test.ts`.

- `requireSuperAdmin()` throws `Forbidden` for `{ role:'admin', admin_level:'reviewer' }`.
- `requireSuperAdmin()` throws `Forbidden` for `{ role:'coach' }` and for `{ role:'sponsor' }`.
- `requireSuperAdmin()` resolves for `{ role:'admin', admin_level:'super_admin' }`.
- `requireAdmin()` still resolves for a reviewer — reviewers must not lose the queue.
- **`adminUpdateSponsor` called as a reviewer returns `{ error: 'Forbidden' }` and performs
  zero writes** (assert the update mock was never called). This is the named acceptance
  test: *a reviewer cannot edit a funding cap.*
- `approveSponsorApplication`, `deleteSponsor`, `adminToggleSponsorStatus`, and the export
  route all reject a reviewer.
- `approveSubmission` and `verifyCoach` **succeed** for a reviewer.
- `setAdminLevel` refuses self-demotion.
- `setAdminLevel` maps a `23514` error to the "at least one super admin" message.

### Vitest — `lib/__tests__/capacity-invariant.test.ts`

Pure-function coverage of the drift arithmetic and the cron branch:

- Given mocked `detect_capacity_drift` rows, `runCapacityAudit` writes exactly one
  `capacity_audit_run` audit row with the right `drift_count`.
- The cron route still returns `200 { expired: n }` when the drift RPC throws.
- The cron route writes `capacity_drift_detected` and calls `Sentry.captureException`
  when the RPC returns rows.

### `scripts/verify-capacity-invariant.mjs` (the real proof)

A psql/`postgres`-driven scenario script, run against a **local or scratch** database only
(refuse to run unless `SUPABASE_LOCAL` is set — mirror the gating in
`tests/global-setup.ts`). For each scenario: seed a sponsor with a known cap, drive the
state change, then assert `detect_capacity_drift()` returns **zero rows** and that
`funding_used_cents` equals the expected figure.

1. **Decline** — approve (reserve A), sponsor declines via the portal
   (`sponsor_decide_submission_atomic`). Expect `funding_used_cents` back to baseline.
2. **Partial fund** — approve (reserve A), settle at P < A. Expect baseline + P, one
   `transactions_ledger` row with `decision_type='partial'`, `amount_cents = P`.
3. **Expiry** — approve, backdate `expires_at` to the past, run
   `expire_overdue_submissions()`. Expect baseline, status `expired`,
   `reserved_amount_cents = 0`.
4. **Bounce** — approve, then `release_submission_reservation(id,'bounced','resend_bounce')`.
   Expect baseline.
5. **Coach-account-deletion cascade** — approve, then
   `DELETE FROM profiles WHERE id = <coach>`. Expect baseline plus one
   `release_reservation_on_delete` audit row (this exercises `trg_release_reservation_on_delete`).
6. **Double-settle via token after a portal settle** — settle in the portal, then call
   `record_sponsor_decision_atomic` with a live token. Expect `already_decided` and exactly
   one ledger row. *(This scenario fails before the fix in this migration and is the
   regression test for it.)*
7. **No double refund** — call `release_submission_reservation` twice. Second call returns
   `not_releasable`; `funding_used_cents` does not move.

Add an npm script `"verify:capacity": "node scripts/verify-capacity-invariant.mjs"`.

### Playwright — `tests/e2e/admin-levels.spec.ts`

- Signed in as a reviewer: `/moderation` renders; `/admin/team` shows the permission-denied
  card; the funding-cap input on `/sponsors/<id>/edit` is disabled.
- Signed in as a super admin: `/admin/team` renders the roster and the level control.

### RLS audit (MANDATORY, gate on it)

Run the **`rls-auditor`** agent against `profiles`, `sponsors`, and `sponsor_applications`
after the migration is applied. It must report zero `auth.uid()` references and confirm
that (a) reviewers cannot write `sponsors`, and (b) reviewers can still write
`profiles.coach_verified`. Paste its findings into your report.

## Acceptance criteria

- [ ] `psql -f supabase/migrations/0084_admin_levels_and_capacity_audit.sql` succeeds twice
      in a row (idempotent).
- [ ] Every pre-existing admin has `admin_level = 'super_admin'` after the migration.
- [ ] `UPDATE profiles SET admin_level='reviewer'` on the last remaining super admin fails
      with the "zero super admins" error, and the transaction rolls back.
- [ ] A transaction that promotes B to super_admin and demotes A in the same statement
      block **succeeds** (deferred trigger works).
- [ ] **A reviewer cannot edit a funding cap:** `adminUpdateSponsor` returns
      `{ error: 'Forbidden' }` and the sponsor row is byte-identical afterwards. Covered by
      a passing Vitest test and reproduced once in the browser.
- [ ] A reviewer can still approve, decline, and request changes on a submission, and can
      still verify and deny coaches.
- [ ] `GET /api/admin/export` returns `403 {"error":"Forbidden"}` (JSON, not a redirect)
      for a reviewer.
- [ ] `rls-auditor` passes on `profiles`, `sponsors`, `sponsor_applications` with zero
      `auth.uid()` hits — findings pasted in the report.
- [ ] `detect_capacity_drift()` returns zero rows on a clean seeded database.
- [ ] All seven scenarios in `scripts/verify-capacity-invariant.mjs` pass, with the real
      output pasted.
- [ ] The token path returns `already_decided` after a portal settle, and the access token
      is **not** consumed (`used_at` still NULL).
- [ ] The nightly cron writes `capacity_drift_detected` when drift exists and still returns
      `200` when the drift check itself fails.
- [ ] No line of `approve_submission_atomic`, `release_submission_reservation`,
      `expire_overdue_submissions`, `sponsor_decide_submission_atomic`, or
      `release_reservation_before_submission_delete` was changed. Prove it with
      `git diff --stat` on `supabase/migrations/`.
- [ ] `npm run typecheck && npm run lint && npm run build && npm run test` all green.

## Rollback

`vercel rollback` reverts code but not the database. To undo the migration:

```sql
BEGIN;
DROP TRIGGER IF EXISTS trg_assert_super_admin_floor ON profiles;
DROP FUNCTION IF EXISTS assert_super_admin_floor();
DROP FUNCTION IF EXISTS detect_capacity_drift();

-- Restore is_admin()-only policies (re-run the CREATE POLICY bodies from
-- 0051_clerk_auth.sql and the sponsors policy definitions they reference).
DROP POLICY IF EXISTS "sponsors_insert" ON sponsors;
DROP POLICY IF EXISTS "sponsors_update" ON sponsors;
DROP POLICY IF EXISTS "sponsors_delete" ON sponsors;
CREATE POLICY "sponsors_insert" ON sponsors FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "sponsors_update" ON sponsors FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "sponsors_delete" ON sponsors FOR DELETE USING (is_admin());
-- …and the equivalent for sponsor_applications.

-- Restore prevent_role_elevation() verbatim from 0051_clerk_auth.sql:66-81.

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_admin_level_requires_admin;
DROP INDEX IF EXISTS idx_profiles_admin_level;
ALTER TABLE profiles DROP COLUMN IF EXISTS admin_level;
DROP TYPE IF EXISTS admin_level;
DROP FUNCTION IF EXISTS is_super_admin();
COMMIT;
```

`record_sponsor_decision_atomic` is **not** rolled back — the `already_decided` guard is a
strict safety improvement with no dependency on `admin_level`. If you must, re-apply
`0071_token_decision_check_status_first.sql`.

Dropping `admin_level` restores the old behaviour where every admin can do everything, so
roll the code back first or every admin action starts failing `requireSuperAdmin()`.

## Commit

```
feat(admin): split reviewer vs super-admin capabilities and prove the capacity invariant

Adds profiles.admin_level (reviewer | super_admin), is_super_admin(), and a
deferred constraint trigger guaranteeing at least one super admin survives any
transaction. Funding caps, sponsor applications, exports, and admin provisioning
now require super admin; the moderation queue and coach verification stay open to
reviewers.

Adds detect_capacity_drift() plus a nightly cron check and an admin page, and a
seven-scenario script proving funding_used_cents = open reservations + ledger
across decline, partial fund, expiry, bounce, and account-deletion cascade. The
existing release RPCs are unchanged. Closes the token path's missing
already_decided ledger check so it matches the portal path.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```
