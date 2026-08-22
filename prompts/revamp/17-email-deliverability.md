# Prompt 17 — Email Deliverability: Real Sending Domain, SPF/DKIM/DMARC, Bounce Policy

> **Prerequisites:** None
> **Reserved migration:** none — this slice makes no schema changes
> **Scope:** medium · ~8 files + a DNS zone + a Vercel env change
> **Leaves the repo:** green and shippable on its own

## Why this exists

The obvious stake is inbox placement. That is not the interesting one.

`app/api/webhooks/resend/route.ts` turns Resend delivery events into **submission status
transitions**, and one of those transitions **moves money**. Verified in the real route:

- `EVENT_STATUS_MAP` (`:16-20`) maps `email.delivered → 'delivered'`,
  `email.opened → 'opened'`, `email.bounced → 'bounced'`.
- `delivered` / `opened` take the tracking-only branch (`:111-119`): a plain status update
  fenced by `.in(['dispatched','delivered','opened'])` so a late event cannot overwrite a
  terminal state.
- **`email.bounced` takes a different branch (`:102-110`)** and calls
  `release_submission_reservation(p_submission_id, p_new_status: 'bounced', p_reason:
  'email_bounced')`. Per `_CONTEXT.md` §4 that RPC **subtracts `reserved_amount_cents` from
  `sponsors.funding_used_cents`, zeroes the reservation, and re-activates a sponsor that had
  been flipped to `inactive` at cap.**

So the precise claim, stated carefully: **a bounce on a dispatched pitch does not merely fail
to reach the sponsor — it releases that sponsor's reserved capacity and returns the
submission to a dead end.** The reservation was created by an admin approving the pitch
(`approve_submission_atomic`); a mail-server rejection undoes that decision with no human in
the loop. That behaviour is *correct* — a pitch that never arrived should not hold capacity —
which is exactly why it is dangerous when bounces are caused by **our** sending reputation
rather than by a genuinely bad recipient address. Poor deliverability does not degrade
gracefully here. It corrupts the funding state machine.

The RPC is guarded to live states only (`dispatched|delivered|opened`), so a bounce can never
revert an already-funded `approved` deal — the comment at `route.ts:103-104` documents that
and it holds. The exposure is narrower than "we lose money" and worse than "an email got
filtered": **every dispatched-but-not-yet-decided pitch is one spam-filter rejection away
from being cancelled.**

Add to that: today the product sends from whatever `RESEND_FROM_EMAIL` is set to, on a
domain that has never been through SPF/DKIM/DMARC setup, with links pointing at
`ftc-sponsorship-portal.vercel.app`. The recipients are **corporate mail systems** —
Microsoft 365 and Google Workspace tenants with aggressive filtering, the least forgiving
audience there is.

## Current state (verified)

### The webhook signature IS verified — there is no gap to fix

You were asked to check this. The answer is that the route is already correct, and the
details matter enough to write down rather than re-derive later:

`app/api/webhooks/resend/route.ts:22-48` reads the raw body with `req.text()` (not
`req.json()` — required, because svix signs the exact bytes), collects `svix-id`,
`svix-timestamp`, `svix-signature`, and then:

- If `env.RESEND_WEBHOOK_SECRET` is **unset and `NODE_ENV !== 'development'`** → logs, reports
  to Sentry, and returns **503**. It does not process the payload. (`:31-38`)
- If unset in development → warns and skips verification. Local-only, and correct.
- Otherwise → `new Webhook(env.RESEND_WEBHOOK_SECRET).verify(payload, svixHeaders)` inside a
  `try/catch`; any failure returns **400 Invalid signature**. (`:39-48`)

`lib/env.ts:37-53` backs this with a `superRefine` that makes `RESEND_WEBHOOK_SECRET`
**required in production** even though the field is `.optional()` for dev. And
`middleware.ts:15` has `/api/webhooks(.*)` in the public matcher, so the route is reachable
unauthenticated — as it must be — with the signature as the only gate. That is the right
design and it is implemented. `svix@^1.96.0` is already in `package.json`.

**Do not "harden" this. There is nothing to harden.** Report it as verified-correct.

### The one real webhook gap: spam complaints are silently discarded

