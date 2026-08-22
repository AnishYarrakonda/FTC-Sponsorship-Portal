# Prompt 08 — Sponsor Organizations (multi-user sponsor accounts)

> **Prerequisites:** None
> **Reserved migration:** `0082_sponsor_organizations.sql` — verify it is still free with `ls supabase/migrations | tail -3`
> **Scope:** large · ~16 files
> **Leaves the repo:** green and shippable on its own

## Why this exists

A sponsor company on this platform is exactly one person. The CSR coordinator who applied owns
the login, the inbox, the funding page and the decision buttons — and when she is on leave, the
company's pitches expire silently. Every corporate buyer asks the same three questions in
procurement: "can my colleague see this too", "what happens when she leaves", and "who
approved that". Right now the answers are no, you lose the account, and nobody knows.

## Current state (verified)

### A sponsor company is one profile row, linked in exactly one place

`profiles.sponsor_id uuid REFERENCES sponsors(id) ON DELETE SET NULL` was added in
`0030_sponsor_portal_foundations.sql:14` and indexed in `0043:15-16`.

**It is written in exactly one place in the entire application:**
`approveSponsorApplication` in `app/actions/admin.ts:360-386`. That block lowercases the
application's `contact_email`, then finds **one** profile:

```
.eq('email', contactEmail).eq('role','sponsor').is('sponsor_id', null)
.order('created_at', { ascending: true }).limit(1).maybeSingle()
```

— the oldest unlinked sponsor profile with that address — and sets its `sponsor_id`. The
`.limit(1)` and the `.is('sponsor_id', null)` are both deliberate bug fixes documented inline
(`admin.ts:350-359`): without them every profile sharing the address was linked to the company
at once. When no profile matches, the action returns `{ success: true, warning }` and the
company exists with nobody able to sign in (`admin.ts:410-418`).

`profiles.sponsor_id` is otherwise **immutable by the user**: `prevent_role_elevation()`
(`0073_profile_identity_pin_and_active_submission.sql:55-85`) raises
`sponsor_id modification not permitted` on any change unless `is_admin()` — with an early
`IF is_trusted_server_context() THEN RETURN NEW` at line 60, so **service-role writes are
exempt**. Every write you add in this slice must go through the admin client for that reason.

### Everything that resolves "which sponsor is this caller"

This is the exhaustive list. Verify each against the file before you touch it.

**RLS policies — all four inline the same `EXISTS (SELECT 1 FROM profiles …)` sublink:**

| Policy | Defined at | Predicate |
|---|---|---|
| `sponsors_select_own` | `0051_clerk_auth.sql:188-197` | `profiles.id = current_profile_id() AND role='sponsor' AND profiles.sponsor_id = sponsors.id` |
| `submissions_select_sponsor` | `0064_submissions_policy_hardening.sql:55-66` (latest) | `deleted_at IS NULL AND sent_at IS NOT NULL AND … profiles.sponsor_id = submissions.sponsor_id` |
| `submissions_update_sponsor` | `0051_clerk_auth.sql:245-263` (latest) | same sublink in **both** `USING` and `WITH CHECK` |
| `ledger_select_sponsor` | `0069_ledger_sponsor_and_coach_read.sql:21-32` | `p.sponsor_id IS NOT NULL AND p.sponsor_id = transactions_ledger.sponsor_id` |

**SECURITY DEFINER function:**

- `sponsor_can_view_team(p_team_id uuid)` — `0066_teams_private_no_public_pages.sql:95-110`.
  Body joins `profiles p ON p.id = current_profile_id()` and requires
  `p.role='sponsor' AND p.sponsor_id IS NOT NULL AND s.sponsor_id = p.sponsor_id AND
  s.sent_at IS NOT NULL AND s.deleted_at IS NULL`.
  It is consumed by **`teams_select_sponsor`** (`0066:120-122`) and the sponsor branch of
  **`achievements_select`** (`0066:134-146`). Both call the function and contain no
  `profiles.sponsor_id` reference of their own — **fixing the function fixes both policies,
  and neither policy may be rewritten inline.** See the 42P17 note below.

**View — `v_sponsors_public`, `0063_sponsors_coach_exposure.sql:68-112`:**

Re-read it before deciding anything. It is a `security_invoker = false` (SECURITY DEFINER)
view whose three branches are `is_admin()`, `is_coach_verified() + geo/capacity`, and
"a sponsor this coach already pitched". **It does not reference `profiles.sponsor_id` at all
and has no sponsor-facing branch** — sponsors read their own company through
`sponsors_select_own` on the base table, not through this view. Confirm that yourself, then
leave the view unchanged and say so in your report. Do not invent a change to it.

**RPCs (the money path) — leave alone in this slice:**

