# Email deliverability runbook

Owner: Anish Yarrakonda (`exodiusftc@gmail.com`). Last verified: **2026-08-14**.

Everything here was measured against live DNS, not copied from a template. Where a value
could not be verified from this machine (anything needing a production send or a mailbox we
control), it is listed in §10 as an open operator action rather than guessed at.

---

## 1. Why this matters here

This is not about inbox aesthetics. **A bounce moves money.**

`app/api/webhooks/resend/route.ts` turns Resend delivery events into submission status
transitions. `email.bounced` on a dispatched pitch calls
`release_submission_reservation(p_submission_id, p_new_status: 'bounced', p_reason:
'email_bounced')`, which subtracts `reserved_amount_cents` from `sponsors.funding_used_cents`,
zeroes the reservation, and re-activates a sponsor that had been flipped to `inactive` at cap.

That behaviour is correct — a pitch that never arrived should not hold a sponsor's capacity —
which is exactly why it is dangerous when the bounce is caused by **our sending reputation**
rather than by a genuinely bad address. Poor deliverability does not degrade gracefully here:
**every dispatched-but-not-yet-decided pitch is one spam-filter rejection away from being
cancelled**, with no human in the loop, undoing an admin approval.

The RPC is guarded to live states (`dispatched | delivered | opened`), so a bounce can never
revert an already-funded `approved` deal. The exposure is narrower than "we lose money" and
much worse than "an email got filtered".

**If you are editing that webhook, read this section first.**

---

## 2. The sending domain

| | |
|---|---|
| Resend domain | **`exodiusftc.com`** (apex) |
| Resend region | **`us-east-1`** (from the MAIL FROM MX host) |
| MAIL FROM subdomain | **`send.exodiusftc.com`** — this is the Return-Path / bounce-feedback domain Resend provisions for the apex. It is *not* a second sending domain. |
| From address | `noreply@exodiusftc.com` (`RESEND_FROM_EMAIL`) |
| Reply-to | `exodiusftc@gmail.com` (`SUPPORT_EMAIL`, `lib/site-config.ts`) |
| DNS host | **GoDaddy** (`ns13.domaincontrol.com`, `ns14.domaincontrol.com`) |
| Apex web | Netlify (`www` → `exodius-ftc.netlify.app`, apex A → `75.2.60.5`) — the public team site, unrelated to the portal |
| Apex MX | **none.** Nothing can receive mail at `@exodiusftc.com`, which is why `SUPPORT_EMAIL` is a Gmail address. |

### 2.1 Why the apex and not a dedicated `send.` sending domain

The usual advice — and prompt 17's original instruction — is to register a dedicated
`send.<domain>` in Resend for reputation isolation. **We are deliberately not doing that**, and
this is the reasoning, recorded so it is not relitigated:

- The apex is **already verified in Resend and already sending** (`noreply@exodiusftc.com`).
  Migrating means re-verifying, cutting over `RESEND_FROM_EMAIL`, and starting reputation from
  zero again — real outage risk (see §4) for a benefit that does not apply here.
- Reputation isolation protects an apex that carries *human* mail or marketing. `exodiusftc.com`
  has **no MX record at all** and sends nothing but this product's transactional mail. There is
  nothing on the apex to isolate it from.
- Resend has already provisioned `send.exodiusftc.com` as the apex's MAIL FROM subdomain.
  Registering that exact name as a *separate* Resend domain would layer a second set of records
  on a name that is already load-bearing — the confusing failure mode, not the safe one.

Revisit this only if a newsletter or human mailboxes are ever added to `exodiusftc.com`. At that
point, stand up `mail.exodiusftc.com` as a new Resend domain and move `RESEND_FROM_EMAIL` to it
following §4.

### 2.2 The live records (verified 2026-08-14 against `1.1.1.1` and `8.8.8.8`)