`EVENT_STATUS_MAP` has exactly three entries. Any other event type falls through
`if (!newStatus) return NextResponse.json({ success: true, skipped: true })` at `:61-63`.

That means **`email.complained` — a recipient clicking "Report spam" — is acknowledged with a
200 and thrown away.** No audit row, no admin alert, no signal anywhere in the product. A
spam complaint from a corporate sponsor is the single highest-value deliverability event
there is: it is the leading indicator that the domain's reputation is about to collapse, and
under Gmail's and Microsoft's sender rules a sustained complaint rate above roughly 0.3% gets
the domain throttled or blocked outright. Resend also auto-suppresses that address, so the
sponsor stops receiving anything and the product never learns why.

`email.delivery_delayed` (a soft bounce — full mailbox, transient server error) is likewise
dropped. That one is genuinely fine to ignore: Resend retries and emits `email.bounced` if it
ultimately fails. Note it in the runbook and leave the code alone.

### `replyTo` is wired on exactly two senders, not everywhere

You were asked to verify the `replyTo` wiring "still routes replies to humans". It does where
it exists, and it exists in two places:

- `lib/dispatch.ts:83` — `options?.replyTo ?? coachProfile?.email ?? SUPPORT_EMAIL`. The
  sponsor pitch replies reach the coach.
- `lib/notify.ts:201-222` — the handshake pair, cross-wired: the coach's copy replies to the
  sponsor (`:206`), the sponsor's copy replies to the coach (`:216`), each falling back to
  `SUPPORT_EMAIL`. Both carry sha256 `idempotencyKey`s.

**Every other sender in `lib/notify.ts` sets no `replyTo` at all**:
`sendSubmissionDecisionEmail` (`:114-124`), `sendCredentialUploadAlert` (`:142-151`),
`sendSponsorApplicationConfirmation` (`:243-252`), `createInAppNotification`'s email mirror
(`:296-306`), `sendCoachDenialEmail` (`:328-333`), `sendCoachVerificationEmail` (`:353-358`),
`sendSponsorApplicationAlert` (`:377-388`), `sendCoachSignupWelcomeEmail` (`:398-403`).
Those all reply into the `noreply@` void.

For most of them that is defensible — they say "open the portal", not "reply to us". Two are
not: `sendCoachDenialEmail` tells a coach their application needs work, and
`sendSponsorApplicationConfirmation` is the first thing a prospective sponsor ever receives.
Both should reply to `SUPPORT_EMAIL`. Beyond the human cost, **a `From` address whose replies
bounce is itself a mild negative reputation signal** with several providers, which is what
makes it in scope for this slice rather than a separate one.

### `RESEND_FROM_EMAIL` is hard-gated on `noreply@` in production

`lib/env.ts:78-84`:

```ts
if (
  process.env.NODE_ENV === 'production' &&
  !isBuildPhase &&
  !result.data.RESEND_FROM_EMAIL.toLowerCase().startsWith('noreply@')
) {
  throw new Error('RESEND_FROM_EMAIL must use a noreply@ address in production.')
}
```

This throws **on the first request**, not at build time (`isBuildPhase` defers it), and
`lib/env.ts` is imported by every request path. So setting `RESEND_FROM_EMAIL` to
`hello@send.yourdomain.org` in Vercel **takes the entire site down**, not just email. This is
the sharpest operational trap in the slice. The new value must be
`noreply@send.<yourdomain>` — lowercase, with the `noreply@` local part preserved.

The check is case-insensitive on the local part but the value must still parse as an email
(`lib/env.ts:18`, `z.string().email()`), and there is no display-name support in that schema —
`"FTC Pitfund <noreply@send.example.org>"` would **fail the Zod email check** and take
production down the same way. If a display name is wanted, it must be added to the templates'
`from` construction, not to the env var. Out of scope here; note it.

### Links in every email point at the deploy URL

`env.NEXT_PUBLIC_APP_URL` is the CTA base in `lib/notify.ts:149`, `:303`, `:384` and
`lib/dispatch.ts:67` (the `/sponsor-view/{token}` link — the single most important link the
product sends). If the sending domain becomes `send.example.org` while every link still
points at `ftc-sponsorship-portal.vercel.app`, the message has a **From/link domain
mismatch**, which is a well-known spam heuristic and looks like a phish to a corporate
security filter. Aligning them is part of this work, or at minimum an explicitly recorded
decision not to.