- `sponsor_decide_submission_atomic` — latest body in
  `0065_fix_sponsor_decide_double_debit.sql:71-200`. Resolves the actor at `:101-108`
  (`SELECT * INTO v_profile FROM profiles WHERE id = v_actor_id;` then
  `v_profile.role <> 'sponsor' OR v_profile.sponsor_id IS NULL` → `unauthorized`, then
  `v_submission.sponsor_id <> v_profile.sponsor_id` → `unauthorized`) and debits
  `sponsors WHERE id = v_profile.sponsor_id`.
- `record_sponsor_decision_atomic` (`0071`) — the tokenized path; resolves through the token,
  not through `profiles`.

Both keep working unchanged under this slice's design (see "The hard part"). **Prompt 09 owns
the decision workflow. Do not touch capacity code here.**

**Application layer:**

- `requireSponsor()` — `lib/actions-utils.ts:114-126`. Throws `Forbidden` unless
  `user.role === 'sponsor' && user.sponsor_id`, and returns a single
  `sponsorId: user.sponsor_id`.
- `app/(sponsor)/layout.tsx:169-179` — renders the "Awaiting verification" card whenever
  `!profile.sponsor_id`, and scopes the sidebar badge with
  `.eq('sponsor_id', profile.sponsor_id)`.
- Other readers of `sponsor_id` (all keep working via the primary-org pointer, none need
  changing here): `app/(sponsor)/sponsor/{dashboard,funding,submissions}/…`,
  `app/actions/{moderation,submission,sponsor-decision}.ts`, `lib/dispatch.ts`,
  `lib/notify.ts`, `app/api/admin/export/route.ts`, `app/sponsor-view/[token]/page.tsx`,
  `components/sponsor/dashboard-shell.tsx`.

**Clerk:** `@clerk/nextjs ^7.5.7` is already a dependency (`package.json:18`). No
Organizations feature is used anywhere today — `grep -r "organization" app lib components`
returns nothing relevant. The webhook at `app/api/webhooks/clerk/route.ts` handles
`user.created` (explicit no-op), `user.deleted` (storage purge then profile delete),
`user.updated` and `email.created` (email sync via `syncProfileEmail`), with a
`default:` arm that 200s unhandled events.

### What is missing

There is no concept of a second person at a sponsor company: no membership table, no
invitation, no roles, no offboarding. Losing access is a support ticket.

## What you are building

1. **`sponsor_members`** — the Postgres mirror of Clerk Organization membership, so RLS can
   key off it.
2. **`sponsors.clerk_org_id text UNIQUE`** — one Clerk org ↔ one `sponsors` row.
3. **A Clerk Organization created at sponsor-application approval**, with the applicant seeded
   as its `org_admin`.
4. **An invitation flow** built on Clerk organization invitations, plus an in-app member
   management page at `/sponsor/members`.
5. **Webhook sync** — extend `app/api/webhooks/clerk/route.ts` with
   `organizationMembership.created` / `.updated` / `.deleted`.
6. **`current_sponsor_ids()`** and the rewrite of every policy and function listed above.
7. **`requireSponsor()` returning both a primary `sponsorId` and a `sponsorIds` array**, plus
   the caller's membership role.

## The hard part — the migration path, stated explicitly

Every existing policy, function and RPC resolves a sponsor through `profiles.sponsor_id`.
Ripping that out in one migration would break the money path. The design is therefore:

**`profiles.sponsor_id` STAYS, and becomes the denormalized "primary org" pointer.**

- Every `sponsor_members` row insert also writes `profiles.sponsor_id` for that member when it
  is currently `NULL`, through the **admin client** (service role, exempt from
  `prevent_role_elevation`).
- Consequence: `sponsor_decide_submission_atomic`, `lib/dispatch.ts`, the sponsor pages, and
  every reader listed above keep working with **zero changes** for every member of an org.
- **One org per profile is enforced at the application layer in this slice.** The schema's
  `UNIQUE (sponsor_id, profile_id)` permits multi-org rows, and `current_sponsor_ids()`
  returns an array so the future is open — but the webhook and the invite action **refuse** a
  second membership for a profile that already has one, log it, and notify an admin. An org
  switcher is out of scope. This keeps the primary-org pointer unambiguous, which is the only
  reason the untouched RPCs stay correct.
- `current_sponsor_ids()` **UNIONs `sponsor_members` with `profiles.sponsor_id`**, so a sponsor
  linked the old way — every sponsor that exists today — keeps full access with no backfill,
  and a backfill failure cannot lock anyone out.

### Policies and functions that must switch to `current_sponsor_ids()`

