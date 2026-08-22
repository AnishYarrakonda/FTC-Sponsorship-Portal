# Prompt 03 — Fulfillment UI and admin reconciliation

> **Prerequisites:** `01` (the `funding_fulfillments` state machine), `02` (the team payout profile)
> **Reserved migration:** none — this slice adds **no SQL**. Every column it reads was created by `0076`/`0077`.
> **Scope:** large · ~18 files
> **Leaves the repo:** green and shippable on its own

## Why this exists

Prompt `01` built a fulfillment state machine and three server actions that can drive it.
Nothing in the product calls them. A sponsor still opens `/sponsor/funding` and sees a list
of ledger rows; a coach has no page that says a sponsor has committed money at all; and no
admin can answer "what is stuck, and for how long?" without opening the SQL editor.

The machine is also silent. `funding_fulfillments.last_nudged_at` was created by `0076` and
is written by nobody — prompt `01` added the column specifically so this slice could fill it
without a migration of its own. A commitment that sits in `pledged` for two months produces
zero emails, zero in-app notifications, and zero admin signal. Pledge-and-track only works
if somebody is doing the tracking, and right now nobody is.

This slice is the three human surfaces over that machine — sponsor, coach, admin — plus the
one automated one that pokes both counterparties when a fulfillment goes quiet.

## Current state (verified)

**What exists after `01` and `02`**

- `funding_fulfillments` (one row per settled commitment) and `funding_fulfillment_events`
  (append-only transition trail), both SELECT-only for admin / owning sponsor / owning
  coach, with no INSERT/UPDATE/DELETE policy for anyone. `can_read_fulfillment(uuid)` is
  the reusable read predicate.
- `record_fulfillment_transition(...)` — the enforcement point, EXECUTE revoked from
  `PUBLIC`/`anon`/`authenticated`, granted to `service_role` only.
- `app/actions/fulfillment.ts` — `markPaymentSent`, `confirmPaymentReceived`,
  `adminOverrideFulfillmentStatus`. All three exist and are wired to nothing.
- `lib/fulfillment-status.ts` — `FULFILLMENT_STATUSES`, `OPEN_FULFILLMENT_STATUSES`,
  `TERMINAL_FULFILLMENT_STATUSES`, `LEGAL_TRANSITIONS`, `canTransition`,
  `isOpenFulfillment`, `fulfillmentStatusLabel`. **Import status arrays from here. Do not
  re-declare them in a component.**
- `team_payout_profiles` (prompt `02`) with `w9_uploaded_at`, `w9_verified_at`,
  `w9_rejected_at`, `w9_rejected_reason`, `w9_expires_at` — the completeness signals the
  coach view has to surface.

**What exists in the app today (read these before you touch them)**

- `app/(sponsor)/sponsor/funding/page.tsx` — after prompt `01`'s copy fix this is still a
  ledger list: `:37-42` selects `transactions_ledger` with the RLS-respecting server client
  from `getAuthedProfile()`, `:43` sums `amount_cents`, `:52-71` renders two KPI cards,
  `:80-103` maps rows, `:94` carries the `team_id`-is-nullable null-guard that 0061 makes
  necessary, `:104-116` is the `EmptyState`. **Prompt 03 replaces this page.**
- `app/(sponsor)/layout.tsx` — `:55-61` computes the sidebar badge from
  `AWAITING_SPONSOR_STATUSES`; `:31-50` is the "awaiting verification" card shown when
  `sponsor_id` is null. The `(sponsor)` group already fails closed on role
  (`:24-26`) — do not add a second role check inside a page.
- `app/(coach)/dashboard/page.tsx` — a single server component that fans out one
  `Promise.all` (`:20-65`), resolves sponsor names out-of-band (`:71-87`), auto-provisions a
  team (`:104-210`), reads achievements (`:239-243`), and hands everything to
  `DashboardShell` (`:245-256`). **The coach portal has exactly one route.**
- `components/coach/dashboard-shell.tsx` — `:37-44` `TABS`, `:46-52` `TAB_ALIASES`,
  `:121-137` the `tab === '…' &&` dispatch. Navigation is `?tab=`, driven by
  `components/coach/coach-sidebar.tsx:28-34`. There is no visible tab bar; the sidebar is
  the only way in.
- `components/admin/admin-sidebar.tsx:28-35` — the admin nav array
  (`/admin`, `/moderation`, `/applications`, `/sponsors`, `/coaches`, `/analytics`).
  `:47-52` polls `/api/admin/queue/count` with SWR for the single badge.
- `app/(admin)/layout.tsx:23-24` — the `(admin)` group's role guard; `:33` caps content at
  `max-w-[1100px]`.
- `app/(admin)/coaches/page.tsx:23-33` — the three-section queue layout and the
  mint-signed-URLs-only-for-the-queue optimization. Copy the section structure.
- `app/api/cron/expire-submissions/route.ts` — `:11-32` the `CRON_SECRET` Bearer check with
  `crypto.timingSafeEqual`, `:76` the retention sweep, `:84-106` the notify loop wrapped so a
  send failure cannot abort the sweep, `:112-127` the durable `audit_log` row. This is the
  template for the new cron route.
- `vercel.json` — one entry today: `/api/cron/expire-submissions` at `0 2 * * *`.
- `middleware.ts:5-18` — `/api/cron(.*)` is already in the public matcher. **A new cron
  route needs no middleware change.**
- `lib/notify.ts` — `:24` `NotifyResult`, `:35-43` `notifyFailure`, `:46-58` `sendViaResend`,
  `:60-79` `getAdminNotificationRecipients`, `:201-222` the handshake pair showing the
  `replyTo` + `idempotencyKey` idiom, `:255-320` `createInAppNotification`.