```
$ dig @1.1.1.1 +short TXT resend._domainkey.exodiusftc.com
"p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgw1+mfFGck2Yepm//RjTkUaKOOxuN2juQ/lEuRL8s5Z/HzJ+mcrpLwf/f4kQCCkhRFmAWnqTp5r+ebdlih1Rg2/X9iQE/ar/GFlImHtV6ybqT6DxlZpyQoy51G8tyf3CFiem/duvevv3s5LpiIPgmdPTARjxgoZDpKiVhJ5IrVwIDAQAB"

$ dig @1.1.1.1 +short MX send.exodiusftc.com
10 feedback-smtp.us-east-1.amazonses.com.

$ dig @1.1.1.1 +short TXT send.exodiusftc.com
"v=spf1 include:dc-fd741b8612._spfm.send.exodiusftc.com ~all"

$ dig @1.1.1.1 +short TXT dc-fd741b8612._spfm.send.exodiusftc.com     # the include target
"v=spf1 include:amazonses.com ~all"
```

Notes on what you are looking at:

- The **DKIM** record has no `v=DKIM1; k=rsa;` prefix. That is Resend's normal format and is
  valid — both fields default correctly. Do not "fix" it.
- The **SPF** record uses Resend's managed-SPF indirection (`_spfm`) rather than a literal
  `include:amazonses.com`. It resolves to `v=spf1 include:amazonses.com ~all`, so it behaves
  identically while letting Resend change their sending infrastructure without a DNS edit here.
- `~all` (softfail), **not** `-all`. A hardfail on a provider whose IP ranges we do not control
  is how you cause the outage you were trying to prevent. DKIM is the durable signal anyway — it
  survives forwarding, SPF does not.
- SPF is evaluated against the **envelope** sender (`send.exodiusftc.com`), not the header
  `From` (`exodiusftc.com`). They align under DMARC's relaxed `aspf` because they share an
  organizational domain. This is why the apex needs no SPF record for mail to pass.
- TTLs are 3600s on the SPF TXT and ~3600s on the MX.

### 2.3 Re-verification command

Paste-and-run. Anything empty that should not be is an incident.

```bash
for r in \
  "TXT resend._domainkey.exodiusftc.com" \
  "MX  send.exodiusftc.com" \
  "TXT send.exodiusftc.com" \
  "TXT _dmarc.exodiusftc.com" \
  "TXT _dmarc.send.exodiusftc.com"
do echo "== $r"; dig @1.1.1.1 +short ${r#* } ${r%% *}; done
```

Always query a **public** resolver (`@1.1.1.1`, `@8.8.8.8`), never your local one. A record that
resolves for you and not for the world is a split-horizon problem and it is common.

---

## 3. DMARC state

**Current policy: NONE PUBLISHED.** As of 2026-08-14 there is no DMARC record at either
`_dmarc.exodiusftc.com` or `_dmarc.send.exodiusftc.com`. This is the single biggest remaining
deliverability gap: DKIM and SPF both pass, but nothing tells a receiver what to do when they
do not, and Google and Microsoft both treat a missing DMARC policy as a negative signal for a
domain sending cold B2B mail.

### 3.1 Records to publish (GoDaddy → DNS → Records → Add, type TXT)

Two records. GoDaddy wants the name **relative to the zone** — enter exactly what is in the
Name column, not the fully-qualified form.

| Name (GoDaddy) | Fully-qualified | Value | TTL |
|---|---|---|---|
| `_dmarc` | `_dmarc.exodiusftc.com` | `v=DMARC1; p=none; rua=mailto:exodiusftc@gmail.com; fo=1; adkim=r; aspf=r` | **600** |
| `_dmarc.send` | `_dmarc.send.exodiusftc.com` | `v=DMARC1; p=none; rua=mailto:exodiusftc@gmail.com; fo=1; adkim=r; aspf=r` | **600** |

The apex record is not optional. A subdomain policy does not protect the parent, and a domain
with no DMARC at the apex is a spoofing target regardless of what `send.` publishes.

