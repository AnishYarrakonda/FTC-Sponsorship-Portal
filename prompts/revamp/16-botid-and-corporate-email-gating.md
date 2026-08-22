# Prompt 16 — Vercel BotID + Corporate Email Gating on the Sponsor Path

> **Prerequisites:** None
> **Reserved migration:** `0089_email_domain_gating.sql` — verify it is still free with `ls supabase/migrations | tail -3`
> **Scope:** medium · ~15 files
> **Leaves the repo:** green and shippable on its own

## Why this exists

`/sponsors/apply` is the only unauthenticated write surface in the product, and what it
writes is a row an admin will later approve into a **`sponsors` company with a funding cap**.
A bot farm that fills it is not spam in a mailbox — it is noise in the queue that gates money.

Separately, the second question a corporate giving officer asks after "how do you verify the
team" is "how do you verify *us*". Today a sponsor application from `robotics.fan@gmail.com`
claiming to represent Lockheed Martin lands in the admin queue looking exactly like a real
one, and there is nothing in the row that says which is which. Not even the company website
the applicant typed — the wizard collects it and the action throws it away (see below).

## Current state (verified)

**Read this whole section before writing a line. Two of the three things people assume about
this surface are wrong, and the wrong one is load-bearing.**

### The throttle is real, and it is on the live path

`supabase/migrations/0055_coach_denial_and_throttle.sql` creates `request_throttle`
(PK `(key, window_start)`, `count int`, deny-all RLS policy `rt_deny_all`) and the
`check_throttle(p_key text, p_limit int, p_window interval)` SECURITY DEFINER function — a
sliding-bucket counter that returns `true` while under the limit and prunes buckets older
than four windows. Its `EXECUTE` is revoked from `PUBLIC`/`anon`/`authenticated` and granted
only to `service_role`, so only the admin client can call it. **There is no Redis anywhere
and none is to be added.**

It is invoked from the live public path at `app/actions/auth.ts:313-339`:
`sponsor-apply:{ip}` at **3 per hour** and `sponsor-apply-email:{sessionEmail}` at
**2 per day**, both fired in a single `Promise.all`, both **failing OPEN** — an RPC error is
logged to `console.error` and Sentry and the application proceeds. That failing-open choice
is deliberate and documented in the comment at `:305-312`; do not change it in this slice.

### The honeypot is NOT on the live path — it is on a dead action and an admin form

This is the correction. Three separate facts:

1. `app/sponsors/apply/page.tsx:12` renders **`SponsorSignupWizard`**
   (`components/auth/sponsor-signup-wizard.tsx`), which submits via
   **`createSponsorApplication`** in `app/actions/auth.ts:232` (called at
   `sponsor-signup-wizard.tsx:219`). That action has **no honeypot of any kind**.
2. `submitSponsorApplication` in `app/actions/sponsor.ts:45-97` — the action that *does*
   carry the `website2` honeypot (`:51-58`, "Pretend success so bots get no signal") and its
   own `checkThrottle` wrapper (`:18-43`) — is **dead code**. `grep` for it returns exactly
   one non-definition hit: `lib/__tests__/sponsor-application.test.ts:33`. No page, no
   component, no route imports it.
3. The `website2` input is rendered in exactly one place:
   `components/sponsor/sponsor-form.tsx:87-97`, inside an `aria-hidden` offscreen div. That
   component is mounted only by `app/(admin)/sponsors/new/page.tsx:31` and
   `app/(admin)/sponsors/[id]/edit/page.tsx:33` — **both admin-only routes behind
   `requireAdmin()`**. A honeypot on a form only an admin can reach catches nothing.

So the live public application has: a throttle (real, fails open), Clerk email-code
verification before the form can be completed, and **no bot challenge and no honeypot**.

### The application flow is post-Clerk-signup, not anonymous

`SponsorSignupWizard` step 1 calls `signUp.create()` + `prepareEmailAddressVerification()`
(`sponsor-signup-wizard.tsx:155-159`), the user enters the 6-digit code
(`:185-191`), `setActive()` activates the session, and only then do steps 2–3 collect company
data and call `createSponsorApplication`. **The bot cost is therefore one throwaway inbox and
one OTP round-trip, not zero** — but Clerk signup itself is unprotected, and the wizard's
step-1 `signUp.create()` is the cheapest thing on the page to hammer.

`createSponsorApplication` also already does two things you must not undo:
- The email is taken from **Clerk**, never the client (`:257-277`), because
  `approveSponsorApplication` links companies by `profiles.email`.
- A signed-in coach or admin is refused outright (`:291-303`), and `middleware.ts:29-34`
  bounces them off `/sponsors/apply` before they get there.

### The website field is collected and then discarded