| # | Object | Action |
|---|---|---|
| 1 | `sponsors_select_own` | `DROP`/`CREATE` → `USING (sponsors.id = ANY(current_sponsor_ids()))` |
| 2 | `submissions_select_sponsor` | `DROP`/`CREATE` → `USING (deleted_at IS NULL AND sent_at IS NOT NULL AND submissions.sponsor_id = ANY(current_sponsor_ids()))`. **The `sent_at IS NOT NULL` admin-gate marker from `0064` must survive verbatim** — dropping it re-opens P0-2. |
| 3 | `submissions_update_sponsor` | `DROP`/`CREATE` → `USING (deleted_at IS NULL AND submissions.sponsor_id = ANY(current_sponsor_ids()))`, `WITH CHECK (submissions.sponsor_id = ANY(current_sponsor_ids()))` |
| 4 | `ledger_select_sponsor` | `DROP`/`CREATE` → `USING (transactions_ledger.sponsor_id = ANY(current_sponsor_ids()))`. Leave `ledger_select_coach` and `ledger_select_admin` alone. |
| 5 | `sponsor_can_view_team(uuid)` | `CREATE OR REPLACE` the body → `s.sponsor_id = ANY(current_sponsor_ids())`, keeping `s.sent_at IS NOT NULL AND s.deleted_at IS NULL`, `SECURITY DEFINER STABLE SET search_path = public`, and the existing `GRANT EXECUTE … TO authenticated, service_role`. |
| 6 | `teams_select_sponsor` (`0066:120-122`) | **No change.** It calls the function. Re-writing it inline is a 42P17 outage — see Guardrails. |
| 7 | `achievements_select` (`0066:134-146`) | **No change**, same reason. |
| 8 | `v_sponsors_public` (`0063:68-112`) | **No change.** Verify it has no `profiles.sponsor_id` reference and state that in your report. |
| 9 | `sponsor_decide_submission_atomic` (`0065`), `record_sponsor_decision_atomic` (`0071`), `approve_submission_atomic` (`0047`/`0062`) | **No change.** Prompt 09. |
| 10 | `requireSponsor()` (`lib/actions-utils.ts:114-126`) | Extended, backward-compatibly — `sponsorId` keeps its exact current meaning. |

## Data model

```sql
-- ── 1. One Clerk org ↔ one sponsors row ──────────────────────────────────────
ALTER TABLE sponsors ADD COLUMN IF NOT EXISTS clerk_org_id text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sponsors_clerk_org_id_key') THEN
    ALTER TABLE sponsors ADD CONSTRAINT sponsors_clerk_org_id_key UNIQUE (clerk_org_id);
  END IF;
END $$;   -- ADD CONSTRAINT has no IF NOT EXISTS; this DO block is the idempotent form.

-- ── 2. sponsor_members ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sponsor_members (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_id          uuid NOT NULL REFERENCES sponsors(id) ON DELETE CASCADE,
  profile_id          uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  clerk_org_id        text NOT NULL,
  clerk_membership_id text UNIQUE,          -- NULL while an invitation is outstanding
  role                text NOT NULL DEFAULT 'member'
                        CHECK (role IN ('member', 'org_admin')),
  invited_by          uuid REFERENCES profiles(id) ON DELETE SET NULL,
  invited_at          timestamptz,
  joined_at           timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sponsor_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_sponsor_members_profile ON sponsor_members (profile_id);
CREATE INDEX IF NOT EXISTS idx_sponsor_members_sponsor ON sponsor_members (sponsor_id);
CREATE INDEX IF NOT EXISTS idx_sponsor_members_org     ON sponsor_members (clerk_org_id);

ALTER TABLE sponsor_members ENABLE ROW LEVEL SECURITY;
```

Reuse the existing `updated_at` trigger idiom (`set_updated_at_*`, first defined in `0008`) —
`CREATE OR REPLACE` a `set_updated_at_sponsor_members` trigger rather than inventing a new
mechanism.

**Prompt 09 note (do not implement here):** `0083` widens the `role` CHECK to
`('viewer','submitter','approver','org_admin')` and remaps `member` → `submitter`. Keep the
two-value set in `0082` so this slice only enforces what it actually implements.

### RLS policies on `sponsor_members`

- `sponsor_members_select_admin` — `FOR SELECT USING (is_admin())`.
- `sponsor_members_select_own_org` — `FOR SELECT USING (profile_id = current_profile_id()
  OR sponsor_id = ANY(current_sponsor_ids()))`. A member sees their whole org's roster; that
  is the point of the members page. **The predicate must be the function call, never an inline
  `EXISTS (SELECT 1 FROM sponsor_members …)`** — that is self-referential policy recursion.
- **No INSERT / UPDATE / DELETE policies.** RLS denies by default, so the table is
  service-role-write-only, exactly like `audit_log` and `transactions_ledger`. Membership must
  never be self-writable: an INSERT policy here is a one-line path to joining another
  company's org.

### Helper functions