**Keep the TTL at 600s (10 min) for the entire ramp.** That is what makes the §11 rollback fast.
Raise it only after reaching `p=reject` and sitting there confidently.

Verify after publishing (allow up to the old negative-cache TTL, ~1h):

```bash
dig @1.1.1.1 +short TXT _dmarc.exodiusftc.com
dig @1.1.1.1 +short TXT _dmarc.send.exodiusftc.com
```

### 3.2 Where `rua` reports go, and who reads them

- **Destination:** `exodiusftc@gmail.com` — the same inbox as `SUPPORT_EMAIL`.
- **Reader:** Anish Yarrakonda.
- **Format warning:** aggregate reports are gzipped XML, one per receiving provider per day.
  They are effectively unreadable by hand. Either paste them into a free viewer
  (`dmarcian.com/dmarc-xml/`, `dmarcreport.com`) or sign up for a free aggregator tier and
  change the `rua` address to theirs. **A `rua` address nobody opens makes this whole ramp
  theatre** — if that is the honest outcome, say so here rather than pretending.
- Cross-domain `rua` (pointing at an address outside `exodiusftc.com`) is fine here because
  Gmail is the destination and the reports are sent *to* us; the external-destination
  authorisation record (`exodiusftc.com._report._dmarc.<their domain>`) is only needed if you
  switch to a third-party aggregator's domain. If you do, they will tell you the record to add.

### 3.3 The ramp

| Stage | Record | Advance when |
|---|---|---|
| **1. Monitor** | `p=none; rua=…; fo=1` | Publish now. Hold for **at least 14 days of real sending**. |
| **2. Quarantine** | `p=quarantine; pct=100; rua=…` | ≥14 days of reports show **100% DKIM alignment** on every source you recognise and **zero legitimate sources you cannot explain**. An unexplained source is either a forgotten sender or someone spoofing you — find it before advancing. |
| **3. Reject** | `p=reject; rua=…` | ≥30 further days at quarantine with no legitimate mail quarantined and no recipient complaints. |

**The 14-day clock starts at first real production sending, not at the date the record was
published.** Pre-launch there is no traffic, so the reports will be empty and the ramp will be
tempting to compress. That is exactly the situation in which you publish `p=reject` and then
discover, at first real sponsor contact, that something legitimate was never aligned.

Record each advance here:

| Stage | Date reached | By |
|---|---|---|
| `p=none` published | _pending — see §10_ | |
| First real production send (starts the 14-day clock) | _pending_ | |
| `p=quarantine` | _pending_ | |
| `p=reject` | _pending_ | |

### 3.4 Optional: apex SPF

The apex has no SPF record. Mail still passes (§2.2), because SPF is evaluated on the envelope
domain. Publishing `v=spf1 include:amazonses.com ~all` at the apex is a small extra hardening
against envelope spoofing of `@exodiusftc.com` and is safe **only** while nothing else ever
sends with that envelope domain. It is not required, and DMARC is the real protection. If you
add it, note the date here.

---

## 4. Environment variables

All of these live in the **Vercel project**, not `.env.local`. **Deploys are manual** — pushing
to `main` does nothing. Ship with `vercel deploy --prod --yes`.

| Var | Production value | Notes |
|---|---|---|
| `RESEND_FROM_EMAIL` | `noreply@exodiusftc.com` | See the trap below. |
| `RESEND_API_KEY` | *(Resend dashboard → API Keys)* | The key in `.env.local` is **send-only** and restricted; it cannot read domains or webhooks via the API. |
| `RESEND_WEBHOOK_SECRET` | *(Resend dashboard → Webhooks → signing secret)* | `lib/env.ts` makes this **required in production**; the webhook returns 503 without it. Adding or changing a domain does not change it, but confirm it is set after any Resend reconfiguration. |
| `NEXT_PUBLIC_APP_URL` | `https://ftc-sponsorship-portal.vercel.app` | The CTA base in every email. See §4.2. |
| `ADMIN_NOTIFICATION_EMAILS` | optional, comma-separated | When unset, `lib/notify.ts` falls back to a `profiles.role='admin'` query. |