`lib/schemas/sponsor-signup.ts:18` requires `website` (min 1 char, must contain a `.`), the
wizard renders it at `sponsor-signup-wizard.tsx:427-429`, and
`createSponsorApplication`'s insert at `app/actions/auth.ts:401-407` writes
`company_name / contact_name / contact_email / proposed_cap_cents / message` — **`website`
is dropped on the floor.** `sponsor_applications` has no `website` column at all
(`0001_init.sql:161-172`, plus `contact_name` from `0029` and `status/approved_at/approved_by`
from `0043:6-9`). The domain-match check in part (c) is impossible until this is fixed, so
fixing it is part of this slice.

### Constraints you inherit

- `sponsor_applications.contact_email` is **UNIQUE** (`0035_production_hardening.sql:18`).
- `next.config.ts` ships a real CSP with `script-src 'self' 'unsafe-inline' {clerkOrigins}
  https://challenges.cloudflare.com`. BotID's challenge script is served **same-origin**
  through the `withBotId` rewrites, so `'self'` covers it — but verify this in the browser
  console on a preview deploy before declaring the slice done. A CSP-blocked challenge script
  makes `checkBotId()` classify every real human as a bot.
- `instrumentation-client.ts` already exists (15 lines, Sentry only). `initBotId()` goes in
  that same file.

## What you are building

1. **Vercel BotID** on the sponsor application path and both signup paths, in **Basic mode**.
2. **Corporate email domain gating**, table-driven so the lists are editable without a deploy,
   with an admin allowlist escape hatch.
3. **A domain-match warning** surfaced to the admin reviewer — never a rejection.
4. **`website` persisted** on `sponsor_applications`, because (3) needs it.

### ⚠️ SCOPE FENCE — coach signup is out of bounds for the email gating

**Coaches are unpaid volunteers. A very large share of them will legitimately sign up with a
personal Gmail, Yahoo, or school-district address that looks nothing like a corporate domain.
Blocking a free-mail domain on `/signup` would lock out a majority of the product's supply
side, and it would do so silently at the exact moment the coach is most likely to give up.**

Concretely, this means:

- `createCoachProfile` and `completeCoachProfile` (`app/actions/auth.ts:138`, `:175`) and
  `provisionCoachProfile` (`:53`) **must not import, call, or reference** the domain-gating
  module. Not behind a flag. Not "for logging". Not at all.
- `lib/schemas/auth.ts` gets **no** domain refinement.
- `components/auth/signup-wizard.tsx` gets **no** domain hint or warning copy.
- BotID **is** applied to coach signup — that is bot protection, not identity gating, and it
  is invisible to the user. The two are separate concerns and only one of them is scoped to
  sponsors.
- A test asserting a coach can sign up with a `gmail.com` address is **mandatory** and listed
  in the Tests section. If that test does not exist, the slice is not done.

### (a) Vercel BotID — Basic mode

BotID is Vercel-native, invisible (no user interaction, no visible CAPTCHA), and works by
serving a client-side challenge from same-origin proxy paths and validating the response
server-side. Three wiring points, all required — missing any one makes `checkBotId()` return
`isBot: true` for real humans:

**1. `next.config.ts`** — wrap the existing export. Everything already in `nextConfig`
(the CSP `headers()`, `images`, `experimental.serverActions.bodySizeLimit`, `poweredByHeader`)
stays exactly as-is:

```ts
import { withBotId } from 'botid/next/config'
// … existing nextConfig object unchanged …
export default withBotId(nextConfig)
```

**2. `instrumentation-client.ts`** — Next 16 is well past the 15.3 cutoff, so use
`initBotId()` here rather than the legacy `<BotIdClient>` layout component. Add **above** the
existing Sentry block so the challenge is armed before anything else runs:

```ts
import { initBotId } from 'botid/client/core'

// Paths whose POSTs carry a bot cost. Server Actions are protected by the PAGE PATH
// they are invoked from, not by an API route — a Server Action POSTs back to its own
// page URL.
initBotId({
  protect: [
    { path: '/sponsors/apply', method: 'POST' }, // createSponsorApplication
    { path: '/signup',         method: 'POST' }, // createCoachProfile
    { path: '/complete-profile', method: 'POST' }, // completeCoachProfile / stranded-sponsor recovery
  ],
})
```

Verify the third path against the real route before shipping (`ls "app/(auth)"` and the
`/complete-profile` page referenced in `middleware.ts:26-28`). A path listed here that does
not exist is harmless; a path omitted here that hosts a protected action means
`checkBotId()` sees no challenge response and rejects every human.

**3. The server side** — `checkBotId()` from `botid/server` at the top of each protected
action, **before** the throttle and before any database work:

```ts
const verification = await checkBotId()
if (verification.isBot) {
  return { error: 'We could not verify this request. Please refresh the page and try again.' }
}
```

Return the error object; **do not `throw`**. Every action in this codebase returns
`{ error }` (`_CONTEXT.md` §7) and the wizards render `result.error` into an `Alert`
(`sponsor-signup-wizard.tsx:220`, `signup-wizard.tsx`). Throwing surfaces the Next.js
digest-only server error instead, which reads as a crash.