```sql
CREATE OR REPLACE FUNCTION current_sponsor_ids()
RETURNS uuid[]
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT sid), '{}'::uuid[])
    FROM (
      -- new path
      SELECT m.sponsor_id AS sid
        FROM sponsor_members m
       WHERE m.profile_id = current_profile_id()
      UNION
      -- legacy path: every sponsor that exists today, and the belt-and-braces
      -- fallback if the membership row is missing or the webhook lagged.
      SELECT p.sponsor_id
        FROM profiles p
       WHERE p.id = current_profile_id()
         AND p.sponsor_id IS NOT NULL
    ) s
   WHERE sid IS NOT NULL
     -- Role gate: a coach or admin who somehow acquires a membership row must not
     -- inherit sponsor reads. Role stays authoritative in profiles.role.
     AND EXISTS (SELECT 1 FROM profiles p2
                  WHERE p2.id = current_profile_id() AND p2.role = 'sponsor');
$$;

CREATE OR REPLACE FUNCTION is_sponsor_org_member(p_sponsor_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$ SELECT p_sponsor_id = ANY(current_sponsor_ids()); $$;
```

**Grants — read this, it contradicts the naive rule.** `_CONTEXT.md` §8.4 says to revoke
SECURITY DEFINER execute from `authenticated`. That rule applies to **RPCs invoked over
PostgREST**. These two are called from inside RLS policy quals, which evaluate **as the
querying role** — revoking from `authenticated` makes every sponsor read fail `42501`. This is
the exact hazard `0062` warns about and the reason `sponsor_can_view_team` is granted to
`authenticated` (`0066:118`). Mirror that treatment precisely, and write the comment
explaining why:

```sql
REVOKE ALL ON FUNCTION current_sponsor_ids()          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION is_sponsor_org_member(uuid)    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION current_sponsor_ids()       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION is_sponsor_org_member(uuid) TO authenticated, service_role;
```

### Types

`lib/supabase/types.ts` is **hand-maintained** (no codegen script in `package.json`). Add
`sponsors.clerk_org_id` and the full `sponsor_members` Row/Insert/Update/Relationships block by
hand or `npm run typecheck` fails.

## Server actions

New file `app/actions/sponsor-members.ts`. New schema file
`lib/schemas/sponsor-members.ts` (lengths from `lib/schemas/limits.ts`, never hardcoded).
All follow the canonical 5-step shape (`_CONTEXT.md` §7); always `safeParse`.

| Action | Guard | Schema | `audit_log` action | Notification |
|---|---|---|---|---|
| `inviteSponsorMember({ email, role })` | `requireSponsor()` then **`membership.role === 'org_admin'`** → else `return { error: 'Forbidden' }` | `inviteSponsorMemberSchema`: `email z.string().trim().toLowerCase().email()`, `role z.enum(['member','org_admin'])` | `invite_sponsor_member`, `entity_type: 'sponsor_members'`, metadata `{ sponsor_id, email, role }` | Clerk sends the invitation email (see below). Also `createInAppNotification` to the inviter confirming it went out. |
| `updateSponsorMemberRole({ memberId, role })` | same | `updateSponsorMemberRoleSchema` | `update_sponsor_member_role`, metadata `{ from, to }` | `createInAppNotification` to the affected member, `type:'general'` |
| `removeSponsorMember({ memberId })` | same | `removeSponsorMemberSchema` (uuid) | `remove_sponsor_member` | `createInAppNotification` to the removed member |
| `listSponsorMembers()` | `requireSponsor()` (any member) | none | none (read) | none |

Rules every one of them must obey:

- **Re-derive the org server-side.** The target `sponsor_id` comes from
  `requireSponsor()`, never from the client. A `memberId` argument must be re-checked with
  `.eq('sponsor_id', sponsorId)` before any mutation, or one org's admin can edit another's
  roster.
- **Never remove or demote the last `org_admin`.** Count first; return
  `{ error: 'An organization must keep at least one admin.' }`.
- **Refuse a cross-role invite.** If the invited email already has a `profiles` row whose
  `role` is not `sponsor`, refuse with a clear message. Silently flipping a coach to a sponsor
  is the P0-13 hazard documented in `middleware.ts:20-28`.
- **Refuse a second org.** If the invitee already has a `sponsor_members` row for a different
  `sponsor_id`, refuse and say why.
- Writes to `sponsor_members` and to `profiles.sponsor_id` go through the **admin client**
  (`adminClient` from the guard). The table has no write policy and
  `prevent_role_elevation` blocks non-service `sponsor_id` changes.
- Clerk calls go through `await clerkClient()` from `@clerk/nextjs/server` — the same import
  `app/actions/auth.ts:3` already uses. Wrap each in `try/catch` and return
  `{ error }`; a Clerk failure must not leave a half-written `sponsor_members` row, so call
  Clerk **first**, then mirror into Postgres.

**Modify `approveSponsorApplication`** (`app/actions/admin.ts:270-421`): after the sponsor row
is inserted and the applicant profile linked, create the Clerk organization
(`clerk.organizations.createOrganization({ name: app.company_name, createdBy: <applicant Clerk
user id> })`), write `sponsors.clerk_org_id`, and insert the applicant's `sponsor_members` row
with `role='org_admin'`, `joined_at = now()`, `clerk_membership_id` from the Clerk response.