### 4.1 ⚠️ The `noreply@` trap

**`RESEND_FROM_EMAIL` must begin with `noreply@` and must be a bare address with no display
name.** From `lib/env.ts`:

```ts
if (
  process.env.NODE_ENV === 'production' &&
  !isBuildPhase &&
  !result.data.RESEND_FROM_EMAIL.toLowerCase().startsWith('noreply@')
) {
  throw new Error('RESEND_FROM_EMAIL must use a noreply@ address in production.')
}
```

This throws on the **first request**, not at build time, and `lib/env.ts` is imported on every
request path. Setting it to `hello@exodiusftc.com` **takes the entire site down** — every route
500s, not just email. The build will succeed and look fine.

The schema is also a bare `z.string().email()`, so `"Exodius FTC <noreply@exodiusftc.com>"`
fails validation and produces the same full-site outage. If a display name is ever wanted, it
must be constructed in the senders' `from:` field, not in the env var.

Cutover procedure, if the address ever changes:

```bash
# 1. Verify the NEW domain in Resend FIRST. Reversed, dispatchApprovedSubmission returns
#    { success: false } and never throws — admin approvals stop reaching sponsors silently.
vercel env rm  RESEND_FROM_EMAIL production
vercel env add RESEND_FROM_EMAIL production     # value: noreply@<new domain>
vercel deploy --prod --yes                      # deploys are MANUAL
curl -sS -o /dev/null -w '%{http_code}\n' https://ftc-sponsorship-portal.vercel.app/api/health
#    ^ must print 200 before you do anything else. That proves lib/env.ts did not throw.
```

### 4.2 The From/link domain mismatch — a known, accepted signal

Every link we send points at `ftc-sponsorship-portal.vercel.app` while the `From` is
`@exodiusftc.com`. That mismatch — including on `/sponsor-view/{token}`, the single most
important link this product sends — is a well-known spam heuristic and looks like a phish to a
corporate security filter.

**This is recorded as an accepted risk, not an oversight.** The fix is to add
`portal.exodiusftc.com` as a custom domain on the Vercel project (a CNAME at GoDaddy), point
`NEXT_PUBLIC_APP_URL` at it, and redeploy. That is its own change with its own rollback and
touches Clerk's allowed origins, so it is not bundled here. **It is the highest-value remaining
deliverability improvement after DMARC.** Do it before the first real outreach campaign if
possible.

---

## 5. Webhook events

Endpoint: `https://ftc-sponsorship-portal.vercel.app/api/webhooks/resend`. Public by design
(`middleware.ts` matches `/api/webhooks(.*)`) — the **svix signature is the only gate**, and it
is correct: the raw body is read with `req.text()` (svix signs the exact bytes), the secret is
required outside development, and a bad signature returns 400. Do not change any of that. In
particular, switching to `req.json()` invalidates every signature.

Subscribe the endpoint to exactly these four types in the Resend dashboard:

| Event | What the code does |
|---|---|
| `email.delivered` | Sets `submissions.status = 'delivered'`, fenced by `.in(['dispatched','delivered','opened'])` so a late event cannot overwrite a terminal state. |
| `email.opened` | Same, `status = 'opened'`. |
| `email.bounced` | Calls `release_submission_reservation` → **releases the sponsor's reserved capacity** and sets status `bounced`. See §1. |
| `email.complained` | **Audit row + in-app and email alert to every admin. Status and capacity untouched.** Works whether or not the message maps to a submission — most of our mail (notifications, welcome, receipts, nudges) does not. |

Every branch writes one `audit_log` row (`action = 'resend_webhook_<type>'`, metadata carries
`resend_email_id`), and that row is also the **idempotency key**: a svix retry finds it and
returns `{ duplicate: true }` without re-processing or re-alerting.