**Mode: start with Basic.** Per Vercel's docs, Basic validates the integrity and correctness
of the challenge response and is **free on all plans**, including Hobby. **Deep Analysis**
(the Kasada ML layer) requires **Pro at $1 per 1,000 `checkBotId()` calls**, and this project
is on Hobby (`_CONTEXT.md` §10). Do not set `advancedOptions.checkLevel` at all — leaving it
unset keeps both sides on Basic and consistent. If Deep Analysis is later wanted, the
`checkLevel` **must be changed on both the client `initBotId` entry and the server
`checkBotId` call for that path**, or verification fails.

**Local development and Playwright:** `checkBotId()` returns `HUMAN` by default in
development, so `npm run dev` and the local Playwright suite are unaffected. On a preview
deployment BotID is live and Playwright *is* the kind of automation it is built to catch —
if the E2E suite is ever pointed at a preview URL, add a Vercel WAF bypass rule for the test
runner rather than weakening the check. Note this in the runbook; do not build a code-level
bypass.

### (b) Corporate email domain gating — sponsors only

A new pure module `lib/email-domain.ts` (no network, no DB — so it is unit-testable in
isolation, same idiom as the pure helpers this repo already favours) plus a rules table.

```ts
// lib/email-domain.ts
/** Lowercased apex domain from an email address, or null if unparseable. */
export function emailDomain(email: string): string | null
/** Lowercased apex host from a URL or bare host ("https://www.acme.co.uk/x" -> "acme.co.uk"). */
export function websiteDomain(raw: string): string | null
/** 'match' | 'related' | 'mismatch' | 'unknown' — see the table below. */
export function compareDomains(
  emailHost: string | null,
  siteHost: string | null
): 'match' | 'related' | 'mismatch' | 'unknown'
```

`emailDomain` strips a `+tag`, lowercases, trims, and takes everything after the last `@`.
`websiteDomain` tolerates a missing scheme (the Zod schema at
`lib/schemas/sponsor-signup.ts:18` only requires a `.`, so `acme.com` with no `https://` is
valid input), strips a leading `www.`, drops path/query/port.

**The public-suffix problem, and the deliberate simplification:** correctly reducing
`acme.co.uk` to an apex needs the Public Suffix List, which is a dependency and a data file.
Do not add one. Instead: compare the **last two labels** by default, and the **last three**
when the last two match a small hardcoded set of known multi-part suffixes
(`co.uk, org.uk, ac.uk, com.au, co.nz, co.jp, com.br, co.za, com.mx`). This is imperfect and
that is acceptable, because the output is a **warning shown to a human reviewer**, not a
gate. Comment it that way in the file so nobody "fixes" it into a hard rule later.

| Result | When |
|---|---|
| `match` | Email host equals website host after normalization. |
| `related` | One is a subdomain of the other, **or** the email host's first label is a substring of the company name after normalization (catches `jane@acme-corp.com` / `acme.com`). |
| `mismatch` | Both present, neither of the above. |
| `unknown` | Either side is null/unparseable, **or** the email host is on the block list (a Gmail applicant with an allowlist override has no meaningful domain to compare). |

**The gate itself:**

```ts
// lib/sponsor-domain-gate.ts (server-only — reads the rules table via the admin client)
export type DomainGateVerdict =
  | { allowed: true;  reason: 'allowlisted' | 'corporate' }
  | { allowed: false; reason: 'consumer' | 'disposable'; message: string }
export async function checkSponsorEmailDomain(email: string): Promise<DomainGateVerdict>
```

Resolution order, and it matters: **allow always beats block.** Look up the exact domain in
`email_domain_rules`; a row with `rule='allow'` returns `{ allowed: true, reason: 'allowlisted' }`
immediately, even if a `block` row also exists for the same domain (they cannot both exist —
`domain` is the PK — but the ordering statement is what the admin UI copy promises, so encode
it as an explicit early return rather than an accident of query order).

**Fail OPEN.** If the rules query errors, log to `console.error` **and** Sentry and return
`{ allowed: true, reason: 'corporate' }`. This mirrors the throttle's documented posture at
`app/actions/auth.ts:305-312` and the reasoning is identical: a database hiccup must not
close the only sponsor-acquisition funnel the product has. Copy that comment's tone.

**The rejection message — non-insulting, actionable, and it must not imply the applicant is
a bot or a liar:**

> "Sponsor accounts need a company email address — one at your organization's own domain.
> If your organization doesn't have one (small businesses and family foundations often
> don't), email us at {SUPPORT_EMAIL} and we'll set your account up manually."

Use `SUPPORT_EMAIL` from `lib/site-config.ts` — it is already imported by `lib/notify.ts:14`
and `lib/dispatch.ts:7`. Do not hardcode an address.

**Where the gate runs:** inside `createSponsorApplication` (`app/actions/auth.ts`), after the
Clerk-authoritative email is resolved (`:257-277`) and after the cross-role guard
(`:291-303`), **before** the throttle. Check the **Clerk session email**, never
`payload.email` — the action already refuses a mismatch between the two, and the session
email is the one that ends up in `profiles.email`.