**Org creation must not be able to un-approve an approved sponsor.** The action already uses a
claim-first idempotency pattern with a documented rollback on insert failure
(`admin.ts:294-343`). Do **not** extend that rollback to Clerk failures. If the org cannot be
created, keep the approval, leave `clerk_org_id` NULL, log to Sentry, and add to the returned
`warning` — the sponsor still works, because `current_sponsor_ids()` falls back to
`profiles.sponsor_id`. Add an admin-only "Create organization" retry button on the sponsors
page for that case.

### Webhook — extend, do not replace

In `app/api/webhooks/clerk/route.ts`, add three cases **before** the existing `default:` arm.
Match the file's established error contract exactly: on a database failure
`return NextResponse.json({...}, { status: 500 })` so Svix redelivers. The comments at
`route.ts:60-66` and `:127-131` explain why swallowing here is a permanent, invisible data
loss (P0-12). Do not repeat that mistake.

- **`organizationMembership.created`** — resolve `evt.data.public_user_data.user_id` →
  `profiles` by `clerk_user_id`; resolve `evt.data.organization.id` → `sponsors` by
  `clerk_org_id`. Then:
  - profile not found → **200 with `skipped`**, not 500. The user accepted the invite before
    finishing profile creation; a retry storm helps nobody. Record it in `audit_log`
    (`action: 'sponsor_member_sync_deferred'`) so it is visible.
  - sponsor not found → 500 (a real inconsistency worth retrying).
  - profile has `role <> 'sponsor'` → **refuse**: no membership row, `audit_log` action
    `sponsor_member_sync_rejected`, `createInAppNotification` to admins. Return 200.
  - profile already a member of a **different** sponsor → same refusal path.
  - otherwise `upsert` on `clerk_membership_id`, mapping Clerk's `org:admin` role to
    `org_admin` and anything else to `member`; set `joined_at`; and set
    `profiles.sponsor_id` when it is currently NULL.
- **`organizationMembership.updated`** — update `role` on the matching
  `clerk_membership_id`. Missing row → upsert (Clerk is the source of truth for membership).
- **`organizationMembership.deleted`** — delete the `sponsor_members` row **and** null
  `profiles.sponsor_id` when it pointed at that sponsor and no other membership remains. This
  is offboarding: skipping the `profiles.sponsor_id` clear leaves a removed employee with full
  portal access through the legacy branch of `current_sponsor_ids()`. Write an `audit_log`
  row (`remove_sponsor_member_webhook`).

Enable the three `organizationMembership.*` events on the existing Clerk webhook endpoint in
the Clerk dashboard — **dashboard configuration, not code.** Also enable **Organizations** for
the Clerk instance. Call both out in your report; the deploy is not done until they are on.
No new environment variable is required: `CLERK_WEBHOOK_SIGNING_SECRET` and `CLERK_SECRET_KEY`
already exist in `lib/env.ts:12-14`.

**Invitation emails are sent by Clerk, not Resend.** That is consistent with
`.claude/rules/auth-supabase.md` ("email verification, password reset … are owned by Clerk")
and does **not** touch the Admin-Gatekept Outreach mandate, which governs *pitch dispatch to
sponsors* via `lib/dispatch.ts` only. Do not build a Resend template for invitations.

### `requireSponsor()` — backward-compatible extension

```ts
export async function requireSponsor(): Promise<{
  supabase; user; clerkUserId
  sponsorId: string            // primary org — UNCHANGED meaning, all ~15 callers keep working
  sponsorIds: string[]         // new
  membership: { id: string; role: 'member' | 'org_admin' } | null   // new
  adminClient
}>
```

- Resolve `sponsorIds` by reading `sponsor_members` for `user.id` through the **server** client
  (RLS-respecting) and unioning `user.sponsor_id`.
- `sponsorId` = `user.sponsor_id ?? sponsorIds[0]`. Admitting a caller whose
  `profiles.sponsor_id` is momentarily NULL but who holds a membership row closes the
  webhook-lag window; today they would hit the "Awaiting verification" card forever.
- Still `throw new Error('Forbidden')` when `user.role !== 'sponsor'` or no sponsor resolves.
- The three preview short-circuits at the top of `requireAuth()` (`lib/actions-utils.ts:55-57`)
  must keep working: give the sponsor fixture in `lib/dev-preview.ts` a membership so
  `npm run dev:sponsor-preview` still renders.

## UI

**New route `app/(sponsor)/sponsor/members/page.tsx`** + `components/sponsor/members-panel.tsx`:

- Table of members: name, email, role badge, joined date, pending-invite state.
- "Invite teammate" dialog (email + role) — rendered **only** when
  `membership.role === 'org_admin'`; the action re-checks regardless.
- Row actions: change role, remove. Both disabled on the last `org_admin`, with a tooltip
  saying why.