**`email.delivery_delayed` is ignored on purpose.** It is a soft bounce — full mailbox,
transient 4xx. Resend retries and emits `email.bounced` if delivery ultimately fails. Acting on
a delay would release a sponsor's capacity because a mailbox was briefly full. It falls through
the handler's `{ success: true, skipped: true }` return, which must stay: **never fail closed on
an unrecognised event type**, because a non-200 makes svix retry it forever.

`email.complained` deliberately has no entry in `EVENT_STATUS_MAP`. A recipient who reported the
pitch as spam still *received* it — overwriting `delivered` would be a lie, and routing a
complaint through `release_submission_reservation` would turn the "Report spam" button in any
mail client into a capacity-release primitive. `lib/__tests__/resend-webhook-complained.test.ts`
asserts both of those negatively; if you change the handler, those assertions are the contract.

---

## 6. Bounce and complaint policy

| Event | Automatic behaviour | Human action |
|---|---|---|
| **Hard bounce** (`email.bounced`) on a dispatched pitch | Reservation released, submission → `bounced`, capacity returned to the sponsor, `audit_log` row written | Check whether `sponsors.contact_email` is simply wrong. If so, correct it and re-dispatch. **If two or more sponsors bounce in a week, stop dispatching and treat it as a reputation incident** — that is not a coincidence, it is a blocklist. |
| **Soft bounce** (`email.delivery_delayed`) | Ignored; Resend retries | None unless it converts to a hard bounce. |
| **Spam complaint** (`email.complained`) | `audit_log` row + admin in-app notification and email. **Status and `funding_used_cents` unchanged.** Resend auto-suppresses the address. | Contact the recipient out of band. **Do not re-send.** One complaint is a conversation; **three in a month is a policy problem with the outreach itself, not with DNS.** |
| **Complaint rate > 0.1% over 30 days** | none | Pause non-essential sending; review `dispatchApprovedSubmission` volume and targeting. Gmail's published threshold is 0.3%; 0.1% is where you still have time to act. |

Percentages are of **delivered** mail, read off the Resend dashboard. **The rate is only
meaningful above roughly 500 sends in the window.** Below that, a single complaint blows past
any threshold and the rule is simply: **investigate every single complaint.** At current
pre-launch volume that is the operative rule.

---

## 7. Suppression list

- It lives **in Resend**, it is **account-level**, and it is **automatic**: both hard bounces and
  spam complaints add the address with no action from us.
- **Nothing in this repo stores a suppression list, and nothing should.** Duplicating it is a
  consistency bug waiting to happen. This is why the slice has no schema change.
- Removing an address requires **confirming the recipient asked to be re-added**, in writing,
  out of band. Record who authorised the removal in the ticket or thread.
- **Never bulk-clear the list.** Re-sending to a hard-bounced address is the fastest way to get
  a domain blocked.
- Consequence worth remembering: once a sponsor is suppressed they receive **nothing** from us —
  not pitches, not handshakes, not receipts. The product has no way to detect this on its own,
  which is what the admin alert in §5 exists for.

---

## 8. Plain-text part — verified, no action needed

Every sender in this repo passes `react:` and no `text:`. The Resend Node SDK renders
`react` → `html` client-side and sends no `text` field (`node_modules/resend/dist/index.mjs`,
`render()`), so the question was whether the API supplies one.

**It does.** Resend's send-email API reference states, for the `text` field: *"If not provided,
the HTML will be used to generate a plain text version. You can opt out of this behavior by
setting value to an empty string."* Our messages therefore go out as
`multipart/alternative` with both parts.

**Conclusion: no `text:` fields were added anywhere.** Do not add them for deliverability
reasons — you would be replacing Resend's generated part with a hand-rolled one and taking on
the maintenance. The one thing to avoid is setting `text: ''`, which opts out and ships
HTML-only mail. (Confirm the multipart structure once from a real send during §10 step 4.)