The stranded-sponsor recovery form
(`components/auth/complete-sponsor-application-form.tsx`) calls the same action, so it
inherits the gate automatically. That is correct: a sponsor who got stranded on a Gmail
address still needs an allowlist entry.

### (c) Domain-match warning

Not a gate. `createSponsorApplication` computes `compareDomains(emailDomain(sessionEmail),
websiteDomain(payload.website))` and writes `website`, `email_domain`, `website_domain`, and
`domain_match` onto the `sponsor_applications` row (both the insert branch at `:401-407` and
the rejected-reopen update branch at `:420-431` — a re-application must refresh the verdict,
not keep a stale one).

When the verdict is `mismatch`, the existing admin in-app notification at `:465-478` gains a
line to its `body`: `Heads up: the applicant's email domain (jane@gmail-alt.com) does not
match the company website they gave (acme.com).` Same notification, same `skipEmail: true`,
no new notification type — `notifications.type` is a CHECK-constrained text column and
`general` already covers this.

## Data model

```sql
-- ── 1. sponsor_applications: persist the website and the domain verdict ──────
-- The wizard has always collected `website` (lib/schemas/sponsor-signup.ts:18) and the
-- action has always discarded it (app/actions/auth.ts:401-407). Nothing downstream can
-- compare a domain it was never given.
ALTER TABLE sponsor_applications ADD COLUMN IF NOT EXISTS website        text;
ALTER TABLE sponsor_applications ADD COLUMN IF NOT EXISTS email_domain   text;
ALTER TABLE sponsor_applications ADD COLUMN IF NOT EXISTS website_domain text;
ALTER TABLE sponsor_applications ADD COLUMN IF NOT EXISTS domain_match   text
  CHECK (domain_match IN ('match', 'related', 'mismatch', 'unknown'));

-- Partial index: the admin queue only ever filters for the flagged ones.
CREATE INDEX IF NOT EXISTS idx_sponsor_apps_domain_mismatch
  ON sponsor_applications (created_at DESC) WHERE domain_match = 'mismatch';

-- ── 2. email_domain_rules ────────────────────────────────────────────────────
-- Editable without a deploy. `domain` is the PK, so a domain is either blocked or
-- allowed, never both, and an admin flipping one is a plain upsert.
CREATE TABLE IF NOT EXISTS email_domain_rules (
  domain     text PRIMARY KEY,        -- lowercase apex, no scheme, no leading dot
  rule       text NOT NULL CHECK (rule IN ('block', 'allow')),
  category   text NOT NULL DEFAULT 'other'
    CHECK (category IN ('consumer', 'disposable', 'manual', 'other')),
  reason     text,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_edr_rule ON email_domain_rules (rule);

DROP TRIGGER IF EXISTS set_updated_at_email_domain_rules ON email_domain_rules;
CREATE TRIGGER set_updated_at_email_domain_rules
  BEFORE UPDATE ON email_domain_rules
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();   -- defined in 0001_init.sql:262

ALTER TABLE email_domain_rules ENABLE ROW LEVEL SECURITY;
```

**RLS policies (in `0089`, `DROP POLICY IF EXISTS` before each `CREATE`):**

- `edr_select_admin` — `FOR SELECT USING (is_admin())`. Only admins read the lists.
- **No INSERT / UPDATE / DELETE policies.** RLS denies by default, so the table is
  service-role-write-only — the same idiom as `audit_log` (`0001`) and
  `team_verification_records`. Every write in this slice goes through
  `createAdminClient()`, including the reads inside `checkSponsorEmailDomain`, which runs for
  unauthenticated-ish callers who could never satisfy `is_admin()`.
- `sponsor_applications` keeps its existing four policies from `0001_init.sql:552-569`
  unchanged; the new columns inherit them. In particular do **not** touch
  `sponsor_apps_insert_public` — widening it is not needed, the insert goes through the
  admin client.

**Seed data, idempotent:**

