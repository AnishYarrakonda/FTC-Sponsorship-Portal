# Enterprise SSO runbook (SAML / OIDC)

How to connect a corporate sponsor's identity provider to FTC Pitfund, what to ask their IT
team for, and what happens to a user after their IdP authenticates them.

Audience: whoever is onboarding the sponsor. You should be able to run this end to end
without asking an engineer a question. Everything protocol-level is Clerk's; the only thing
this codebase owns is what happens **after** Clerk says "this person is real".

- Auth provider: **Clerk** (`@clerk/nextjs`). Enterprise connections are a Clerk feature.
- Sponsor org model: one Clerk Organization per `sponsors` row (`sponsors.clerk_org_id`),
  mirrored into `sponsor_members` — see prompt 08.
- Roles: `viewer < submitter < approver < org_admin`, authoritative in
  `sponsor_members.role` — see prompt 09. **Never** in Clerk metadata.

---

## 0. Before you promise anything

| Check | How | If it fails |
|---|---|---|
| Clerk plan includes Enterprise Connections | Clerk Dashboard → **SSO connections**. Production instances need **Pro or Business**; development instances get up to 25 connections free. | Stop. Upgrade first, or tell the sponsor we can do it after the plan change. Do not start the IdP conversation. |
| The sponsor has a Clerk Organization | `select clerk_org_id from sponsors where id = '<sponsor>'` — must be non-null. | Admin → sponsor detail page → **Retry organization creation** (`retryCreateSponsorOrganization`). |
| The sponsor's domain is a real corporate domain | Not gmail.com/outlook.com etc. | Clerk refuses consumer and disposable domains. There is no workaround. |
| Custom org roles are NOT needed | We use Clerk's built-in `org:admin` / `org:member` only. | Do not add custom Clerk roles — our ladder lives in Postgres, and Clerk custom roles are a paid B2B add-on we do not need. |

Also confirm the sponsor understands the two-sided commitment: their IdP administrator has
to create an application and hand back metadata. Budget about an hour of their time.

---

## 1. What to ask the sponsor's IT team for

Send exactly this list. Nothing else is needed from them up front.

1. **The email domain(s)** employees will sign in with (e.g. `acme.com`). Subdomains are a
   separate toggle — ask whether `eu.acme.com`-style addresses must work too.
2. **Their IdP**: Okta, Microsoft Entra ID, Google Workspace, or "other SAML 2.0 / OIDC".
3. **A named IdP administrator** who can create an application and share metadata.
4. **Whether they run SCIM** for automated deprovisioning (see §5).

Tell them what they will get back from us in step 2: an **ACS / Single Sign-On URL** and an
**Audience URI (SP Entity ID)**.

---

## 2. Create the connection — org-scoped, always

Clerk Dashboard → **SSO connections** → **Add connection** → *For specific domains or
organizations*.

1. **Provider**: pick the sponsor's IdP (Okta Workforce, Microsoft Entra ID, Google, or
   generic SAML/OIDC).
2. **Domain**: the sponsor's email domain from §1.
3. **Organization**: select the sponsor's Clerk Organization. **This field is not optional
   for us.** An instance-wide connection would let one sponsor's IdP authenticate users
   into the whole platform; org-scoping is what keeps a connection inside one company.
4. Save. Clerk now shows the **Single Sign-On URL (ACS)** and **Audience URI (SP Entity
   ID)** — send both to the sponsor's IdP admin.

> A Clerk Organization cannot use the same domain for both a *verified domain* (the
> email-code self-service flow) and *Enterprise SSO*. If the org already has that domain
> added as a verified domain, remove it before creating the connection.

### What the IdP admin does (Okta shown; Entra is equivalent)

1. Create a **SAML 2.0** application.
2. Paste our **Single Sign-On URL** and **Audience URI** into its SAML settings.
3. Attribute statements — at minimum:

   | Name | Value |
   |---|---|
   | `mail` (required) | `user.profile.email` |
   | `firstName` | `user.profile.firstName` |
   | `lastName` | `user.profile.lastName` |

4. Assign the users/groups who should have access.
5. Copy the application's **Metadata URL** and send it back to us.

**Do not accept a group or role claim into the mapping.** If they ask for IdP groups to
drive who can approve funding, the answer today is no — see §7. Roles are set in-app by an
org admin. A claim we accepted from their IdP would be an authorization input we do not
control.

