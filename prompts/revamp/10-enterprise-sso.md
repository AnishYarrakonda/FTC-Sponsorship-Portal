# Prompt 10 — Enterprise SSO (SAML / OIDC)

> **Prerequisites:** 08 (sponsor organizations)
> **Reserved migration:** None — no schema changes
> **Scope:** small · ~5 files, mostly documentation and configuration
> **Leaves the repo:** green and shippable on its own

## Read this before you start

This prompt has an unusually low code-to-effort ratio. Most of the work is **Clerk dashboard
configuration**, DNS verification, and a written runbook. Do not inflate it into a large
code change — if you find yourself building a SAML parser, you have gone wrong. Clerk owns
the protocol; the codebase only owns what happens to a user *after* Clerk authenticates them.

**This requires a paid Clerk plan.** Enterprise Connections (SAML/OIDC) are not on the free
tier. Confirm the account has it before starting; if it does not, stop and report rather than
building half a feature.

Read the **"When to skip this"** section at the bottom first. There is a real chance the
correct action today is to write the runbook and stop.

## Why this exists

A Fortune 500 IT department is wary of yet another password-based vendor login. Their
security review asks: can our employees sign in with our identity provider, and when someone
leaves the company, does their access disappear automatically? Today the answer to both is
no — sponsor users authenticate with an email and password through Clerk, and offboarding is
manual and invisible to us.

## Current state (verified)

**What exists**

- Auth is Clerk (`@clerk/nextjs` ^7.5.7). Email + password only. MFA was fully removed and
  must not be reintroduced (`.claude/rules/auth-supabase.md`).
- Prompt 08 introduced `sponsor_members` and one Clerk Organization per `sponsors` row
  (`sponsors.clerk_org_id`), plus a `sponsor_members` sync in
  `app/api/webhooks/clerk/route.ts` handling `organizationMembership.created/updated/deleted`.
  Re-read that route before touching it — it also handles `user.deleted` and email sync.
- Prompt 09 defined the role set on `sponsor_members` (`viewer | submitter | approver |
  org_admin`) and the permission matrix.
- Roles are authoritative in Postgres. Clerk `publicMetadata.role` is mirrored for UX only
  and is **never** trusted for authorization (`.claude/rules/auth-supabase.md`).
- `lib/env.ts` validates all env vars with Zod and throws in production on a missing one.

**What is missing**

No enterprise connection exists, no domain verification, no just-in-time provisioning path,
no deprovisioning story, and no documentation an account executive could hand to a sponsor's
IT team.

## What you are building

1. Clerk Enterprise Connection configuration, per sponsor organization, documented step by step.
2. A **just-in-time provisioning path**: a user who authenticates via a sponsor's IdP for the
   first time lands in `sponsor_members` with a safe default role.
3. Handling for the **account-collision case** — SSO is enabled for a domain but a user
   already has a password account on it.
4. **Deprovisioning**: SCIM if the plan includes it, plus a documented manual fallback.
5. A committed runbook at `docs/enterprise-sso-runbook.md`.
6. Tests for the parts that are actually testable in our code.

## Data model

**None — no schema changes.**

This prompt deliberately adds no tables. Everything it needs already exists on
`sponsor_members` and `sponsors.clerk_org_id` from prompt 08. If you believe you need a
column, stop and report why — it probably belongs in prompt 08's model instead.

## Configuration (the actual work)

Consult Clerk's current documentation rather than working from memory; the Enterprise
Connections UI changes. Record the exact steps you followed in the runbook.

1. **Enable Enterprise Connections** on the Clerk instance (paid plan gate).
2. **Create a connection scoped to the sponsor's Clerk Organization** — the connection must
   be org-scoped, not instance-wide, or one sponsor's IdP would authenticate users into the
   whole platform.
3. **Verify the sponsor's email domain** via the DNS TXT record Clerk issues. The sponsor's IT
   team owns this step; the runbook must be explicit about what you are asking them for.