- `lib/actions-utils.ts:84-104` `getAuthedProfile`; `:128-137` `requireVerifiedCoach`
  — note it returns `{ supabase, user, clerkUserId }` and **no `adminClient`**.
- `lib/errors.ts:15-52` `mapDbError` — never return a raw Postgres message to the client.
- Preview wiring: `lib/supabase/server.ts:17-18` honours `isDevAuthBypass()` and
  `COACH_PREVIEW` but **not** `SPONSOR_PREVIEW`; `lib/supabase/admin.ts:17-23` honours all
  three; `lib/actions-utils.ts:15-35` returns a mock client + mock profile per mode.

**What is missing**

`grep -rn "fulfillment" app components` returns only `app/actions/fulfillment.ts` and
`lib/fulfillment-status.ts`. No page, no component, no cron, no email template, no fixture.
`last_nudged_at` is never written. `funding_fulfillment_events` is never read.

## What you are building

1. `lib/fulfillment-aging.ts` — pure aging/nudge policy. No DB, no React, fully unit-tested.
2. **(a)** `app/(sponsor)/sponsor/funding/page.tsx` rewritten as a fulfillment tracker, plus
   `components/sponsor/mark-payment-sent-dialog.tsx`.
3. **(b)** A `funding` tab in the coach portal:
   `components/coach/funding-tab.tsx` + `components/coach/confirm-receipt-dialog.tsx`, wired
   through `dashboard-shell.tsx`, `coach-sidebar.tsx`, and the dashboard page's query fan-out.
4. **(c)** `app/(admin)/reconciliation/page.tsx` + `components/admin/reconciliation-table.tsx`
   + `components/admin/fulfillment-override-dialog.tsx` + a sidebar entry.
5. `emails/fulfillment-nudge-email.tsx` and `sendFulfillmentNudgeEmail` in `lib/notify.ts`.
6. `app/api/cron/nudge-fulfillments/route.ts` + a second entry in `vercel.json`.
7. Fixtures in all three dev-preview files.
8. Tests.

**No migration. No new env var. No new dependency.** If you find yourself reaching for any
of the three, stop — the slice is designed to need none of them.

## Aging and nudge policy — `lib/fulfillment-aging.ts`

Put the policy in one pure module so the cron stays thin, the admin table and the cron agree
on what "stale" means, and the thresholds are testable without a database. Mirror
`lib/submission-status.ts` in spirit and comment density.

```ts
/** Age is measured from the moment the row ENTERED its current status, not from pledge. */
export function statusEnteredAt(f: FulfillmentTimestamps): string

export function ageInDays(f: FulfillmentTimestamps, now?: Date): number

export type AgingBucket = 'on_track' | 'aging' | 'stale' | 'escalate'
export function agingBucket(days: number): AgingBucket

export type NudgeTarget = 'sponsor' | 'coach' | 'admin' | null
export function nudgePlan(
  f: FulfillmentTimestamps & { status: FulfillmentStatus; last_nudged_at: string | null },
  now?: Date,
): { target: NudgeTarget; reason: NudgeReason | null; ageDays: number }
```

`statusEnteredAt` maps status → column: `pledged` → `pledged_at`, `agreement_signed` →
`agreement_signed_at`, `payment_sent` → `payment_sent_at`, `payment_received` →
`payment_received_at`, `receipted` → `receipted_at`, `cancelled` → `cancelled_at`. Fall back
to `pledged_at` when the specific stamp is null (a hand-corrected row) rather than throwing.

### Thresholds (authoritative — these numbers are the spec)

```ts
export const NUDGE_THRESHOLDS = {
  /** pledged / agreement_signed with no payment sent. */
  awaitingPaymentDays: 14,
  /** payment_sent with no confirmation from the coach. */
  awaitingReceiptDays: 10,
  /** payment_sent this long with no confirmation — tell the SPONSOR too; the check may be lost. */
  sponsorSecondNoticeDays: 21,
} as const

/** Never nudge the same fulfillment more often than this, whatever else is true. */
export const NUDGE_REPEAT_DAYS = 14

/** Past this, stop pestering the counterparties and hand it to a human. */
export const ESCALATE_AFTER_DAYS = 90

export const AGING_BUCKETS = {
  on_track: { maxDays: 13 },   // 0–13
  aging:    { maxDays: 29 },   // 14–29
  stale:    { maxDays: 59 },   // 30–59
  escalate: { maxDays: null }, // 60+
} as const
```

Why these numbers, in one line each — put these as comments in the file:

- **14 days to send payment.** Corporate AP runs on a check cycle; two weeks is one full
  cycle plus slack. Nudging sooner reads as nagging and gets the sender filtered.
- **10 days to confirm receipt.** A mailed check plus a deposit clears inside 5–10 calendar
  days. Past 10, silence is informative rather than normal.
- **21 days → second notice to the sponsor.** At three weeks the likeliest explanation is a
  lost or misaddressed check, and only the sponsor can reissue it.
- **14-day repeat.** One nudge per fortnight per fulfillment, tracked in `last_nudged_at`.
- **90 days → admin.** Past a quarter the counterparties have stopped reading; the case
  needs a person, not another email.

`nudgePlan` returns `{ target: null }` — no work — when any of these is true:
`status` is in `TERMINAL_FULFILLMENT_STATUSES` (`receipted`, `cancelled`);
`last_nudged_at` is within `NUDGE_REPEAT_DAYS` of `now`;
the age has not yet crossed the relevant threshold.
It returns `target: 'admin'` once `ageDays >= ESCALATE_AFTER_DAYS`, regardless of status,
and that outranks the counterparty targets.

## (a) Sponsor fulfillment tracker