- **Empty** — "You are the only member of {company}. Invite a teammate to share this inbox."
- **Loading** — a `loading.tsx` skeleton matching `app/(sponsor)/loading.tsx`.
- **Error** — the existing `app/(sponsor)/error.tsx` boundary covers the route; surface action
  errors as inline destructive text, never a toast that vanishes.
- **Permission denied** — a non-`org_admin` sees the roster read-only with an explanatory line,
  not a blank page or a redirect.

**`components/sponsor/sponsor-sidebar.tsx`** — add `{ label: 'Team', href: '/sponsor/members',
icon: Users }` to the `NAV` array at lines 27-30, above the Settings footer link at line 70.

**`app/(sponsor)/layout.tsx`** — the "Awaiting verification" gate at line 169 checks
`!profile.sponsor_id`. Change it to also admit a caller with a membership row, or an invited
teammate whose `profiles.sponsor_id` has not yet been stamped sees the awaiting card.

**`lib/dev-preview.ts`** — add a `sponsor_members` fixture (two members, one `org_admin`) to
`createMockSupabaseClient()` and extend `mockProfile`, so `npm run dev:sponsor-preview` renders
the new page. `lib/dev-bypass.ts` needs the same for the admin view of a sponsor.

## Out of scope

- **Granular permissions and the approver workflow — prompt 09.** `role` here gates member
  management only. A `member` retains every sponsor capability they have today, including
  funding decisions.
- **SSO / SAML — prompt 10.**
- Multi-org membership / an org switcher. The schema allows it; the application refuses it.
- Changing `sponsor_decide_submission_atomic`, `record_sponsor_decision_atomic`,
  `approve_submission_atomic`, or anything else in the capacity path.
- Backfilling `sponsor_members` for existing sponsors. `current_sponsor_ids()` unions
  `profiles.sponsor_id`, so no backfill is needed. If you want one, it is a separate migration.
- Clerk's hosted `<OrganizationProfile />` component. Build the members page from the existing
  shadcn primitives so it matches the portal.

## Guardrails specific to this slice

- **42P17 — the single most dangerous trap here.** `0066:75-94` documents it in full: a
  sublink written *inline in a policy on `teams`* closes a `teams → submissions → teams` policy
  cycle and **every read of either table fails**, for coaches and admins too, taking down the
  coach dashboard, the moderation queue, the sponsor portal and the funding page
  simultaneously. Policy quals are expanded at rewrite time for every permissive policy on the
  command, regardless of the querying role; function calls are opaque to the rewriter, which is
  exactly why the predicate lives in `sponsor_can_view_team()`. **Change the function body.
  Never inline it into `teams_select_sponsor` or `achievements_select`.** Run the cycle check
  at `0066:158-160` after applying.
- **Never `auth.uid()`** — it is NULL under Clerk. Use `current_profile_id()` / `is_admin()` /
  `is_coach_verified()` / `is_trusted_server_context()`.
- **Do not revoke the two new helpers from `authenticated`** — see the Grants note. They are
  policy helpers, not RPCs.
- **`sent_at IS NOT NULL` must survive** in `submissions_select_sponsor`. It is the
  admin-gatekept-outreach marker (`0064:56-66`), written only by `approve_submission_atomic`.
  Losing it lets a sponsor read pitches that never cleared moderation — a Core Mandate breach.
- **`prevent_role_elevation` (`0073:55-85`) blocks `profiles.sponsor_id` writes** for anything
  that is not the service role or an admin. Every membership write path uses the admin client.
  If a write mysteriously raises `sponsor_id modification not permitted`, you used the wrong
  client.
- **The webhook must 500 on real failures.** `route.ts:60-66` and `:127-131` document why a
  200 on failure is permanent, silent data loss — Svix never retries a 2xx.
- **No INSERT/UPDATE/DELETE policy on `sponsor_members`.** Ever.
- **Cross-org isolation is the whole point.** Every action that takes a `memberId` must filter
  by the caller's `sponsor_id` server-side.
- **Capacity integrity:** nothing in this slice may change how money is reserved or settled. If
  a change appears to require it, stop — that is prompt 09.
- Migration `0082` contains `$$`-quoted blocks (the `DO` block and the two functions) — it
  **must** be applied with `psql -f`, not the Supabase CLI (`_CONTEXT.md` §8.2).

## Files you will touch

**Create:**
- `supabase/migrations/0082_sponsor_organizations.sql`
- `app/actions/sponsor-members.ts`
- `lib/schemas/sponsor-members.ts`
- `app/(sponsor)/sponsor/members/page.tsx`
- `app/(sponsor)/sponsor/members/loading.tsx`
- `components/sponsor/members-panel.tsx`
- `lib/__tests__/sponsor-members-schema.test.ts`
- `tests/e2e/sponsor-organizations.spec.ts`