4. **Exchange metadata** — either the IdP metadata URL or the uploaded XML, plus the ACS URL
   and Entity ID Clerk generates. Note both directions in the runbook.
5. **Attribute mapping** — at minimum email, first name, last name. Do **not** map any
   role or group claim into `publicMetadata` and treat it as authorization. If the sponsor
   wants IdP groups to drive roles, that is a separate, larger feature; say so and defer it.
6. **Test with a real IdP** before enabling for the sponsor's users. Clerk supports a test
   connection; Okta and Microsoft Entra ID both offer free developer tenants.

## Server actions

No new mutating server action is strictly required. The one code change that matters is the
**JIT provisioning hook**, which belongs in the existing Clerk webhook route rather than a
new action.

**Modify `app/api/webhooks/clerk/route.ts`:**

- Extend the existing `organizationMembership.created` handler so a membership created by an
  SSO first-login resolves the `sponsors` row via `sponsors.clerk_org_id` and inserts a
  `sponsor_members` row with role **`viewer`** — least privilege. An org admin promotes from
  there. Never default to `approver`; an IdP-authenticated stranger must not be able to
  commit funding on day one.
- Write an `audit_log` row (admin client) with action `sso_jit_provision`, `entity_type`
  `sponsor_members`, and metadata recording the connection id and the email domain.
- If no `sponsors` row matches the org, do **not** create an orphan member — log, alert
  admins via `createInAppNotification`, and return 200 so Clerk does not retry forever.

The webhook is signature-verified with `CLERK_WEBHOOK_SIGNING_SECRET` via `svix`; keep that
verification intact and do not add an unauthenticated branch.

### The account-collision case

Specify and implement one behavior, do not leave it ambiguous:

> When a user with an existing password account signs in through their employer's IdP for the
> first time, Clerk links the identity to the existing user by verified email address. The
> existing `profiles` row and its `clerk_user_id` are therefore **unchanged**, and no new
> `sponsor_members` row should be created if one already exists.

Make the webhook handler idempotent on `(sponsor_id, profile_id)` — prompt 08 already places
a UNIQUE constraint there, so use an upsert that preserves the existing role rather than
resetting it to `viewer`. **A returning approver must not be silently demoted by an SSO
login.** This is the single most likely bug in this slice; write the test for it.

## Deprovisioning

1. **SCIM**, if the Clerk plan includes it — the IdP pushes deactivation, Clerk removes the
   org membership, and the existing `organizationMembership.deleted` handler from prompt 08
   removes the `sponsor_members` row. Verify that chain end to end; do not assume it.
2. **Manual fallback**, if SCIM is unavailable — an org admin removes the member in-app, and
   the runbook instructs the sponsor to notify us on offboarding. Be honest in the runbook
   that this is a weaker control.
3. Either way: removing a `sponsor_members` row must immediately cut off data access. That is
   a claim about RLS, so prove it with a test rather than asserting it.

## UI

Minimal, and mostly informational.

- **Sponsor org settings** (from prompt 08): a read-only "Single sign-on" panel showing
  whether SSO is enabled for this organization and which domain is verified. If not enabled,
  show a "Contact us to set up SSO" state rather than a self-serve flow — enterprise
  connections need a human on both sides.
- **Login page** (`app/(auth)/login/`): Clerk's components handle IdP-initiated and
  SP-initiated flows. Verify the existing `useSignIn()` implementation does not break when an
  enterprise connection is present. Do not build a separate "Sign in with SSO" page unless
  testing shows the default flow fails.
- **States:** SSO not configured · domain pending verification · active · error (IdP rejected
  the assertion — show a support contact, never a raw SAML error).

## Out of scope

- IdP group-to-role mapping. Defer; note it in the runbook as a known follow-up.
- SSO for coaches or admins. Coaches are individual volunteers; this is sponsor-only.
- Reintroducing MFA in any form.
- Self-serve SSO configuration by sponsors.
- Any new table or migration.

## Guardrails specific to this slice