```sql
INSERT INTO email_domain_rules (domain, rule, category, reason) VALUES
  -- Consumer mail
  ('gmail.com','block','consumer','Consumer mail'),
  ('googlemail.com','block','consumer','Consumer mail'),
  ('yahoo.com','block','consumer','Consumer mail'),
  ('ymail.com','block','consumer','Consumer mail'),
  ('outlook.com','block','consumer','Consumer mail'),
  ('hotmail.com','block','consumer','Consumer mail'),
  ('live.com','block','consumer','Consumer mail'),
  ('msn.com','block','consumer','Consumer mail'),
  ('aol.com','block','consumer','Consumer mail'),
  ('icloud.com','block','consumer','Consumer mail'),
  ('me.com','block','consumer','Consumer mail'),
  ('mac.com','block','consumer','Consumer mail'),
  ('proton.me','block','consumer','Consumer mail'),
  ('protonmail.com','block','consumer','Consumer mail'),
  ('pm.me','block','consumer','Consumer mail'),
  ('gmx.com','block','consumer','Consumer mail'),
  ('gmx.net','block','consumer','Consumer mail'),
  ('mail.com','block','consumer','Consumer mail'),
  ('zoho.com','block','consumer','Consumer mail'),
  ('yandex.com','block','consumer','Consumer mail'),
  ('fastmail.com','block','consumer','Consumer mail'),
  ('hey.com','block','consumer','Consumer mail'),
  -- Disposable / throwaway
  ('mailinator.com','block','disposable','Disposable mail'),
  ('guerrillamail.com','block','disposable','Disposable mail'),
  ('10minutemail.com','block','disposable','Disposable mail'),
  ('tempmail.com','block','disposable','Disposable mail'),
  ('temp-mail.org','block','disposable','Disposable mail'),
  ('throwawaymail.com','block','disposable','Disposable mail'),
  ('yopmail.com','block','disposable','Disposable mail'),
  ('trashmail.com','block','disposable','Disposable mail'),
  ('sharklasers.com','block','disposable','Disposable mail'),
  ('dispostable.com','block','disposable','Disposable mail'),
  ('getnada.com','block','disposable','Disposable mail'),
  ('maildrop.cc','block','disposable','Disposable mail'),
  ('mailnesia.com','block','disposable','Disposable mail'),
  ('spamgourmet.com','block','disposable','Disposable mail'),
  ('emailondeck.com','block','disposable','Disposable mail')
ON CONFLICT (domain) DO NOTHING;
```

`ON CONFLICT DO NOTHING` is what makes the seed idempotent **and** non-destructive: replaying
`0089` after an admin has allowlisted `gmail.com` for a specific edge case must not silently
re-block it.

**`lib/supabase/types.ts` is hand-maintained** — there is no codegen script in
`package.json`. Add the four new `sponsor_applications` columns to its Row/Insert/Update
blocks and a full `email_domain_rules` Row/Insert/Update/Relationships block by hand,
matching the surrounding style, or `npm run typecheck` fails on every new column.

**Migration `0089` contains no `$$` blocks**, so the Supabase CLI would cope — apply it with
`psql -f` anyway, for consistency with every other migration in this repo.

## Server actions

| Action | File | Guard | Zod schema | `audit_log` action | Notification |
|---|---|---|---|---|---|
| `createSponsorApplication(data)` (**modify**) | `app/actions/auth.ts:232` | unchanged (Clerk `auth()` + cross-role guard at `:291-303`) | `sponsorSignupSchema` (unchanged) | new: `sponsor_application_blocked` on a domain rejection, `entity_type: 'sponsor_applications'`, `entity_id: null`, metadata `{ email_domain, rule_category }` — do **not** log the full email | on `domain_match = 'mismatch'`, append the warning line to the existing admin in-app notification body at `:465-478` |
| `createCoachProfile(formData)` (**modify**) | `app/actions/auth.ts:138` | unchanged | unchanged | none | none — **BotID check only. No domain gating. See the scope fence.** |
| `completeCoachProfile(formData)` (**modify**) | `app/actions/auth.ts:175` | unchanged | unchanged | none | none — **BotID check only.** |
| `adminSetEmailDomainRule(input)` (**new**) | `app/actions/admin.ts` | `requireAdmin()` | new `emailDomainRuleSchema` in `lib/schemas/sponsor.ts`: `{ domain: z.string().trim().toLowerCase().min(3).max(253).regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, 'Enter a bare domain, e.g. acme.com'), rule: z.enum(['block','allow']), reason: z.string().trim().max(LIMITS.notes).optional() }` | `set_email_domain_rule`, `entity_type: 'email_domain_rules'`, metadata `{ domain, rule, previous_rule, reason }` | none |
| `adminDeleteEmailDomainRule(domain)` (**new**) | `app/actions/admin.ts` | `requireAdmin()` | `emailDomainRuleSchema.pick({ domain: true })` | `delete_email_domain_rule`, metadata `{ domain, previous_rule }` | none |

`adminSetEmailDomainRule` is an **upsert on `domain`** through the admin client (the table has
no write policy), setting `created_by = user.id` on insert and refreshing `reason`/`rule` on
conflict. It reads the prior row first so `previous_rule` lands in the audit metadata.

All follow the canonical 5-step shape in `_CONTEXT.md` §7. Never `parse`, always `safeParse`.
`revalidatePath` the admin settings route after each write, matching
`adminCreateSponsor`'s `revalidatePath('/sponsors')` at `app/actions/sponsor.ts:140`.

### Delete the dead action, or wire it up — pick one and say which

`submitSponsorApplication` (`app/actions/sponsor.ts:45-97`) and its
`checkThrottle` helper (`:18-43`) are unreachable, and their existence is precisely why the
honeypot was believed to be protecting the public form. **Delete both, plus
`lib/__tests__/sponsor-application.test.ts`, plus the now-unused `website2` field on
`sponsorApplicationSchema` (`lib/schemas/sponsor.ts:12-17`)** — but leave `website2` on
`sponsorSchema` (`:35-36`) and its input in `components/sponsor/sponsor-form.tsx:87-97`
alone. That one is admin-only and harmless, and removing it is an unrelated change.