### Not present today

- No `docs/` runbook for any of this. `ls docs/` shows only `REMEDIATION-LOG.md`
  (referenced from `app/layout.tsx:38`). Everything below currently lives in one person's
  head, which is the actual reason this prompt exists.
- No DMARC policy of any kind on the sending domain.
- No documented bounce/complaint response procedure.
- No suppression-list ownership statement.

## What you are building

Mostly configuration, DNS, and a committed runbook. Three small code changes, all of them
justified by a verified gap above.

1. **A verified Resend sending domain on a dedicated `send.` subdomain**, with SPF, DKIM,
   MAIL FROM, and DMARC records.
2. **A DMARC ramp** from `p=none` → `p=quarantine` → `p=reject`, with the criteria for each
   step written down rather than guessed at.
3. **`RESEND_FROM_EMAIL` cut over in Vercel**, respecting the `noreply@` trap.
4. **`email.complained` handling** in the existing webhook — audit row + admin notification.
5. **`replyTo: SUPPORT_EMAIL`** on the two senders that invite a reply and lack it.
6. **`docs/email-deliverability.md`** — the runbook, committed to the repo.

### 1. Domain and DNS

Use a **dedicated transactional subdomain**, `send.<yourdomain>`, and add it in Resend as its
own domain. Resend recommends this explicitly, and the reason is reputation isolation: the
root domain's reputation (which carries your human mail, and any future marketing sending)
does not absorb damage from a transactional bounce spike, and vice versa. It also gives you a
clean blast radius — if `send.` gets blocked you can stand up `mail.` without touching the
apex.

Resend generates the exact values in its dashboard when you add the domain. The **shape** is
fixed; the region host and the DKIM key are not — copy them from the dashboard, never from
this document:

| Type | Host / Name | Value | Notes |
|---|---|---|---|
| `TXT` | `resend._domainkey.send` | `p=<long base64 key from Resend>` | **DKIM.** Copy verbatim; a single wrapped character breaks it. |
| `MX` | `send.send` *(see note)* | `feedback-smtp.<region>.amazonses.com`, priority `10` | **MAIL FROM / bounce feedback.** Region is whichever Resend region you selected (`us-east-1`, `eu-west-1`, `sa-east-1`, `ap-northeast-1`). |
| `TXT` | `send.send` *(see note)* | `v=spf1 include:amazonses.com ~all` | **SPF** for the MAIL FROM subdomain. |
| `TXT` | `_dmarc.send` | `v=DMARC1; p=none; rua=mailto:dmarc@<yourdomain>; fo=1; adkim=r; aspf=r` | **DMARC.** Start at `p=none`. See the ramp below. |

**The host-name note is where people lose an afternoon.** Resend displays record names
*relative to the domain you registered*. Register `send.example.org` and Resend shows
`resend._domainkey` and `send`; most DNS providers then want those pasted as-is and will
append the zone themselves, producing `resend._domainkey.send.example.org`. Some providers
(and any zone file you edit by hand) want the fully-qualified name. **Paste what your
provider expects, then verify with `dig` before clicking Verify in Resend** — the
instructions in this table are written fully-qualified relative to the apex on purpose so you
can check them against `dig` output.

Verification commands, to be run and their output pasted into the runbook:

```bash
dig +short TXT  resend._domainkey.send.example.org
dig +short MX   send.send.example.org
dig +short TXT  send.send.example.org
dig +short TXT  _dmarc.send.example.org
```

**`~all` (softfail), not `-all` (hardfail), on SPF.** A hardfail on a subdomain you have just
configured, sending through a provider whose IP ranges you do not control, is how you cause
the outage you are trying to prevent. `~all` plus a passing DKIM signature is what DMARC
actually evaluates, and DKIM is the durable one — it survives forwarding, SPF does not.

### 2. The DMARC ramp