---

## 9. Reply-to routing

`RESEND_FROM_EMAIL` is forced to `noreply@`, so a reply goes nowhere unless a sender sets
`replyTo`. Current state after this slice:

| Sender | `replyTo` |
|---|---|
| `dispatchApprovedSubmission` (`lib/dispatch.ts`) | the coach, falling back to `SUPPORT_EMAIL` |
| `sendHandshakeEmail` (both halves) | cross-wired — coach's copy → sponsor, sponsor's copy → coach |
| `sendThreadMessageEmail` | `SUPPORT_EMAIL` — **deliberately never the counterparty**, or the moderated Q&A becomes an unmoderated backchannel |
| `sendFulfillmentNudgeEmail`, `sendFundingReceiptEmail` | caller-supplied, falling back to `SUPPORT_EMAIL` |
| `sendCoachDenialEmail` | `SUPPORT_EMAIL` **(added in this slice)** — it tells a coach their application needs work; they will reply asking how |
| `sendSponsorApplicationConfirmation` | `SUPPORT_EMAIL` **(added in this slice)** — the first thing a prospective sponsor ever receives |
| the remaining portal-CTA senders (decision, credential alert, verification, welcome, sponsor-app alert, notification mirror) | none, on purpose — they say "open the portal", not "reply to us" |

Beyond the human cost, a `From` whose replies bounce is itself a mild negative reputation signal
with several providers. That is why the two additions were in scope for a deliverability slice.

---

## 10. Verification checklist

Items 1–3 were completed on 2026-08-14. Items 4–9 need a production send, a real mailbox, or
dashboard access, and are **open operator actions** — do them before the first outreach
campaign and fill in the results here.

- [x] **1. DNS — DKIM, SPF, MAIL FROM MX all present and resolving** from public resolvers
      (`1.1.1.1` and `8.8.8.8`). Output pasted in §2.2.
- [x] **2. SPF include chain resolves** — `_spfm` indirection → `v=spf1 include:amazonses.com ~all`.
- [x] **3. Automated regression tests** — `lib/__tests__/resend-webhook-complained.test.ts`
      (11 tests) covers the complaint branch, the negative guardrails, the idempotency dedupe,
      and that `email.bounced` still releases the reservation.
- [ ] **4. Publish the two DMARC records** from §3.1 at GoDaddy, TTL 600. Re-run the §2.3
      command and paste the output here. Record the date in §3.3.
- [ ] **5. Resend dashboard** — confirm `exodiusftc.com` still shows **Verified** with all
      records green, and that the webhook endpoint is subscribed to **`email.delivered`,
      `email.opened`, `email.bounced`, and `email.complained`**. *The fourth is new — the code
      handling it is inert if Resend never sends the event.*
- [ ] **6. mail-tester.com** — trigger one real message from production to the address it gives
      you. Target 10/10; **9/10 is the pass bar**, and any point lost to SPF, DKIM, DMARC, or
      reverse DNS is a hard fail regardless of the total. Points lost to "no unsubscribe link"
      are acceptable on transactional mail. Paste the **breakdown**, not just the number. While
      you are there, view the raw source and confirm `Content-Type: multipart/alternative`
      (§8).
- [ ] **7. Gmail raw-source inspection** — send to a real Gmail address, *Show original*,
      confirm `SPF: PASS`, `DKIM: PASS`, `DMARC: PASS`. Screenshot into this file.
- [ ] **8. Microsoft 365 inspection** — the same, to a borrowed corporate 365 mailbox.
      **This is the audience that actually matters** and it filters differently from Gmail.
- [ ] **9. Google Postmaster Tools** — register `exodiusftc.com` (needs a TXT verification
      record at GoDaddy). It shows nothing until real volume arrives, which is precisely why you
      register it **now** rather than during an incident. Record the console URL and who has
      access.