The deleted throttle logic is not lost: the identical `check_throttle` calls live on the real
path at `app/actions/auth.ts:313-339`. Move the two honeypot/throttle assertions from the
deleted test file into a new `lib/__tests__/sponsor-domain-gate.test.ts` where they exercise
the live behaviour, so coverage does not silently drop.

If you disagree and would rather keep the action, **stop and report** — do not leave it
half-wired.

## UI

- **`components/auth/sponsor-signup-wizard.tsx`** — under the "Work Email Address" field on
  step 1, a muted helper line: *"Please use your work email — we can't approve sponsor
  accounts on personal addresses."* This is a hint, not a client-side gate: **do not add a
  Zod refinement to `sponsorSignupSchema`.** The list lives in the database and the client
  must never hold a copy that can drift. The authoritative rejection comes from the server
  action and renders in the existing `Alert` at `:352-356`.
- **`app/(admin)/applications/page.tsx`** — on each pending card, next to the existing
  `{app.contact_name} ({app.contact_email})` line (`:59-61`), render a warning badge when
  `domain_match === 'mismatch'`: *"Email domain doesn't match company website"*, plus the two
  domains. Use the `--badge-warning-bg` / `--badge-warning-text` tokens the page already uses
  for the pending count (`:34-36`) — those are the AA-safe pair documented in
  `app/globals.css`. Render `app.website` as a `rel="noreferrer"` link when present.
- **New admin surface for the lists.** Add a section to `app/(admin)/analytics/page.tsx` or a
  new `app/(admin)/admin/domains/page.tsx` — either is fine, pick the one that fits the
  existing `components/admin/admin-sidebar.tsx` navigation and add the nav entry. It renders
  the `email_domain_rules` rows grouped by `rule`, with an add form and a per-row delete.
  Both routes are already inside the authenticated `(admin)` group, so **no `middleware.ts`
  change is required**. Confirm that before assuming it.
- **States, all four required on the new admin surface:** *loading* — `Skeleton` from
  `components/ui/skeleton.tsx`; *empty* — `EmptyState` from `components/ui/empty-state.tsx`,
  the same component `applications/page.tsx:41-50` uses; *error* — the `Alert` idiom, never a
  raw PostgREST message; *permission-denied* — the page lives under `(admin)` and both
  actions re-check with `requireAdmin()` regardless of what the UI shows.
- **Preview fixtures** — `lib/dev-bypass.ts` backs `npm run dev:admin-preview` with a static
  mock Supabase client. Add `email_domain_rules` rows and the four new
  `sponsor_applications` columns to its fixtures, or the new admin block renders against
  `undefined` and the preview mode breaks.

## Out of scope

- Deep Analysis mode. It needs a Pro plan; this slice ships Basic and documents the upgrade.
- MX-record or SMTP verification of the applicant's domain. Network calls in the signup path
  are a latency and outage risk for a marginal signal.
- A Public Suffix List dependency. The two/three-label heuristic is deliberate — see above.
- Any gating, hint, warning, or domain logic on the **coach** path. Hard fence.
- Rate limiting beyond the existing `check_throttle`. No Redis, no Upstash, ever.
- Auto-rejecting a `mismatch` application. It is a warning for a human.
- Blocking role-account local-parts (`info@`, `sales@`). Different problem, different slice.
- Verifying that the applicant actually works at the company whose domain they used. That is
  an out-of-band phone call an admin makes, not a feature.

## Guardrails specific to this slice

- **The coach path stays clean.** Before you finish, run
  `grep -rn "email-domain\|sponsor-domain-gate" app/actions/auth.ts` and confirm every hit is
  inside `createSponsorApplication`. Any hit inside `provisionCoachProfile`,
  `createCoachProfile`, or `completeCoachProfile` is a bug, not a nice-to-have.
- **Fail open on both new checks in the sponsor path.** A BotID outage or a rules-table error
  must let the application through with a Sentry report, exactly as the throttle already
  does. The failure mode of a closed gate here is "no sponsors sign up and nobody notices".
  Do **not** fail open on the coach path's BotID check either — same reasoning, same posture.
- **`checkBotId()` costs nothing in Basic mode but it is a network round-trip.** Call it once
  per action, at the top, never in a loop and never inside `Promise.all` with the throttle
  (the throttle must not run for a request already identified as a bot).
- **CSP.** `next.config.ts` sets `script-src 'self' 'unsafe-inline' …`. Load
  `/sponsors/apply` on a **preview deployment** with the console open and confirm zero CSP
  violations before calling this done. If the challenge script is blocked, add its origin to
  `script-src` and `connect-src` in the same commit — a broken challenge fails humans closed.
- **Never log a full email address** into `audit_log`. Log the domain and the category.
  `audit_log` is admin-readable but it is also the thing exported by `/api/admin/export`.