**Modify:**
- `lib/actions-utils.ts`
- `app/actions/admin.ts` (`approveSponsorApplication`)
- `app/api/webhooks/clerk/route.ts`
- `app/(sponsor)/layout.tsx`
- `components/sponsor/sponsor-sidebar.tsx`
- `lib/supabase/types.ts`
- `lib/dev-preview.ts`, `lib/dev-bypass.ts`
- `scripts/seed-test-accounts.mjs` (seed a second member of the test sponsor org)

## Tests

**Vitest — `lib/__tests__/sponsor-members-schema.test.ts`:** email normalization
(trim + lowercase), role enum rejection, uuid validation, and that every schema is used with
`safeParse` in the action (grep-style assertion or a direct import test, matching the style of
`lib/__tests__/sponsor-application.test.ts`).

**Playwright — `tests/e2e/sponsor-organizations.spec.ts`:** org admin invites a teammate and
the row appears as pending; the last `org_admin` cannot be removed or demoted; a non-admin
member sees the roster read-only with no invite button.

**Security-boundary tests — MANDATORY, and they must run at the database layer, not only
through the actions.** Use the two seeded sponsor orgs (extend
`scripts/seed-test-accounts.mjs` to create a second sponsor company with its own member) and
issue raw PostgREST reads with each user's Clerk token, the way `tests/global-setup.ts`
establishes sessions:

1. **No sponsor can read another sponsor's data.** As Sponsor A's member, assert **0 rows** for
   every one of: `GET /rest/v1/sponsors?id=eq.<B>`,
   `GET /rest/v1/submissions?sponsor_id=eq.<B>`,
   `GET /rest/v1/transactions_ledger?sponsor_id=eq.<B>`,
   `GET /rest/v1/sponsor_members?sponsor_id=eq.<B>`, and `GET /rest/v1/teams` returning any
   team whose only submission is to B.
2. **Second member of Org A gets exactly the same access as the first** — same row counts on
   `sponsors`, `submissions`, `transactions_ledger`.
3. **Removed member loses access immediately**: delete the `sponsor_members` row and null
   `profiles.sponsor_id`, then re-issue the reads → 0 rows. This asserts that
   `current_sponsor_ids()`'s legacy branch does not leave a back door open.
4. **`sponsor_members` is not writable by a member**: `POST` / `PATCH` / `DELETE` on
   `/rest/v1/sponsor_members` as an authenticated sponsor → denied.
5. **A coach and an unauthenticated (anon-key) caller each read 0 rows** from
   `sponsor_members`.
6. **Wrong role blocked at the action layer**: `inviteSponsorMember` called as a coach → error;
   called as a non-`org_admin` sponsor → `Forbidden`; called with another org's `memberId` →
   error and the row is unchanged in the database afterwards.
7. **`current_sponsor_ids()` role gate**: manually insert a `sponsor_members` row for a
   **coach** profile via the admin client, then read `sponsors` as that coach → still 0 rows.
8. **42P17 regression**: run the cycle check from `0066:158-160` — `SET ROLE authenticated`
   with a sponsor's claims, then `SELECT` from `teams`, `submissions`, `team_achievements` and
   `transactions_ledger` in one session. Any `42P17` is a hard fail.

**`rls-auditor` agent pass is mandatory** before this slice can be called done. Run it over
`sponsors`, `submissions`, `transactions_ledger`, `teams`, `team_achievements` and
`sponsor_members`, and paste its output. Zero `auth.uid()` findings, zero policies still
resolving a sponsor through an inline `profiles.sponsor_id` sublink except the intentional
legacy branch inside `current_sponsor_ids()`.

## Acceptance criteria

- [ ] `psql -f supabase/migrations/0082_sponsor_organizations.sql` succeeds, and succeeds again
      on a second run.
- [ ] `npm run typecheck && npm run lint && npm run build && npm run test` pass; real output
      pasted.
- [ ] **`rls-auditor` agent pass completed with its output pasted, and no findings.**
- [ ] **No sponsor can read another sponsor's data** — all of test group 1 returns 0 rows,
      verified against the real database, not through the action layer.
- [ ] Approving a sponsor application creates a Clerk organization, stamps
      `sponsors.clerk_org_id`, and inserts one `sponsor_members` row with `role='org_admin'`.
      Verified by reading both rows.
- [ ] Inviting a teammate produces a Clerk invitation; accepting it fires
      `organizationMembership.created`, and a `sponsor_members` row plus a stamped
      `profiles.sponsor_id` appear. Verified end to end, not by reading the handler.
- [ ] The second member signs in and sees the **same** pitches, funding page and inbox as the
      first, with no code path returning "Awaiting verification".
- [ ] Removing a member fires `organizationMembership.deleted`, deletes the row, nulls
      `profiles.sponsor_id`, and the removed user's next request to `/sponsor/dashboard` no
      longer shows the company's data.