- [ ] **10. Webhook round-trip in production** — send a Resend dashboard test event for
      `email.complained` and confirm an `audit_log` row appears
      (`action = 'resend_webhook_email.complained'`) and an admin notification lands. Then
      confirm an **unsigned** POST returns 400:
      `curl -i -X POST https://ftc-sponsorship-portal.vercel.app/api/webhooks/resend -d '{}'`.
      (Do **not** unset `RESEND_WEBHOOK_SECRET` to test the 503 path — reason through
      `route.ts` instead.)

Re-run items 1, 2, 4 and 5 after **any** DNS change.

---

## 11. Rollback

1. **Revert the `From` address first, not the DNS.** `vercel env rm RESEND_FROM_EMAIL
   production`, re-add the previous value, `vercel deploy --prod --yes`. Sending resumes on the
   old identity immediately. Leaving DNS records in place is harmless.
2. **Roll DMARC back before removing anything else.** If legitimate mail starts disappearing,
   set both `_dmarc` records back to `v=DMARC1; p=none; rua=…` — one TXT edit each, effective
   within the 600s TTL. This is why the TTL stays low during the ramp.
3. **Removing DKIM/SPF/MX is a last resort and makes deliverability worse, not better.** An
   unsigned message from a domain that recently signed is more suspicious than one that never
   did. Only do it if the domain is being retired entirely.
4. **To revert the code:** `git revert` the commit. The `email.complained` branch is additive and
   inert unless Resend is subscribed to the event — **unsubscribing it in the Resend dashboard
   is an even faster, no-deploy disable.**
5. **No database rollback exists or is needed** — no migration. `audit_log` rows written by the
   complaint branch are append-only records of real events; leave them.
6. `vercel rollback` reverts the deployment but **not** DNS and **not** the Resend dashboard
   configuration. Those two it cannot undo; do them by hand, in the order above.

---

## 12. When deliverability degrades — triage order

1. **Is it us or them?** One bounce from one sponsor is an address typo. Two in a week, or any
   bounce from a large provider (`outlook.com`, `google.com` tenants), is a reputation incident.
   **Stop dispatching before diagnosing** — every further send digs the hole deeper, and every
   bounce silently releases a sponsor's reserved capacity (§1).
2. **Check the Resend dashboard first** — delivered / bounced / complained counts for the last
   7 days, and whether the domain still shows Verified. A domain that silently un-verified
   (a DNS record edited or a registrar migration) is the most common cause and the fastest fix.
3. **Re-run the §2.3 `dig` block against two public resolvers.** Confirm DKIM, SPF, MX and DMARC
   are all intact and unchanged from §2.2.
4. **Read the bounce text.** Resend surfaces the remote server's SMTP response. It usually names
   the blocklist or the reason outright (`550 5.7.1 ... blocked using Spamhaus`).
5. **Check the blocklists** — `mxtoolbox.com/blacklists.aspx` for `exodiusftc.com` and for the
   sending IP in the bounce message. Resend owns the IPs; if one is listed, open a Resend
   support ticket rather than trying to delist it yourself.
6. **Check `audit_log` for complaints** you may have missed:
   `select * from audit_log where action = 'resend_webhook_email.complained' order by created_at desc;`
   A complaint cluster explains a reputation drop better than anything in DNS.
7. **Check Google Postmaster Tools** (once §10 item 9 is done) for domain reputation and spam
   rate over time. This is the only source that shows you the trend rather than the moment.
8. **If DMARC has advanced past `p=none`, roll it back to `p=none`** (§11 step 2) before
   changing anything else. It is the cheapest and fastest lever and it is reversible in minutes.
9. **Only then** consider the `From` address or a new subdomain. Standing up
   `mail.exodiusftc.com` as a fresh Resend domain gives a clean reputation start without
   touching the apex — but reputation has to be rebuilt from zero, so it is a last resort, not a
   first response.