`rua` reports are aggregate XML sent daily by receiving providers. You need somewhere to read
them: a plain mailbox works but the XML is unreadable by hand — point `rua` at a free
aggregator, or at a mailbox you commit to actually opening. **A `rua` address nobody reads
makes the whole ramp theatre.** Record which one you chose in the runbook.

| Stage | Record | Advance when |
|---|---|---|
| **1. Monitor** | `p=none; rua=…; fo=1` | Ship here. Leave it for **at least 14 days of real sending**. |
| **2. Quarantine** | `p=quarantine; pct=100; rua=…` | ≥14 days of aggregate reports show **100% DKIM alignment** on every source you recognise, and **zero legitimate sources you cannot explain**. If an unexplained source appears, find it before advancing — it is either a forgotten sender or someone spoofing you. |
| **3. Reject** | `p=reject; rua=…` | ≥30 further days at `quarantine` with no legitimate mail quarantined and no complaints from recipients. |

Do not skip to `p=reject`. Pre-launch there is no production traffic, so the reports will be
empty and the ramp will be tempting to compress — that is exactly the situation in which you
publish a `reject` policy and then discover, at first real sponsor contact, that something
legitimate was never aligned. Record the date of each advance in the runbook.

Also set the **apex** to `v=DMARC1; p=none; rua=…` if it has no record. A domain with no
DMARC at the apex is a spoofing target regardless of what the subdomain publishes, and
subdomain policies do not protect the parent.

### 3. `RESEND_FROM_EMAIL` cutover — the noreply trap

```bash
vercel env rm  RESEND_FROM_EMAIL production
vercel env add RESEND_FROM_EMAIL production    # value: noreply@send.example.org
vercel deploy --prod --yes                     # deploys are MANUAL; pushing to main does nothing
```

**The value must begin with `noreply@` and must be a bare address with no display name.**
Anything else throws out of `lib/env.ts:78-84` on the first request in production and 500s
every route, not just email. Verify by hitting `/api/health` immediately after the deploy,
before doing anything else.

Order matters: **verify the domain in Resend first, then change the env var.** Reversed, you
have a production `From` on an unverified domain, and Resend rejects the send — which means
`dispatchApprovedSubmission` returns `{ success: false }` and admin approvals stop reaching
sponsors.

`NEXT_PUBLIC_APP_URL` should move to a custom domain in the same window so links and `From`
align. If you are not ready to move it, **write that decision and its reason into the
runbook** — it is a known, accepted spam signal, not an oversight.

### 4. `email.complained` — the one substantive code change

In `app/api/webhooks/resend/route.ts`, handle `email.complained` **before** the
`if (!newStatus)` early return at `:61-63`, since it deliberately has no status mapping —
a complaint must not change the submission's status. A sponsor who reported the pitch as
spam still received it; overwriting `delivered` would be a lie, and routing it through
`release_submission_reservation` would hand a capacity release to anyone who hits the spam
button.

What it does instead:

- Writes an `audit_log` row via the admin client: `actor_id: null`,
  `action: 'resend_webhook_email.complained'`, `entity_type: 'submissions'`,
  `entity_id: submissionId`, metadata `{ resend_email_id, webhook_type }`. This reuses the
  existing action-naming convention at `:121-127` **and** slots into the existing idempotency
  check at `:88-100` for free — that check queries `audit_log` by
  `action = 'resend_webhook_' + type` and the `resend_email_id` in metadata, so a svix retry
  is deduped with no extra code.
- Notifies every admin via `createInAppNotification({ type: 'general', … })`, resolving
  recipients with the `profiles.role='admin'` query pattern already used at
  `app/actions/auth.ts:465-478`. **Leave `skipEmail` at its default `false`** — an admin
  needs to hear about this out-of-band, and the irony of emailing about a deliverability
  problem is acceptable because the admin mailbox is not the one that complained.
- Returns `{ success: true, complained: true }`.

Both `email.complained` and hard bounces cause **Resend to add the address to your
account-level suppression list automatically.** Nothing in this repo needs to store one, and
nothing should — that is why this slice has no schema change. The runbook documents where the
list lives and who is allowed to remove an address from it.

Handle `email.delivery_delayed` by continuing to ignore it. Resend retries soft bounces and
emits `email.bounced` if delivery ultimately fails; acting on a delay would release capacity
for a mailbox that is merely full. Say so in a comment so the next person does not "fix" it.