- [ ] An **existing** sponsor with **no** `sponsor_members` row (the legacy shape — create one
      by deleting the membership row and leaving `profiles.sponsor_id` set) retains full
      access. This proves the legacy branch of `current_sponsor_ids()` works and no backfill
      is required.
- [ ] Inviting an email that already belongs to a **coach** is refused with a clear message and
      no `profiles.role` is modified.
- [ ] The last `org_admin` cannot be removed or demoted, blocked by the **server action**, not
      only the UI.
- [ ] Cycle check (`0066:158-160`) passes — no `42P17` on `teams`, `submissions`,
      `team_achievements` or `transactions_ledger`.
- [ ] `sponsor_decide_submission_atomic` still succeeds for a sponsor member end to end
      (fund one pitch in the seeded data), proving the money path is untouched.
- [ ] `npm run dev:sponsor-preview` renders `/sponsor/members` against fixtures.
- [ ] Clerk dashboard: Organizations enabled, and `organizationMembership.created/updated/
      deleted` subscribed on the existing webhook endpoint. Screenshot or explicit confirmation
      in the report.

## Rollback

`vercel rollback` reverts the deployment but not the database. To revert `0082`, restore the
`profiles.sponsor_id` predicates exactly as they were and then drop the new objects — **in
this order**, or reads break between statements:

```sql
-- 1. Restore the four policies to the profiles.sponsor_id path (0051 / 0064 / 0069 text).
DROP POLICY IF EXISTS "sponsors_select_own" ON sponsors;
CREATE POLICY "sponsors_select_own" ON sponsors FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles
                  WHERE profiles.id = current_profile_id()
                    AND profiles.role = 'sponsor'
                    AND profiles.sponsor_id = sponsors.id));

DROP POLICY IF EXISTS "submissions_select_sponsor" ON submissions;
CREATE POLICY "submissions_select_sponsor" ON submissions FOR SELECT
  USING (deleted_at IS NULL AND sent_at IS NOT NULL
     AND EXISTS (SELECT 1 FROM profiles
                  WHERE profiles.id = current_profile_id()
                    AND profiles.role = 'sponsor'
                    AND profiles.sponsor_id = submissions.sponsor_id));

DROP POLICY IF EXISTS "submissions_update_sponsor" ON submissions;
CREATE POLICY "submissions_update_sponsor" ON submissions FOR UPDATE
  USING (deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM profiles
                  WHERE profiles.id = current_profile_id()
                    AND profiles.role = 'sponsor'
                    AND profiles.sponsor_id = submissions.sponsor_id))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles
                       WHERE profiles.id = current_profile_id()
                         AND profiles.role = 'sponsor'
                         AND profiles.sponsor_id = submissions.sponsor_id));

DROP POLICY IF EXISTS "ledger_select_sponsor" ON transactions_ledger;
CREATE POLICY "ledger_select_sponsor" ON transactions_ledger FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles p
                  WHERE p.id = current_profile_id()
                    AND p.role = 'sponsor'
                    AND p.sponsor_id IS NOT NULL
                    AND p.sponsor_id = transactions_ledger.sponsor_id));

-- 2. Restore sponsor_can_view_team's body verbatim from 0066:95-110, then re-grant:
--    GRANT EXECUTE ON FUNCTION sponsor_can_view_team(uuid) TO authenticated, service_role;

-- 3. Only now drop the new objects.
DROP TABLE IF EXISTS sponsor_members;              -- policies and indexes go with it
DROP FUNCTION IF EXISTS is_sponsor_org_member(uuid);
DROP FUNCTION IF EXISTS current_sponsor_ids();
ALTER TABLE sponsors DROP CONSTRAINT IF EXISTS sponsors_clerk_org_id_key;
ALTER TABLE sponsors DROP COLUMN IF EXISTS clerk_org_id;
```

Then unsubscribe the three `organizationMembership.*` events in the Clerk dashboard so the
reverted webhook does not receive events it no longer handles (its `default:` arm 200s them,
so this is tidiness, not an outage). Clerk organizations already created are harmless orphans;
leave them.

**Data safety:** because `profiles.sponsor_id` was kept in sync throughout, every sponsor that
worked before the migration still works after the rollback. Invited teammates who never had
`profiles.sponsor_id` stamped lose access — re-link them by hand with an admin
`UPDATE profiles SET sponsor_id = … `.

## Commit

```
feat(sponsors): multi-user sponsor organizations on Clerk Organizations

Adds sponsor_members mirroring Clerk Organization membership into Postgres,
links one Clerk org to one sponsors row, creates the org at application
approval, and syncs membership through the existing Clerk webhook.

Introduces current_sponsor_ids() and repoints sponsors_select_own,
submissions_select_sponsor, submissions_update_sponsor, ledger_select_sponsor
and sponsor_can_view_team() at it. profiles.sponsor_id is retained as the
denormalized primary-org pointer, so the capacity RPCs and every existing
sponsor keep working unchanged and no backfill is required.
```