### Finish in Clerk

1. Paste the **Metadata URL** into *Identity Provider Configuration* → **Fetch & save**.
2. Advanced tab → toggle **Allow subdomains** only if §1 said so.
3. Leave **Allow additional identifiers** off unless the sponsor explicitly needs it.
4. Toggle **Enable connection**.

### Domain verification

Clerk verifies the connection domain when you create it in the dashboard; for the
*organization verified domains* feature (a different thing, not used for enterprise SSO)
Clerk verifies ownership by emailing a code to an address at that domain. If Clerk asks for
a DNS record for the connection domain, forward the exact record it displays to the
sponsor's IT team — do not retype it — and re-check the SSO connections page until it shows
verified. Until then, the sponsor's settings page shows **Pending verification**.

---

## 3. Test before you hand it over

Both Okta and Microsoft Entra ID offer free developer tenants; use one rather than testing
against the sponsor's production IdP.

1. Sign out completely. Go to `/login` and enter an address on the connected domain.
   Clerk's existing sign-in flow (`useSignIn()`) redirects to the IdP automatically — there
   is no separate "Sign in with SSO" page, and there should not be one.
2. Authenticate at the IdP. You should land back in the portal at `/sponsor/dashboard`.
3. Confirm in Postgres:

   ```sql
   select p.email, m.role, m.joined_at
     from sponsor_members m join profiles p on p.id = m.profile_id
    where m.sponsor_id = '<sponsor-uuid>';
   -- the new person must be exactly one row, role = 'viewer'

   select action, metadata from audit_log
    where action = 'sso_jit_provision' order by created_at desc limit 5;
   ```