### 5. `replyTo` on the two senders that invite a reply

- `sendCoachDenialEmail` (`lib/notify.ts:328-333`) → `replyTo: SUPPORT_EMAIL`.
- `sendSponsorApplicationConfirmation` (`lib/notify.ts:243-252`) → `replyTo: SUPPORT_EMAIL`.

`SUPPORT_EMAIL` is already imported at `lib/notify.ts:14`. Two one-line additions. Leave the
other six senders alone — they are portal-CTA emails and adding `replyTo` to all of them is
scope creep with no deliverability payoff.

### 6. Plain-text part — verify, then decide

A `text/plain` alternative alongside the HTML is a modest but real positive signal, and some
corporate gateways score HTML-only mail down. Every sender in this repo passes `react:` and
no `text:`. **Check whether Resend is generating a plain-text part** — send one message to a
test address and inspect the raw source for `Content-Type: multipart/alternative`. If it is
already multipart, do nothing and record that finding in the runbook. If it is HTML-only, add
`text:` to `dispatchApprovedSubmission` and `sendHandshakeEmail` only — the two
highest-stakes messages — using `htmlToPlainText` from `lib/utils.ts`, which the codebase
already uses for exactly this kind of conversion. Do not retrofit all nine templates.

## Data model

None — no schema changes.

## Server actions

None. This slice touches one route handler (`app/api/webhooks/resend/route.ts`) and two
senders in `lib/notify.ts`. No `app/actions/*.ts` file changes, no new Zod schema, no new
guard.

## UI

None. The only user-visible surface is the admin in-app notification produced by the new
`email.complained` branch, which renders through the existing notifications inbox with no
component changes.

## Deliverables checklist (the non-code half)

- [ ] `send.<yourdomain>` added and showing **Verified** in the Resend dashboard.
- [ ] All four DNS records present and resolving; `dig` output pasted into the runbook.
- [ ] Apex DMARC record present at `p=none`.
- [ ] `rua` destination chosen, reachable, and named in the runbook — with the name of the
      person who reads it.
- [ ] `RESEND_FROM_EMAIL` = `noreply@send.<yourdomain>` in Vercel **production**, deployed,
      and `/api/health` returning 200 afterwards.
- [ ] `RESEND_WEBHOOK_SECRET` confirmed still set in Vercel production. Adding a domain does
      not change it, but confirm it — `lib/env.ts:37-53` makes production throw without it,
      and the webhook 503s.
- [ ] Resend webhook endpoint confirmed pointing at
      `https://<prod-host>/api/webhooks/resend` and subscribed to **`email.delivered`,
      `email.opened`, `email.bounced`, and `email.complained`**. The fourth is new — the code
      change is inert if the event is never sent.
- [ ] `docs/email-deliverability.md` committed.

## The runbook — `docs/email-deliverability.md`

Committed to the repo, because this knowledge otherwise lives in one person's head and the
whole point of the slice is that it stops doing so. Required sections:

1. **Why this matters here** — the bounce → `release_submission_reservation` chain, in three
   sentences, with the file and line reference. Anyone who edits the webhook must hit this.
2. **The sending domain** — which domain, which Resend region, the four DNS records with
   their real values, and the `dig` commands to re-verify them.
3. **DMARC state** — current policy, the date it was last advanced, the criteria for the next
   advance, and where `rua` reports go and who reads them.