- **Never trust `publicMetadata` for authorization.** An IdP-supplied claim landing in Clerk
  metadata is attacker-influenced from our perspective. Roles come from `sponsor_members`.
- **Least privilege on JIT.** Default `viewer`, always.
- **Idempotency.** SSO logins fire membership webhooks repeatedly; the handler must never
  demote or duplicate an existing member.
- **Keep webhook signature verification.** `CLERK_WEBHOOK_SIGNING_SECRET` is required in
  production by `lib/env.ts`.
- **Org-scoped connections only.** An instance-wide connection would let one sponsor's IdP
  mint users across the platform.
- Cross-org isolation from prompt 08 must still hold after this change — an SSO user must not
  be able to read another sponsor's data.

## Files you will touch

**Create:**
- `docs/enterprise-sso-runbook.md`
- `lib/__tests__/sso-jit-provisioning.test.ts`

**Modify:**
- `app/api/webhooks/clerk/route.ts` — JIT provisioning + idempotent upsert
- `app/(sponsor)/sponsor/settings/page.tsx` — read-only SSO status panel
- `prompts/README.md` — mark this prompt done

## Tests

**Vitest — `lib/__tests__/sso-jit-provisioning.test.ts`:**
- A membership-created event for an org with a matching `sponsors` row inserts a
  `sponsor_members` row with role `viewer`.
- A membership-created event for a profile that **already** has a `sponsor_members` row with
  role `approver` leaves the role as `approver`. (The demotion bug.)
- A membership-created event for an unknown `clerk_org_id` creates no row and returns 200.
- An unsigned or wrongly-signed webhook payload is rejected.

**Playwright / manual, documented in the runbook:**
- A JIT-provisioned viewer can see the sponsor dashboard but cannot approve funding
  (reuses prompt 09's permission matrix).
- Removing the membership revokes data access — the same user, next request, gets nothing.

**Cross-org isolation:** a user provisioned into org A cannot read org B's submissions,
ledger rows, or fulfillments. This must be asserted at the database level, not just the
action layer.

## Acceptance criteria

- [ ] A test IdP (Okta or Entra developer tenant) can authenticate a user into a sponsor
      organization end to end, and that user appears in `sponsor_members` with role `viewer`.
- [ ] An existing `approver` who signs in via SSO still has role `approver` afterwards.
- [ ] An SSO-provisioned viewer is refused when attempting to approve funding.
- [ ] Removing the org membership removes the `sponsor_members` row and the user can no
      longer read that sponsor's data.
- [ ] An SSO user in org A receives zero rows when querying org B's data.
- [ ] `audit_log` contains an `sso_jit_provision` row for each first-time SSO login.
- [ ] `docs/enterprise-sso-runbook.md` is complete enough that someone else could onboard the
      next enterprise sponsor without asking you a question.
- [ ] Webhook signature verification is still enforced.
- [ ] `npm run typecheck && npm run lint && npm run build && npm run test` all green.

## Rollback

No migration to reverse.

1. Disable the enterprise connection in the Clerk dashboard — users fall back to email +
   password immediately.
2. Revert the `app/api/webhooks/clerk/route.ts` change. Existing `sponsor_members` rows are
   unaffected and remain valid.
3. Remove the SSO panel from sponsor settings.

No data is destroyed by rolling back; JIT-provisioned members simply stop being created
automatically.

## When to skip this

Be honest with yourself before spending a session here.

**Skip if:** no enterprise sponsor has asked for SSO, or the Clerk plan does not include
Enterprise Connections. In that case, do the cheap 20% — write
`docs/enterprise-sso-runbook.md` with the configuration steps and a note that the code hook
is not yet built — and stop. That document is what you need in a sales conversation; the
implementation can wait for the first real request.

**Do it when:** a specific sponsor's IT or security team asks during procurement, or a deal
is blocked on it. That is the signal. Configuration takes hours once the sponsor's IdP admin
is engaged, and the JIT hook is a small change on top of prompt 08.

## Commit

```
feat(auth): enterprise SSO via Clerk connections with least-privilege JIT provisioning
```