4. As that user, open a funding decision and confirm the approve/confirm controls are
   refused (viewer has no write permission — prompt 09's matrix).
5. Have an org admin promote them (`/sponsor/members`) and confirm the new rank sticks
   after signing out and back in through the IdP. **This is the regression that matters**;
   it is covered by `lib/__tests__/sso-jit-provisioning.test.ts` as well.

---

## 4. What happens on first login (JIT provisioning)

Implemented in `app/api/webhooks/clerk/route.ts`, `organizationMembership.created`. Clerk
adds the user to the organization, fires the webhook (Svix-signed, verified with
`CLERK_WEBHOOK_SIGNING_SECRET`), and we:

1. Resolve `sponsors` by `clerk_org_id`. **No match → nothing is created.** We write an
   `sponsor_member_sync_orphan_org` audit row, alert every admin in-app, and return 200 so
   Clerk does not retry an unfixable event forever.
2. Resolve `profiles` by `clerk_user_id`. No row (a genuinely new person — an SSO user never
   passes through our signup forms) → create a minimal sponsor profile from the Clerk
   payload: email, name, `role = 'sponsor'`, `sponsor_id`. `tos_accepted` and
   `coppa_acknowledged` stay **false** — nobody accepted terms on their behalf. The
   sponsor's signed sponsorship agreement is the governing document; if you need per-user
   ToS acceptance for a particular enterprise, raise it before the deal closes.
3. Insert `sponsor_members` with role **`viewer`** — least privilege, always. An
   IdP-authenticated stranger cannot commit funding on day one.
4. Write an `sso_jit_provision` row to `audit_log` with the org id, membership id, and email
   domain.

Clerk's payload cannot distinguish an SSO first login from an accepted invitation — they are
the same just-in-time path — so `sso_jit_provision` covers both.

### The account-collision case

A user who already has a password account on that email address, signing in through their
employer's IdP for the first time:

> Clerk links the enterprise identity to the **existing** user by verified email address.
> The `profiles` row and its `clerk_user_id` are unchanged, and no second `sponsor_members`
> row is created.

Consequences we implement deliberately:

- The membership upsert is keyed on `(sponsor_id, profile_id)` (UNIQUE since prompt 08) and
  **preserves the existing role**. A returning `approver` is still an `approver` after an
  SSO login. Repeated logins are idempotent.
- Clerk only knows `org:admin` / `org:member`, so an `org:member` event carries no
  information about someone already ranked below `org_admin` — we leave their role alone.
  A real Clerk-side demotion out of `org:admin` lands them on `submitter`.
- Caveat, by design: if Clerk's **"Verify at sign-up"** setting is on (the default) and the
  IdP returns an *unverified* email, Clerk creates a **separate** user rather than linking.
  We refuse to mirror that split: the webhook detects that the email already belongs to a
  different profile, creates **nothing**, writes an `sso_jit_provision_conflict` audit row,
  and alerts admins in-app.

  To resolve one: confirm with the sponsor which Clerk user is real, delete the spurious
  Clerk user in the dashboard (or fix the IdP so it asserts a verified email), and have the
  person sign in again. Never repoint `profiles.clerk_user_id` by hand — storage objects
  partition by the Clerk id, so a hand-edit orphans that user's uploads.

---

## 5. Deprovisioning

**Preferred — SCIM**, if the sponsor's plan and ours support it. Their IdP pushes the
deactivation, Clerk removes the organization membership, and our existing
`organizationMembership.deleted` handler:

1. deletes the `sponsor_members` row,
2. nulls `profiles.sponsor_id` when it pointed at that sponsor and no other membership
   remains,
3. writes a `remove_sponsor_member_webhook` audit row.

Both steps 1 and 2 are load-bearing: `current_sponsor_ids()` unions `sponsor_members` with
the legacy `profiles.sponsor_id` pointer, so leaving the pointer behind would keep a removed
employee's access alive. RLS then denies the next request — the removed user sees zero rows
for that sponsor's submissions, ledger, and fulfillments. Verified by the cross-org and
membership tests in `tests/e2e/sponsor-organizations.spec.ts` and
`tests/e2e/sponsor-approvals.spec.ts`.

**Fallback — manual.** If SCIM is not available: an org admin removes the person at
`/sponsor/members`, which removes them from Clerk and from `sponsor_members` in the same
action. Be honest with the sponsor that this is a **weaker control** — it depends on someone
at their company remembering to tell us or to click the button. Ask them to add FTC Pitfund
to their offboarding checklist, and say so in writing.

Either way, verify after the first real offboarding rather than assuming:

```sql
select count(*) from sponsor_members where profile_id = '<profile>';   -- expect 0
select sponsor_id from profiles where id = '<profile>';                -- expect null
```

---

## 6. What the sponsor sees

`/sponsor/settings` shows a read-only **Single sign-on** panel to org admins
(`components/sponsor/sso-status-card.tsx`, data from `lib/sso.ts`):

| State | When | What it says |
|---|---|---|
| **Not set up** | No enterprise connection on the org | "Contact us to set up single sign-on" — deliberately not self-serve. |
| **Pending verification** | Connection exists, inactive or no verified domain | Names the domains still awaiting verification. |
| **Active** | Active connection + a verified domain | Names the provider and domains; explains the viewer default. |
| **Unavailable** | Clerk unreachable, or the plan lacks Enterprise Connections | A neutral "we could not load this" — never a raw error. |

An IdP that rejects an assertion produces a Clerk-hosted error, not one of ours; the sponsor
should be told to contact support rather than forwarding a SAML stack trace.

---

## 7. Known follow-ups (deliberately not built)

- **IdP group → role mapping.** Today an org admin sets ranks in-app. Mapping IdP groups to
  `sponsor_members.role` is a real feature with real risk (it makes an external system an
  authorization input) and needs its own slice. Say "not yet, and here is the manual path"
  rather than accepting a group claim.
- **Intermediate roles on invitations.** Clerk invitations can only carry `org:admin` /
  `org:member`, so inviting a brand-new person as "Approver" lands them as `viewer` until an
  admin promotes them. Existing members invited from within the app keep the chosen rank.
- **SSO for coaches or admins.** Out of scope — coaches are individual volunteers.
- **Self-serve SSO setup by sponsors.** Not planned; enterprise connections need a human on
  both sides.
- **MFA.** Removed from this product on purpose. Do not reintroduce it; if a sponsor
  requires MFA, it is enforced at their IdP, which is where it belongs.

---

## 8. Rollback

1. Disable the connection in Clerk → users fall straight back to email + password.
2. Revert the `app/api/webhooks/clerk/route.ts` change if the JIT path itself is at fault.
   Existing `sponsor_members` rows are unaffected.
3. Remove `<SsoStatusCard />` from `app/(sponsor)/sponsor/settings/page.tsx`.

No migration, no data loss. JIT-provisioned members simply stop being created automatically.