4. **Env vars** — `RESEND_FROM_EMAIL` (with the `noreply@` trap in bold, and the
   `lib/env.ts:78-84` reference), `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, and the reminder
   that every one of them lives in Vercel and that **deploys are manual**
   (`vercel deploy --prod --yes`).
5. **Webhook events** — the four subscribed types, what each does in the code, and an explicit
   note that `email.delivery_delayed` is ignored **on purpose**.
6. **Bounce and complaint policy** — see below.
7. **Suppression list** — it lives in Resend, it is account-level and automatic, and removing
   an address from it requires confirming the recipient asked to be re-added. Never bulk-clear
   it: re-sending to a hard-bounced address is the fastest way to get a domain blocked.
8. **Verification checklist** — see below.
9. **What to do when deliverability degrades** — the ordered triage list.

### Bounce and complaint policy

| Event | Automatic behaviour | Human action |
|---|---|---|
| **Hard bounce** (`email.bounced`) on a dispatched pitch | Reservation released, submission → `bounced`, capacity returned to the sponsor, `audit_log` row written | Admin checks whether `sponsors.contact_email` is simply wrong. If so, correct it and re-dispatch. **If two or more sponsors bounce in a week, stop dispatching and treat it as a reputation incident** — that is not a coincidence, it is a blocklist. |
| **Soft bounce** (`email.delivery_delayed`) | Ignored. Resend retries. | None unless it converts to a hard bounce. |
| **Spam complaint** (`email.complained`) | `audit_log` row + admin in-app notification. **Status unchanged.** Resend auto-suppresses the address. | Admin contacts the sponsor out of band. Do not re-send. **One complaint is a conversation; three in a month is a policy problem with the outreach itself, not with DNS.** |
| **Complaint rate** > 0.1% over 30 days | none | Pause non-essential sending, review `dispatchApprovedSubmission` volume and targeting. Gmail's published threshold is 0.3%; 0.1% is the point at which you still have time to act. |

Percentages here are of *delivered* mail, computed from Resend's dashboard. With pre-launch
volumes a single complaint will blow past any percentage threshold — the runbook must say
that the rate is only meaningful above roughly 500 sends in the window, and that below that
the rule is simply "investigate every single complaint".

### Verification checklist

Run before declaring the slice done, and again after any DNS change:

1. **Resend dashboard** — domain shows Verified, all records green.
2. **`dig`** — all four records resolve to the expected values from a machine outside your
   network. A record that resolves for you and not for the world is a split-horizon DNS
   problem and it is common.
3. **mail-tester.com** — send one real message from the production app to the address it
   gives you. Target **10/10**; **9/10 or better is the pass bar**, and any point lost to
   SPF, DKIM, DMARC, or reverse DNS is a hard fail regardless of the total. Points lost to
   "no unsubscribe link" on transactional mail are acceptable — note the score breakdown in
   the runbook rather than just the number.
4. **Gmail raw-source inspection** — send to a real Gmail address, open *Show original*, and
   confirm three lines: `SPF: PASS`, `DKIM: PASS`, `DMARC: PASS`. Screenshot into the runbook.
5. **Microsoft 365 inspection** — the same, to a real corporate 365 mailbox if you can borrow
   one. **This is the audience that actually matters** and it filters differently from Gmail.
6. **Google Postmaster Tools** — register `send.<yourdomain>` (requires a TXT verification
   record on the domain). It shows nothing until real volume arrives, which is precisely why
   you register it **now** rather than during an incident. Record the console URL and who has
   access.
7. **Webhook round-trip** — send a Resend test event for `email.complained` from the
   dashboard and confirm an `audit_log` row appears and an admin notification lands. Then
   confirm an **unsigned** POST to `/api/webhooks/resend` returns **400**, and that removing
   `RESEND_WEBHOOK_SECRET` would return **503** rather than processing (reason through
   `route.ts:31-38`; do not actually unset it in production to test this).

## Out of scope

- Migrating away from Resend, or adding a second ESP for failover.
- A database-backed suppression list. Resend owns suppression; duplicating it is a
  consistency bug waiting to happen, and this slice has no schema change by design.
- Marketing/bulk email, `List-Unsubscribe` headers, and one-click unsubscribe. Everything this
  product sends is transactional. Revisit only if a newsletter is ever added — Gmail's bulk
  sender requirements bite at 5,000 messages/day and nothing here is close.
- Rewriting the nine `emails/*.tsx` templates for rendering compatibility across clients.
  Real, separate, larger.
- Adding `replyTo` to the six senders that legitimately do not need it.
- Moving `NEXT_PUBLIC_APP_URL` to a custom domain — recommended and *recorded* here, but the
  DNS and Vercel domain work is its own change with its own rollback.
- BIMI. It requires a VMC certificate and a registered trademark.
- Touching `release_submission_reservation` or any part of the capacity model. `_CONTEXT.md`
  §4 is explicit that this logic is already implemented and that only prompt `11` verifies it.

## Guardrails specific to this slice

- **`RESEND_FROM_EMAIL` must start with `noreply@`.** `lib/env.ts:78-84` throws on the first
  production request otherwise, and `lib/env.ts` is on every request path — this is a
  full-site outage, not an email outage. No display name either: `lib/env.ts:18` is a bare
  `z.string().email()`.
- **Verify the domain in Resend before changing the env var.** Reversed, admin approvals stop
  reaching sponsors silently — `dispatchApprovedSubmission` returns
  `{ success: false }` and never throws (`lib/dispatch.ts:19-29`).
- **Never make the webhook fail closed on an unrecognised event type.** The current
  `return { success: true, skipped: true }` at `:61-63` is correct: a non-200 makes svix retry
  forever. Add `email.complained` as a branch *before* that return, do not replace it.
- **`email.complained` must not touch submission status and must not call
  `release_submission_reservation`.** A complaint would otherwise become a
  capacity-release primitive triggerable by any recipient with a spam button.
- **The webhook body must keep being read with `req.text()`** (`:23`). Switching to
  `req.json()` invalidates the svix signature over the exact bytes and every event starts
  400ing.
- **Do not weaken the dev-only signature bypass at `:31-38`.** The `NODE_ENV !== 'development'`
  guard is what keeps it from ever applying in production.
- **Deploys are manual.** `vercel deploy --prod --yes`. A DNS change plus a Vercel env change
  with no deploy leaves production reading the old value — the env var is read at module load.
- **DNS propagation is not instant.** Verify with `dig` against a public resolver
  (`dig @1.1.1.1 …`) before clicking Verify in Resend; a failed verification puts the domain
  into a state you then have to wait out.
- **Pre-launch there is no production data and no sending history**, which is an advantage:
  you get to establish reputation from zero on a clean subdomain. It also means the DMARC ramp
  has no traffic to observe, so the 14-day monitor window starts at **first real sending**,
  not at the date the record was published. Write that date in the runbook.
- **No new dependencies.** `svix` and `resend` are already in `package.json`. Nothing in this
  slice needs a package.

## Files you will touch

**Create:**
- `docs/email-deliverability.md`
- `lib/__tests__/resend-webhook-complained.test.ts`

**Modify:**
- `app/api/webhooks/resend/route.ts`
- `lib/notify.ts` (two `replyTo` additions; optionally `text:` on the two high-stakes senders)

**Configure (no file changes):**
- Resend dashboard — add and verify `send.<yourdomain>`; subscribe the webhook to
  `email.complained`
- DNS zone — DKIM, MAIL FROM MX, SPF, DMARC on `send.`; DMARC on the apex
- Vercel — `RESEND_FROM_EMAIL`
- Google Postmaster Tools — register the sending domain

## Tests

**Vitest — `lib/__tests__/resend-webhook-complained.test.ts`.** Mock `svix`'s `Webhook.verify`
to a no-op and the admin client with the `vi.hoisted` idiom used by the existing tests in
`lib/__tests__/`:

- An `email.complained` payload matching a submission writes an `audit_log` row with
  `action = 'resend_webhook_email.complained'` and calls `createInAppNotification` once per
  admin.
- The same payload **does not** call `release_submission_reservation` and **does not** update
  `submissions.status`. Assert both negatively — this is the guardrail the test exists for.
- A repeated `email.complained` with the same `email_id` is deduped by the existing
  `audit_log` idempotency check (`route.ts:88-100`) and inserts nothing the second time.
- An unrecognised event type (`email.delivery_delayed`) still returns
  `{ success: true, skipped: true }` and writes nothing.
- An `email.bounced` payload still calls `release_submission_reservation` with
  `p_new_status: 'bounced'` — a regression guard on the behaviour this slice is explicitly
  *not* changing.

**Manual, and recorded in the runbook rather than automated** (these need real DNS and a real
mail provider, and a test that requires those is a test that will be skipped):

- mail-tester score with the breakdown.
- Gmail *Show original* showing SPF/DKIM/DMARC all PASS.
- Microsoft 365 equivalent.
- A Resend dashboard test event for `email.complained` producing the audit row and the admin
  notification in the live app.

## Acceptance criteria

- [ ] `npm run typecheck && npm run lint && npm run build && npm run test` all pass; pasted
      output included in the report.
- [ ] `send.<yourdomain>` shows **Verified** in Resend, and `dig` output for all four records
      is pasted into `docs/email-deliverability.md`.
- [ ] A real message sent from production scores **≥ 9/10 on mail-tester**, with **zero**
      points lost to SPF, DKIM, DMARC, or reverse DNS. The full breakdown is in the runbook.
- [ ] Gmail *Show original* on a production-sent message shows `SPF: PASS`, `DKIM: PASS`,
      `DMARC: PASS`. Screenshot in the runbook.
- [ ] `RESEND_FROM_EMAIL` in Vercel production begins with `noreply@` and uses the new
      subdomain, **and `/api/health` returns 200 after the deploy** — proving `lib/env.ts`
      did not throw.
- [ ] A Resend test `email.complained` event produces exactly one `audit_log` row with
      `action = 'resend_webhook_email.complained'`, one in-app notification per admin, and
      **no change to the submission's `status` and no change to
      `sponsors.funding_used_cents`**. Verified by querying both, before and after.
- [ ] A Resend test `email.bounced` event still releases the reservation — confirmed by
      reading `sponsors.funding_used_cents` before and after. The slice must not have broken
      the behaviour it is written around.
- [ ] An unsigned POST to `/api/webhooks/resend` returns **400**.
- [ ] `docs/email-deliverability.md` exists and contains every numbered section listed above,
      with **real values filled in** — no `<yourdomain>` placeholders left behind.
- [ ] `send.<yourdomain>` is registered in Google Postmaster Tools and the console URL is in
      the runbook.
- [ ] DMARC is at `p=none` with a working `rua`, and the runbook names the date the 14-day
      monitor window starts and the person who reads the reports.

## Rollback

1. **Revert the `From` address first, not the DNS.** `vercel env rm RESEND_FROM_EMAIL
   production`, re-add the previous value, `vercel deploy --prod --yes`. Sending resumes on
   the old identity immediately. Leaving the DNS records in place is harmless.
2. **Roll DMARC back before removing anything else.** If legitimate mail starts disappearing,
   set `_dmarc.send` to `v=DMARC1; p=none; rua=…` — one TXT edit, effective within the record's
   TTL. **Keep the TTL at 300s during the ramp** specifically so this rollback is fast; raise
   it only once you reach `p=reject` and are confident.
3. Removing the DKIM/SPF/MX records is a last resort and makes deliverability **worse**, not
   better — an unsigned message from a domain that recently signed is more suspicious than one
   that never did. Only do it if the subdomain is being retired entirely.
4. **To revert the code:** `git revert` the commit. The `email.complained` branch is additive
   and inert unless Resend is subscribed to that event, so unsubscribing it in the Resend
   dashboard is an even faster no-deploy disable.
5. **No database rollback exists or is needed** — this slice has no migration. `audit_log`
   rows written by the new branch are append-only records of real events and should be left
   in place.
6. `vercel rollback` reverts the deployment but **not** DNS and **not** the Resend dashboard
   configuration. Those are the two things it cannot undo; do them by hand in the order above.

## Commit

```
docs(email): establish a real sending domain, DMARC ramp, and deliverability runbook

Moves transactional sending onto a dedicated send. subdomain with SPF,
DKIM, MAIL FROM and DMARC (starting at p=none with rua reporting and a
documented ramp to quarantine then reject), and commits the whole
procedure to docs/email-deliverability.md so it stops living in one
person's head.

Deliverability is not cosmetic here: app/api/webhooks/resend/route.ts
turns email.bounced into release_submission_reservation, which returns a
sponsor's reserved capacity and dead-ends the pitch. A filtered message
therefore cancels an admin-approved dispatch. The webhook's svix
signature verification was checked and is already correct — no change
was needed there.

Also handles email.complained, which the webhook previously acknowledged
and discarded: it now writes an audit row and alerts admins, without
touching submission status or capacity. Adds replyTo: SUPPORT_EMAIL to
the two senders that invite a reply and had none.
```