- **COPPA:** nothing here touches student data. Do not add an applicant free-text field that
  could invite one.
- **`sponsor_applications.contact_email` is UNIQUE** (`0035:18`). The reopen branch at
  `app/actions/auth.ts:416-437` exists because of it. When you add the new columns to that
  `update`, keep the branch's shape — do not convert it to an upsert.
- **`botid` is one new dependency and it must be justified in the commit body**: it is the
  first-party Vercel package for a Vercel-hosted product, replaces nothing already in
  `package.json`, and has no viable in-repo equivalent (a honeypot catches naive form-fillers,
  not headless Chrome). Nothing else gets added — the domain lists are data, not a package.
- **Idempotency:** `ADD COLUMN IF NOT EXISTS … CHECK (…)` is idempotent because the whole
  clause is skipped when the column exists. A bare `ADD CONSTRAINT` is **not** — do not use
  one. The seed uses `ON CONFLICT DO NOTHING` for the same reason.

## Files you will touch

**Create:**
- `supabase/migrations/0089_email_domain_gating.sql`
- `lib/email-domain.ts`
- `lib/sponsor-domain-gate.ts`
- `app/(admin)/admin/domains/page.tsx` (or the equivalent section — see UI)
- `components/admin/email-domain-rules.tsx`
- `lib/__tests__/email-domain.test.ts`
- `lib/__tests__/sponsor-domain-gate.test.ts`
- `tests/e2e/sponsor-domain-gating.spec.ts`

**Modify:**
- `next.config.ts` (wrap with `withBotId`)
- `instrumentation-client.ts` (`initBotId`)
- `app/actions/auth.ts`
- `app/actions/admin.ts`
- `lib/schemas/sponsor.ts`
- `lib/supabase/types.ts`
- `components/auth/sponsor-signup-wizard.tsx`
- `app/(admin)/applications/page.tsx`
- `components/admin/admin-sidebar.tsx`
- `lib/dev-bypass.ts`
- `package.json` (`botid`)

**Delete:**
- `app/actions/sponsor.ts` — `submitSponsorApplication` + `checkThrottle` only; the four
  admin sponsor actions in that file stay
- `lib/__tests__/sponsor-application.test.ts`
- `website2` from `sponsorApplicationSchema` in `lib/schemas/sponsor.ts`

## Tests

**Vitest — `lib/__tests__/email-domain.test.ts`** (pure, no network, no DB):

- `emailDomain('Jane+ftc@Acme.COM')` → `'acme.com'`; `emailDomain('not-an-email')` → `null`.
- `websiteDomain('https://www.acme.com/careers?x=1')` → `'acme.com'`;
  `websiteDomain('acme.com')` → `'acme.com'` (no scheme — the schema permits it).
- `compareDomains('acme.com','acme.com')` → `'match'`.
- `compareDomains('mail.acme.com','acme.com')` → `'related'`.
- `compareDomains('acme.co.uk','acme.co.uk')` → `'match'` — proves the multi-part suffix list
  is reachable and did not collapse to `co.uk`.
- `compareDomains('gmail.com','acme.com')` → `'mismatch'`.
- `compareDomains(null,'acme.com')` → `'unknown'`.

**Vitest — `lib/__tests__/sponsor-domain-gate.test.ts`** (mock the admin client, same
`vi.hoisted` idiom as the deleted `sponsor-application.test.ts:5-31`):

- A `block` row → `{ allowed: false, reason: 'consumer' }` and the message contains the
  `SUPPORT_EMAIL` value.
- An `allow` row on the same domain → `{ allowed: true, reason: 'allowlisted' }`.
  **Allow wins.**
- An unknown domain → `{ allowed: true, reason: 'corporate' }`.
- A rules query that errors → `{ allowed: true }`, `Sentry.captureException` called exactly
  once. **Fails open.**
- Uppercase and `+tag` input is normalized before lookup.

**Playwright — `tests/e2e/sponsor-domain-gating.spec.ts`:**

- **MANDATORY, and the reason this whole scope fence exists:** a coach completes
  `/signup` with a `gmail.com` address end to end and reaches the post-signup destination.
  No domain error appears at any step. Name the test so its purpose is unmissable, e.g.
  `'coach signup accepts a gmail address — volunteers use personal email'`. If this test is
  removed or skipped in a future change, that change is wrong.
- A sponsor applying from a blocked domain sees the rejection copy, and **no**
  `sponsor_applications` row is created for that email.
- After an admin adds an `allow` rule for that domain, the same application succeeds.
- A sponsor whose email domain does not match their website still succeeds, and the admin
  applications page shows the mismatch badge.

**Security-boundary tests — MANDATORY, at the database layer, not only the action layer.**
Run each with a Supabase client carrying the *other* user's Clerk token (the pattern
`tests/global-setup.ts` establishes), and assert PostgREST itself denies:

- A coach `SELECT` on `email_domain_rules` → 0 rows.
- A sponsor `SELECT` on `email_domain_rules` → 0 rows.
- An admin `SELECT` on `email_domain_rules` → the seeded rows.
- A coach or admin `INSERT` / `UPDATE` / `DELETE` on `email_domain_rules` → denied. **An
  admin too** — there is no write policy; admins write through the server action, which uses
  the admin client.
- `adminSetEmailDomainRule` called as a coach returns `{ error: 'Forbidden' }` and the table
  is unchanged afterwards.
- A coach `SELECT` on `sponsor_applications` → 0 rows (the existing `sponsor_apps_select_admin`
  policy from `0001:562` must still hold with the new columns present).

## Acceptance criteria

- [ ] `psql -f supabase/migrations/0089_email_domain_gating.sql` succeeds, and succeeds again
      on a second run with no error and **without re-blocking a domain an admin allowlisted
      in between**. Verify by allowlisting `gmail.com`, replaying, and re-querying the row.
- [ ] `npm run typecheck && npm run lint && npm run build && npm run test` all pass; pasted
      output included in the report.
- [ ] On a **preview deployment**, `/sponsors/apply` loads with **zero CSP violations** in the
      browser console and the BotID challenge script is fetched successfully.
- [ ] A sponsor application submitted from a normal browser on that preview deployment
      **succeeds** — BotID does not reject a real human. This is the single most important
      check in the slice; a false positive here is a total funnel outage.
- [ ] A sponsor applying with a `gmail.com` address is refused with the support-email copy,
      and `SELECT count(*) FROM sponsor_applications WHERE contact_email = …` is 0.
- [ ] After `adminSetEmailDomainRule({ domain: 'gmail.com', rule: 'allow', reason: … })`, the
      same applicant succeeds — **with no redeploy**. Verified by applying, not by reading
      the code.
- [ ] **A coach signs up at `/signup` with a `gmail.com` address and completes the wizard.**
      No domain error at any step, in the UI or the returned action result.
- [ ] A sponsor application where the email domain differs from the supplied website is
      **accepted**, stores `domain_match = 'mismatch'` plus both domains and the `website`,
      and the admin applications page renders the warning badge.
- [ ] A matching application stores `domain_match = 'match'` and shows **no** badge.
- [ ] `audit_log` contains a `set_email_domain_rule` row after an admin edit and a
      `sponsor_application_blocked` row after a rejection — and **neither contains a full
      email address**. Verify by querying the metadata.
- [ ] `grep -rn "submitSponsorApplication" app lib components tests` returns nothing.
- [ ] Every security-boundary test above passes against the real database.
- [ ] `npm run dev:admin-preview` renders the new domain-rules surface and the mismatch badge
      without errors.

## Rollback

1. `vercel rollback` reverts the deployment. It does **not** revert the database.
2. To revert `0089`:
   ```sql
   DROP TABLE IF EXISTS email_domain_rules;   -- policies, trigger and indexes go with it
   DROP INDEX IF EXISTS idx_sponsor_apps_domain_mismatch;
   ALTER TABLE sponsor_applications
     DROP COLUMN IF EXISTS website,
     DROP COLUMN IF EXISTS email_domain,
     DROP COLUMN IF EXISTS website_domain,
     DROP COLUMN IF EXISTS domain_match;
   ```
   Nothing outside this slice reads those columns, so the drop is safe. Pre-launch there is
   no production data to preserve.
3. **To disable BotID without a code revert** (the fast path if it starts rejecting humans):
   add a **bypass rule in the Vercel WAF** for the affected paths. This is a dashboard change
   and takes effect immediately — faster than a redeploy, and it is why the WAF bypass is
   documented rather than a code-level kill switch.
4. To remove BotID in code: unwrap `withBotId` in `next.config.ts`, drop the `initBotId`
   block from `instrumentation-client.ts`, remove the three `checkBotId()` calls, and
   `npm uninstall botid`. No env vars to clean up — BotID has none.
5. **To disable domain gating without a deploy:** `DELETE FROM email_domain_rules WHERE
   rule = 'block';`. The gate then allows everything and the mismatch warning keeps working.
   This is the point of putting the lists in a table.

## Commit

```
feat(sponsor): add Vercel BotID and corporate-email gating to the sponsor path

Wires Vercel BotID (Basic mode, free on all plans) into the sponsor
application and both signup paths, gates sponsor signup on a
database-backed block/allow list of consumer and disposable mail domains
with an admin override, persists the company website the wizard has
always collected, and flags applications whose email domain does not
match that website for admin review.

The public form was NOT protected by the honeypot people assumed: the
action carrying it (submitSponsorApplication) was dead code reachable
only from its own unit test, and the website2 input is rendered solely
in the admin-only SponsorForm. The live path (createSponsorApplication)
had only the check_throttle limits, which stay unchanged.

Coach signup is deliberately excluded from domain gating — volunteers
legitimately use personal email — and a Playwright test pins that.

Adds one dependency, `botid`: first-party Vercel bot protection for a
Vercel-hosted app, with no equivalent already in package.json.
```