**Route:** `app/(sponsor)/sponsor/funding/page.tsx` (rewritten). Server component, reads via
`getAuthedProfile()`'s `supabase` — that is what makes `npm run dev:sponsor-preview` work at
all (`lib/supabase/server.ts` does **not** honour `SPONSOR_PREVIEW`; only the guard does).

```ts
const { data: fulfillments } = await supabase
  .from('funding_fulfillments')
  .select('*, teams(team_name, ftc_team_number)')
  .eq('sponsor_id', profile.sponsor_id)
  .order('pledged_at', { ascending: false })
```

RLS already scopes this to the caller's sponsor; the explicit `.eq` is belt-and-braces and
keeps the read on `idx_fulfillments_sponsor`. Keep the `(f.teams as any)?.team_name ??
'Team no longer on the platform'` null-guard from the current page at `:94` — `team_id` is
`ON DELETE SET NULL` on this table too.

**Summary band** — four cards, using the existing `Card` primitives already imported by the
page (not `StatCard`; the current page's card shape is what the sponsor portal looks like):

| Card | Value |
|---|---|
| Total committed | sum of `amount_cents` over all non-`cancelled` rows |
| Awaiting your payment | sum + count where `status IN ('pledged','agreement_signed')` |
| In transit | sum + count where `status = 'payment_sent'` |
| Confirmed received | sum + count where `status IN ('payment_received','receipted')` |

"Total Approved" and "Across all teams, all time" from the old page are accurate and should
survive as the first card's label/hint.

**Row** — team name + FTC number, amount, `StatusBadge`-style chip rendered from
`fulfillmentStatusLabel(f.status)`, a compact timeline (`Pledged 12 Apr · Payment sent
19 Apr`), and the age in days for open rows. Add the six fulfillment statuses to
`STATUS_CONFIG` in `components/ui/status-badge.tsx:34-56` so the chip gets an icon and a
tone like every other status in the product — the file's own comment (`:39-42`) records what
happened last time a live status had no config. Suggested tones: `pledged` → pending,
`agreement_signed` → pending, `payment_sent` → warning, `payment_received` → success,
`receipted` → success, `cancelled` → neutral. **`fulfillment_status` and `submission_status`
share no values, so there is no key collision** — verify that before you edit the map.

**"Mark payment sent"** — `components/sponsor/mark-payment-sent-dialog.tsx`, a client
component using `Dialog` + `useTransition` + `sonner`, matching
`components/sponsor/sponsor-decision-panel.tsx`'s idiom:

- **Method** (required): `check | ach | wire | other`. Radio group; the DB rejects a missing
  method with `payment_details_required`, so disable submit until one is chosen.
- **Reference number** (optional): free text, `maxLength={LIMITS.paymentReference}`
  (64, added by prompt `01`). Label it "Check number / ACH trace / wire reference" and add
  helper text: *"Shared with the team so they can match the deposit. Never emailed."*
- **Date sent** (optional, defaults to today): `<input type="date" max={today}>`. The RPC
  rejects a future date with `future_date`.
- **Note** (optional): `maxLength={LIMITS.fulfillmentNote}`.
- Submits to `markPaymentSent`; renders the returned `error` in an inline
  `Alert variant="destructive"`; on success toasts and calls `router.refresh()`.

The button renders only when `canTransition(f.status, 'payment_sent', 'sponsor')` is true.
**A sponsor must never see a "Confirm funds received" control** — that is the coach's
transition and offering it here invites a support ticket at best and self-dealing at worst.

### `payment_reference` — who may read it

This is the one genuinely sensitive field on the table, so state the rule once and enforce it
everywhere:

| Party | May read it | Where |
|---|---|---|
| The sponsor who wrote it | yes | their own fulfillment row |
| The coach who owns the team | **yes** | their own fulfillment row — this is the whole point; it is how they match a deposit to a pledge |
| Admin | yes | reconciliation dashboard |
| Any other sponsor, any other coach, anon | **no** | `funding_fulfillments` RLS (0076) denies the row entirely |

It must **never** appear in: `audit_log.metadata`, `funding_fulfillment_events.metadata`, a
notification title or body, any email template or prop, a CSV export, a URL, a Sentry
breadcrumb, or a `console.log`. Prompt `01` established that rule for the write path; this
slice must not break it on the read path.

In the UI, render it masked by default — `•••• 4821`, last four only — with a client-side
"Show" toggle. Be honest about what that is: the full value is already in the row the reader
is authorised to see, so the mask is shoulder-surfing defence during a screen-share, not an
access control. Do not build a reveal round-trip; there is nothing to protect it from.

**States.** *Empty* — keep the existing `EmptyState` (`Wallet` icon), reworded: "No
commitments yet. When you fund a team's pitch it appears here and you can track the payment
through to confirmation." *Loading* — the `(sponsor)` group's `loading.tsx` already covers
it; do not add a route-level one. *Error* — a failed read renders the empty state, not a
crash; a failed action renders inline in the dialog.

## (b) Coach incoming-pledges view

**Decision: a `funding` tab on `/dashboard`, not a new route.** The coach portal navigates
entirely by `?tab=` — `coach-sidebar.tsx:28-34` links to `/dashboard?tab=…` and
`dashboard-shell.tsx:121-137` dispatches on it. A standalone route would be reachable only by
typing the URL. (Prompt `02`'s `/team/payout` is the deliberate exception: it is a form you
arrive at from a card, not a portal section.)

**Wiring, three small edits:**

- `components/coach/dashboard-shell.tsx:37-44` — add `{ id: 'funding', label: 'Funding' }`
  after `pitches`. `:46-52` — add `'pledges': 'funding'` to `TAB_ALIASES`. `:121-137` — add
  `{tab === 'funding' && <FundingTab … />}`.
- `components/coach/coach-sidebar.tsx:28-34` — add
  `{ label: 'Funding', href: '/dashboard?tab=funding', icon: Wallet, tabs: ['funding','pledges'], badge: false }`
  after "Pitches". `Wallet` is already the sponsor portal's funding icon; reuse it.
- `app/(coach)/dashboard/page.tsx:20-65` — add two reads to the existing `Promise.all`
  (do not add a second sequential await; the file's whole shape is one fan-out):

```ts
supabase.from('funding_fulfillments')
  .select('*, sponsors(company_name)')
  .order('pledged_at', { ascending: false }),
supabase.from('team_payout_profiles')
  .select('team_id, w9_uploaded_at, w9_verified_at, w9_rejected_at, w9_rejected_reason, w9_expires_at')
  .maybeSingle(),
```

Both are RLS-scoped to the caller's team, so no `.eq` on a team id the page has not resolved
yet. Pass the results down through `DashboardShell`'s props (`:245-256`) exactly as
`achievements` is passed.

**`components/coach/funding-tab.tsx`** — client component, four sections in this order:

1. **Payout readiness** (top, always rendered) — see below.
2. **In transit** — `status = 'payment_sent'`. Each row: sponsor name, amount, "Sent by
   {method} on {date}", the masked reference, days since sent, and the **Confirm funds
   received** button.
3. **Awaiting payment** — `status IN ('pledged','agreement_signed')`. Sponsor, amount,
   pledged date, age. No action for the coach; copy explains that the sponsor sends the
   money directly and the platform never holds funds.
4. **Received** — `status IN ('payment_received','receipted')`, then **Cancelled** collapsed
   at the bottom with the `cancelled_reason`.

**Payout readiness banner — the "don't leave them guessing" requirement.** Derive one of
five states from the `team_payout_profiles` row and render it as the first thing on the tab:

| Condition | Tone | Message |
|---|---|---|
| no row | destructive | "Sponsors cannot pay you yet. Add your legal payee name, address and W-9." → CTA `/team/payout` |
| row, `w9_uploaded_at IS NULL` | destructive | "Your payee details are saved, but no W-9 is on file." → CTA `/team/payout/w9` |
| `w9_rejected_at IS NOT NULL` | destructive | "Your W-9 needs attention: {w9_rejected_reason}" → CTA to re-upload |
| uploaded, not verified, not rejected | warning | "Your W-9 is in review. Sponsors can see your payee name but not yet that a W-9 is on file." |
| `w9_verified_at IS NOT NULL` | success, single line | "Payout details verified." + the `w9_expires_at` date when it is within 90 days |

**Be precise about what is actually blocked.** Prompt `02` is explicit that "W-9 on file" is
**not** a gate on settle or dispatch, and this banner must not imply the platform is
withholding anything. The true statements are: a corporate AP department will not release
funds to a payee with no W-9; and prompt `04` cannot issue a deductible acknowledgment
without a verified payout profile. Say those. Do not write "blocked by FTC Pitfund".

**"Confirm funds received"** — `components/coach/confirm-receipt-dialog.tsx`:
date received (defaults today, `max` today), optional note, submits `confirmPaymentReceived`.
That action is guarded by `requireVerifiedCoach()`, which throws with `e.code ===
'NEEDS_VERIFICATION'`; surface that as the verification CTA rather than a raw error string.
Rendered only when `canTransition(f.status, 'payment_received', 'coach')`. **A coach must
never see a "Mark payment sent" control.**

*Empty* — `EmptyState` (`Wallet`): "No sponsor commitments yet. When a sponsor funds one of
your pitches it appears here." *Permission-denied* — unreachable; the `(coach)` layout
(`:36`) already bounces unverified coaches to `/awaiting-verification`.

## (c) Admin reconciliation dashboard

**Route:** `app/(admin)/reconciliation/page.tsx` → URL `/reconciliation` (the `(admin)` group
does not prefix; only the dashboard itself lives at `/admin`). Add
`{ label: 'Reconciliation', href: '/reconciliation', icon: Wallet, exact: false, badge: false }`
to `components/admin/admin-sidebar.tsx:28-35`, after "Analytics".

Use `createClient()` from `lib/supabase/server.ts` — under `is_admin()` RLS grants the full
table, and that client is what `npm run dev:admin-preview` swaps for the `lib/dev-bypass.ts`
mock (`lib/supabase/server.ts:17`). Do not use the admin client here; there is nothing to
bypass, and using it would make the preview mode read production.

```ts
const { data: rows } = await supabase
  .from('funding_fulfillments')
  .select('*, teams(team_name, ftc_team_number), sponsors(company_name)')
  .order('pledged_at', { ascending: true })
```

Aggregate in JS. Pre-launch there is no data and at any realistic volume this is a few
hundred rows; an aggregate RPC would need a migration and this slice deliberately has none.
Add a `// If this ever exceeds a few thousand rows, move the totals into a view.` comment
rather than pre-optimising.

**Totals band** — one row of cards, count **and** summed cents for each of:
`pledged` · `agreement_signed` · `payment_sent` · `payment_received` · `receipted` ·
`cancelled`, plus a headline triple the finance question actually asks:
**pledged (everything ever committed, excluding cancelled)** vs **received
(`payment_received` + `receipted`)** vs **receipted**. Show the received/pledged percentage.

**Aging report** — the default view. Rows where `isOpenFulfillment(status)`, sorted oldest
first, grouped by `agingBucket(ageInDays(row))`:

| Bucket | Age | Treatment |
|---|---|---|
| `on_track` | 0–13 days | muted, collapsed by default |
| `aging` | 14–29 | warning tone |
| `stale` | 30–59 | destructive tone |
| `escalate` | 60+ | destructive + a persistent marker; these are the ones a human works |

Each row shows: team → sponsor, amount, current status, days in that status, the date it
entered it, `last_nudged_at` ("nudged 3 days ago" / "never nudged"), and an expander with the
`funding_fulfillment_events` timeline for that fulfillment (`from_status → to_status`,
`actor_role`, `note`, `created_at`). Fetch events lazily for the expanded row only, or in one
batched read filtered by the visible fulfillment ids — do not issue one query per row.

**Manual override** — `components/admin/fulfillment-override-dialog.tsx`:

- Target-status select populated from `LEGAL_TRANSITIONS[current]` filtered by
  `canTransition(current, target, 'admin')`. Never render a target the RPC will reject.
- **Reason: required, min 10 characters**, `maxLength={LIMITS.fulfillmentNote}`. Disable
  submit until it validates client-side; the action enforces it server-side regardless.
- Optional `paymentMethod` and `occurredOn`, shown only when the target is `payment_sent`.
- Calls `adminOverrideFulfillmentStatus` from prompt `01`. **That action already writes
  `admin_override_fulfillment` to `audit_log` with the reason, and the RPC writes a second
  `fulfillment_transition` row plus the event. Do not add a third audit write here.**
- A copy line above the button, verbatim: *"An override is recorded against your account
  with this reason. Use it to correct a mistake, not to move money."*

**States.** *Empty* — `EmptyState`: "Nothing outstanding. Every commitment has been received."
*Loading* — add `app/(admin)/reconciliation/loading.tsx` matching
`app/(admin)/coaches/loading.tsx`. *Error* — a failed read renders the empty state with a
muted "Could not load fulfillments" line, never a blank page. *Permission-denied* — the
`(admin)` layout guard (`:23-24`) covers it; do not add a second check.

## Nudge emails

### Template — `emails/fulfillment-nudge-email.tsx`

New React Email template using `@react-email/components`, styled like
`emails/notification-email.tsx` (neutral, not the celebratory green of the handshake).

```tsx
interface FulfillmentNudgeEmailProps {
  recipientName: string
  audience: 'sponsor' | 'coach' | 'admin'
  sponsorName: string
  teamName: string
  ftcTeamNumber: number | null
  amountCents: number
  status: 'pledged' | 'agreement_signed' | 'payment_sent'
  daysOpen: number
  ctaUrl: string
  ctaLabel: string
}
```

**There is deliberately no `paymentReference` prop.** Make it structurally impossible to leak
rather than relying on a reviewer noticing. A test asserts the string does not appear in the
file.

Copy per audience — write these, do not improvise:

- **sponsor, awaiting payment:** "You committed {amount} to {team} {days} days ago. Once
  you've sent the check or transfer, mark it sent so the team knows to watch for it."
- **sponsor, second notice at 21 days:** "{team} still hasn't confirmed receipt of the
  {amount} you marked sent {days} days ago. It may be worth checking with your AP team."
- **coach, awaiting receipt:** "{sponsor} marked a {amount} payment as sent {days} days ago.
  Confirm it when it lands — that's what closes the loop and triggers your acknowledgment
  letter." *(The acknowledgment letter is prompt `04`. Referencing it in copy is fine; do
  not link to a route that does not exist yet.)*
- **admin, escalation:** "{sponsor} → {team}, {amount}, {status} for {days} days. Both sides
  have stopped responding to automated reminders."

### Sender — `lib/notify.ts`

```ts
export async function sendFulfillmentNudgeEmail(args: {
  fulfillmentId: string
  to: string
  replyTo?: string
  recipientName: string
  audience: 'sponsor' | 'coach' | 'admin'
  sponsorName: string
  teamName: string
  ftcTeamNumber: number | null
  amountCents: number
  status: 'pledged' | 'agreement_signed' | 'payment_sent'
  daysOpen: number
}): Promise<NotifyResult>
```

- Route through `sendViaResend` (`:46-58`) so it inherits the never-throws contract, the
  Sentry report, and the `NotifyResult` shape. **No sender in this module may throw**; the
  cron depends on that to keep sweeping past a bad address.
- `from: env.RESEND_FROM_EMAIL`. `replyTo` = the **counterparty's** real address, falling
  back to `SUPPORT_EMAIL` — the same reasoning as `lib/notify.ts:194-199`: production forces
  `noreply@`, so a nudge with no `replyTo` is a dead end. Sponsor nudge → coach's email;
  coach nudge → sponsor's `contact_email`; admin escalation → `SUPPORT_EMAIL`.
- `idempotencyKey: sha256(fulfillmentId + 'nudge' + audience + YYYY-MM-DD)` — same
  `createHash` pattern as `:210`. A cron retry inside the same UTC day cannot double-send.
- Pair it with `createInAppNotification({ …, type: 'general', skipEmail: true })` so the
  recipient's inbox matches, without double-emailing. `skipEmail: true` is correct here and
  only here: this sender *is* the richer dedicated email.

**This is a transactional notification, not sponsor outreach.** Core Mandate 2 gates *pitch
dispatch* through `lib/dispatch.ts`; a reminder about a commitment the sponsor already made
is the `createInAppNotification` path. Do not route it through `dispatchApprovedSubmission`.

## The nudge cron

**Route:** `app/api/cron/nudge-fulfillments/route.ts`.

Copy the auth block from `app/api/cron/expire-submissions/route.ts:11-32` **verbatim** —
`Bearer` prefix check, `env.CRON_SECRET`, length check before `crypto.timingSafeEqual`
(the length guard is not decoration; `timingSafeEqual` throws on a length mismatch), and the
`try/catch` around the compare that returns 401 rather than 500.

Body:

1. `createAdminClient()`. Select open fulfillments with the counterparty contacts:
   ```ts
   .from('funding_fulfillments')
   .select(`id, status, amount_cents, sponsor_id, team_id, last_nudged_at,
            pledged_at, agreement_signed_at, payment_sent_at,
            teams:team_id(team_name, ftc_team_number, owner_id, profiles:owner_id(email, full_name)),
            sponsors:sponsor_id(company_name, contact_email, contact_name)`)
   .in('status', [...OPEN_FULFILLMENT_STATUSES])
   ```
   That predicate matches `idx_fulfillments_open` from `0076`.
2. For each row, `nudgePlan(row)`. Skip `target: null`.
3. Send: `sendFulfillmentNudgeEmail` **plus** `createInAppNotification({ skipEmail: true })`
   to the right recipient profile(s). For a sponsor target, fan out to every profile with
   `role='sponsor'` and `sponsor_id = row.sponsor_id`, the same shape as
   `app/actions/moderation.ts:113-131`. For an admin target, fan out to every
   `role='admin'` profile.
4. Stamp `last_nudged_at = now()` **only after** at least one channel succeeded, so a total
   send failure retries tomorrow instead of being silently swallowed for a fortnight.
5. Wrap every per-row send in `try/catch` + `Sentry.captureException` — one bad address must
   not abort the sweep (`expire-submissions:101-105` is the pattern).
6. Write one `audit_log` row via the admin client: `action: 'cron_nudge_fulfillments'`,
   `entity_type: 'funding_fulfillments'`, `entity_id: null`, `metadata: { scanned, nudged_sponsor,
   nudged_coach, escalated_admin, failed }`. Same reasoning as `expire-submissions:108-127`:
   on Vercel Hobby the logs are gone within the hour, so the audit row is the only durable
   answer to "did it run?".
7. Return `NextResponse.json({ scanned, nudged, escalated, failed })`.

**`vercel.json`:**

```json
{
  "crons": [
    { "path": "/api/cron/expire-submissions", "schedule": "0 2 * * *" },
    { "path": "/api/cron/nudge-fulfillments", "schedule": "0 14 * * *" }
  ]
}
```

14:00 UTC is mid-morning in US business hours (a reminder should land when someone can act on
it) and is twelve hours clear of the existing job, so a slow expiry sweep can never overlap
it. **Vercel Hobby allows only a small number of once-daily cron jobs — this takes the second
slot. Confirm the current limit in the Vercel dashboard before adding it; if the project is
already at the cap, fold the nudge sweep into `expire-submissions` instead of dropping it,
and say so in the PR.** Any *future* scheduled work must ride one of these two routes, which
is exactly why prompt `02`'s W-9 renewal sweep was told to attach to the existing job.

`/api/cron(.*)` is already public in `middleware.ts:15`, so an unauthenticated call reaches
the handler and gets a JSON 401 from the Bearer check — never a redirect to `/login`. Do not
add the route to any matcher.

## Dev preview fixtures

All three preview modes are forced off in production, and every one of them now renders a
surface this slice touches. **A preview that throws is a broken preview** — the fixture
clients return `[]` for an unknown table, so a missing key degrades to an empty section
rather than a crash, but an empty Funding tab is not a usable preview.

- **`lib/dev-preview.ts`** (sponsor) — add a `funding_fulfillments` key to `FIXTURES`
  (`:322-334`) with one row per status, each carrying a pre-baked `teams: { team_name, … }`
  join object. Its builder (`:346-377`) **ignores filters entirely** and pre-bakes nested
  joins into the fixture rows, so `.eq('sponsor_id', …)` is a no-op and the join must be
  literal. Match the existing `transactions` fixture at `:318-320` for shape.
- **`lib/dev-coach-preview.ts`** — add `funding_fulfillments` and `team_payout_profiles` to
  `DATA` (`:172-181`). Its `MockQuery` (`:186-255`) **does honour** `.eq` / `.in` / `.order`,
  so every row needs a real `team_id === TEAM_ID` and a real `status` or it will filter
  itself out. Give the payout profile a *verified* W-9 by default and leave a commented-out
  rejected variant next to it so the banner's other states can be eyeballed by swapping one
  line.
- **`lib/dev-bypass.ts`** (admin) — add `funding_fulfillments` and
  `funding_fulfillment_events` to `DATA` (`:63-211`), spanning all four aging buckets
  (backdate `pledged_at` / `payment_sent_at` with the file's `iso(daysAgo)` helper at `:29-30`
  so the aging report actually shows four colours). Its `MockQuery` (`:214-281`) honours
  filters, same as the coach one.

> **Note for the runner:** the brief for this prompt named only `lib/dev-preview.ts` and
> `lib/dev-coach-preview.ts`. `lib/dev-bypass.ts` is required as well, because the admin
> reconciliation dashboard is the third surface and `npm run dev:admin-preview` is how it
> gets looked at without a live database.

Use valid enum and CHECK values in every fixture. The existing sponsor `transactions` fixture
(`lib/dev-preview.ts:319`) carries `decision_type: 'approve'`, which is not one of
`transactions_ledger`'s allowed values (`full` | `partial`) — a pre-existing inaccuracy. Do
not copy it, and do not fix it in this slice.

## Out of scope

- Any migration. If a surface here seems to need a column, it does not — re-read `0076`.
- Receipts, acknowledgment letters, and anything that drives `payment_received → receipted`
  — prompt `04`. Do not call `record_fulfillment_transition` with `'receipted'` from any code
  in this slice.
- Making `agreement_signed` a blocking gate — prompts `05`/`06`.
- Blocking a settle or a dispatch on "W-9 on file". Prompt `02` collects and exposes the
  fact; turning it into a gate is a separate product decision.
- A CSV export of the aging report. `/api/admin/export` is submissions-shaped, a second
  export shape is its own slice, and `payment_reference` must never enter a spreadsheet.
- Changing `transactions_ledger`, `sponsors.funding_used_cents`, the capacity RPCs, or the
  expiry cron's existing behaviour.
- Adding a `notifications.type` CHECK value. Use `'general'`.
- A real-time or push channel. SWR polling exists for the admin badge; nothing here needs it.

## Guardrails specific to this slice

1. **`payment_reference` never leaves the row.** Not in an email prop, a notification body,
   `audit_log.metadata`, event metadata, a CSV, a URL, or a log line. The email template must
   not even accept it as a prop.
2. **Import status sets from `lib/fulfillment-status.ts`.** No component may re-declare
   `['pledged','payment_sent',…]`; that drift is exactly what `lib/submission-status.ts`
   exists to prevent (read its header).
3. **The UI never decides who may transition — it only decides what to render.**
   `canTransition()` hides buttons; `record_fulfillment_transition` is the enforcement point.
   A sponsor calling `confirmPaymentReceived` directly must still fail server-side.
4. **Use the RLS-respecting client on every page.** The admin client appears in this slice in
   exactly one place: the cron route. A page that reaches for `createAdminClient()` is a bug —
   it also silently defeats the dev preview modes.
5. **No new migration, no new env var, no new dependency.**
6. **Cron auth is copied, not rewritten.** Reuse the `expire-submissions` block verbatim,
   including the length check before `timingSafeEqual`.
7. **A notify failure must never abort a sweep or a page render.** Every sender returns
   `NotifyResult`; check it, log it, keep going.
8. **`last_nudged_at` is the only write this slice makes to `funding_fulfillments`, and it
   happens through the admin client in the cron.** Do not add an UPDATE policy to the table.
9. **COPPA:** none of these surfaces may render a student name, age, or photo. They show
   organisations, adult coaches, and money.
10. **Do not touch the two settle RPCs or the capacity model.** `_CONTEXT` §4 is finished
    work; this slice reads beside it.

## Files you will touch

**Create:**
- `lib/fulfillment-aging.ts`
- `components/sponsor/mark-payment-sent-dialog.tsx`
- `components/coach/funding-tab.tsx`
- `components/coach/confirm-receipt-dialog.tsx`
- `app/(admin)/reconciliation/page.tsx`
- `app/(admin)/reconciliation/loading.tsx`
- `components/admin/reconciliation-table.tsx`
- `components/admin/fulfillment-override-dialog.tsx`
- `emails/fulfillment-nudge-email.tsx`
- `app/api/cron/nudge-fulfillments/route.ts`
- `lib/__tests__/fulfillment-aging.test.ts`
- `tests/e2e/fulfillment-ui.spec.ts`

**Modify:**
- `app/(sponsor)/sponsor/funding/page.tsx` (rewritten)
- `app/(coach)/dashboard/page.tsx` (two reads added to the `Promise.all`, two props passed)
- `components/coach/dashboard-shell.tsx` (tab + alias + dispatch + props)
- `components/coach/coach-sidebar.tsx` (nav entry)
- `components/admin/admin-sidebar.tsx` (nav entry)
- `components/ui/status-badge.tsx` (six fulfillment statuses in `STATUS_CONFIG`)
- `lib/notify.ts` (`sendFulfillmentNudgeEmail`)
- `vercel.json` (second cron)
- `lib/dev-preview.ts`, `lib/dev-coach-preview.ts`, `lib/dev-bypass.ts` (fixtures)

## Tests

**Unit — `lib/__tests__/fulfillment-aging.test.ts` (Vitest):**

- `agingBucket` boundaries are exact: 13 → `on_track`, 14 → `aging`, 29 → `aging`,
  30 → `stale`, 59 → `stale`, 60 → `escalate`.
- `statusEnteredAt` picks `payment_sent_at` for `payment_sent` and `agreement_signed_at` for
  `agreement_signed`, and falls back to `pledged_at` when the specific stamp is null.
- `nudgePlan` returns `target: null` for every status in `TERMINAL_FULFILLMENT_STATUSES`,
  whatever the age.
- `nudgePlan` returns `target: null` when `last_nudged_at` is 13 days old, and a target when
  it is 15 — `NUDGE_REPEAT_DAYS` is honoured.
- `pledged` at 13 days → null; at 14 days → `sponsor`.
- `payment_sent` at 9 days → null; at 10 → `coach`; at 21 → both a coach nudge and the
  sponsor second notice are reachable (assert whatever shape you chose encodes that).
- Anything at 90+ days → `admin`, and that outranks the counterparty target.
- Every threshold is asserted **by reference** to `NUDGE_THRESHOLDS` / `AGING_BUCKETS`, not by
  a repeated literal.

**Unit — extend `lib/__tests__/remediation-invariants.test.ts`** (the file already reads
source and asserts properties of it):

- The literal string `payment_reference` (and `paymentReference`) does not appear in
  `emails/fulfillment-nudge-email.tsx`, in `app/api/cron/nudge-fulfillments/route.ts`, or in
  the `sendFulfillmentNudgeEmail` body in `lib/notify.ts`.
- No component under `components/{coach,sponsor,admin}` re-declares a fulfillment status
  array literal — regex for `'pledged'` appearing inside a `[` … `]` outside
  `lib/fulfillment-status.ts`.

**E2E — `tests/e2e/fulfillment-ui.spec.ts` (Playwright). The security boundaries are
mandatory, not optional extras:**

- Sponsor A's `/sponsor/funding` lists A's fulfillments only. Seed a fulfillment for Sponsor
  B against a differently-named team and assert that team's name is **absent from the DOM**.
- **Direct PostgREST, not through the app:** as Sponsor B,
  `GET /rest/v1/funding_fulfillments?select=id,payment_reference` returns none of A's rows;
  as anon it returns `[]`; `PATCH` and `DELETE` as any authenticated role affect 0 rows.
- Coach X's `?tab=funding` shows X's rows only; Team Y's sponsor never appears.
- **A coach navigating to `/reconciliation` lands on `/dashboard?redirected=admin`; a sponsor
  lands on `/sponsor/dashboard?redirected=admin`.** Assert the URL, not just the absence of
  content.
- A sponsor's funding page contains no "Confirm funds received" control; a coach's funding tab
  contains no "Mark payment sent" control.
- A sponsor marks payment sent → the row moves to `payment_sent`, the coach's tab shows it
  under **In transit**, and the coach receives one in-app notification whose body does **not**
  contain the reference string that was entered.
- The reference renders masked; after clicking "Show" the full value is visible — and it is
  visible to the owning coach as well as the sponsor.
- **`GET /api/cron/nudge-fulfillments` with no `Authorization` header → 401 JSON (not a
  302 to `/login`); with a wrong bearer → 401; with `Bearer ${CRON_SECRET}` → 200.**
- Running the nudge route twice in the same day produces one notification per fulfillment and
  one `cron_nudge_fulfillments` audit row per run.
- A fulfillment nudged today is skipped tomorrow (`NUDGE_REPEAT_DAYS`), and picked up again
  once `last_nudged_at` is backdated past the window.
- Admin override from `payment_sent` back to `pledged` succeeds, the reason is visible in
  `/admin/audit`, and the reconciliation row's bucket recomputes from the new
  `statusEnteredAt`.
- The override dialog offers no target status for which `canTransition(from, to, 'admin')` is
  false — assert the option list for a `receipted` row is empty and the control is disabled.

## Acceptance criteria

- [ ] `/sponsor/funding` shows, per commitment, the real `funding_fulfillments.status` — not
      a hardcoded chip — and the four summary figures reconcile: awaiting + in transit +
      received equals total committed, excluding cancelled.
- [ ] A sponsor can record a payment as sent with a method, an optional reference and a date,
      and the coach sees it as "in transit" within one page load.
- [ ] The coach confirming receipt moves the row to `payment_received` on both parties' views.
- [ ] A coach with no `team_payout_profiles` row is told so on the Funding tab, with a link
      that reaches the form — not left to infer it from an absent section.
- [ ] A coach whose W-9 was rejected sees the rejection reason on the Funding tab.
- [ ] No screen tells a coach the platform is withholding funds; the copy says the platform
      never holds money.
- [ ] `/reconciliation` shows totals for pledged vs received vs receipted and an aging list
      sorted oldest first with four visually distinct buckets.
- [ ] An admin override requires a reason of at least 10 characters and that reason is
      retrievable from `/admin/audit` afterwards.
- [ ] The override dialog never offers a transition the RPC would reject.
- [ ] A fulfillment sitting in `pledged` for 14 days produces exactly one sponsor email and
      one in-app notification, and none of them contains the payment reference.
- [ ] A fulfillment sitting in `payment_sent` for 10 days produces exactly one coach nudge.
- [ ] A fulfillment open 90 days notifies admins and stops nudging the counterparties.
- [ ] Two cron runs on the same UTC day send at most one email per fulfillment per audience.
- [ ] `GET /api/cron/nudge-fulfillments` without the secret returns JSON 401, never a redirect.
- [ ] Each cron run leaves a `cron_nudge_fulfillments` row in `audit_log` with its counts.
- [ ] `grep -rn "payment_reference\|paymentReference" emails/ app/api/cron/` returns nothing.
- [ ] All three preview modes render their new surface with fixture data:
      `npm run dev:sponsor-preview` → `/sponsor/funding`,
      `npm run dev:coach-preview` → `/dashboard?tab=funding`,
      `npm run dev:admin-preview` → `/reconciliation`. None throws.
- [ ] `git diff --stat supabase/migrations` is empty — this slice adds no SQL.
- [ ] `npm run typecheck && npm run lint && npm run build && npm run test` all pass.

## Rollback

There is no migration to reverse. `git revert` this prompt's commit, then:

1. **Remove the second entry from `vercel.json` and redeploy.** A cron pointed at a deleted
   route 404s once a day forever; Vercel will keep invoking it and the failure is easy to
   mistake for a real outage later.
2. Nothing else needs undoing. `funding_fulfillments.last_nudged_at` values written before
   the revert are inert — `0076` created the column and no other code reads it.
3. Deploys are manual: `vercel deploy --prod --yes`. Pushing the revert to `main` does
   nothing on its own.

Reverting this slice returns the product to "the state machine exists and nothing drives it",
which is prompt `01`'s end state and is internally consistent.

## Commit

```
feat(funding): sponsor, coach and admin surfaces over the fulfillment machine

Prompt 01 built funding_fulfillments and three server actions; nothing
called them. Adds the sponsor payment tracker (real per-commitment status
plus a mark-payment-sent flow capturing method, reference and date), the
coach Funding tab (incoming pledges, confirm-receipt, and an honest
payout-profile readiness banner sourced from team_payout_profiles), and
an admin reconciliation dashboard with an aging report, pledged/received/
receipted totals and a reason-required manual override. Adds a nudge
email template, a typed never-throws sender, and a second daily cron that
writes last_nudged_at, escalating to admins after 90 days. No migration.
```
