# Prompt 12 — Admin-moderated sponsor ↔ coach Q&A thread

> **Prerequisites:** None
> **Reserved migration:** `0085_submission_qa_thread.sql` — verify it is still free with `ls supabase/migrations | tail -3`
> **Scope:** large · ~24 files
> **Leaves the repo:** green and shippable on its own

## Why this exists

A pitch is one-shot today. `approve_submission_atomic` dispatches it, the sponsor gets a
14-day link, and the only inputs the system will accept back are *fund in full*, *fund
partially*, or *decline* (`app/actions/sponsor-decision.ts:19-23`,
`supabase/migrations/0071_token_decision_check_status_first.sql:89-106`). A sponsor with a
single question — "is the 501(c)(3) the school district or a separate booster club?", "does
the $4,200 include the regional entry fee?" — has nowhere to ask it. The one channel that
exists is `emails/handshake-email.tsx`, and that only fires *after* an acceptance.

So the sponsor declines. Declining is the cheap, safe, reversible-looking option, and it
costs the coach the reservation and the slot.

This slice adds a Q&A thread scoped to a single submission, moderated by admins.

---

## Two constraints that shape every decision below

### COPPA is absolute

Messages are strictly between **one adult coach** and **one sponsor contact**. No student
names, no student photos, no ages, no school-schedule details that identify a minor.

"We put a warning in the composer" is not enforcement. The actual controls, in order of
strength:

1. **Every coach→sponsor message is read by an admin before the sponsor sees it.** This is
   the whole reason the moderation is asymmetric (below). The coach is the only party who
   *has* student information to leak, so the coach's direction is the one that gets gated.
2. **Plain text only, no attachments, no HTML, no image embedding.** The body goes through
   `plainTextField` (`lib/schemas/submission.ts:6-34`), which runs `htmlToPlainText` and
   flattens any markup — an `<img src="…team-photo-with-faces.jpg">` becomes nothing. There
   is no upload path on this feature at all. Do not add one.
3. **A standing, non-dismissible warning above the coach composer**, and a standing
   reminder checklist rendered in the admin release queue next to the message body.
4. **A `Report this message` action on the sponsor→coach direction**, because that
   direction is *not* pre-moderated and the realistic failure there is a sponsor
   *asking* for student details. Reporting flags the row, writes `audit_log`, and notifies
   admins.

Explicitly **not** building: a student-PII classifier / regex heuristic. It would be noisy,
would be trusted more than it deserves, and would let the admin review degrade into
rubber-stamping whatever the machine passed. The human read is the control.

### Admin-Gatekept Outreach must not be laundered through this thread

Core Mandate 2 (`_CONTEXT.md` §0) says sponsor-facing **pitch dispatch** goes exclusively
through `dispatchApprovedSubmission` (`lib/dispatch.ts`). A message thread is a beautiful
place to accidentally rebuild dispatch: a coach pastes their whole pitch into a "reply" and
the platform mails it to a sponsor with no admin approval.

The controls:

- Coach→sponsor messages **never auto-send**. They sit at `status = 'pending'` until an
  admin releases them. That is the same gate `app/actions/moderation.ts` applies to pitches.
- The release email (`emails/thread-message-email.tsx`, new) carries the released message
  body and a link — and **no portfolio content, no budget, no media, no team fields**.
  `lib/dispatch.ts` is not touched by this slice and must not be imported by it.
- A coach cannot open a thread. Only a sponsor can post the first message. A thread with no
  sponsor message has no coach composer.
- Composing is only possible while the pitch is genuinely live
  (`AWAITING_SPONSOR_STATUSES`, `lib/submission-status.ts:21`) and inside `expires_at`. This
  is enforced in the database, not only in the action.

---

## Current state (verified)

### There is no messaging of any kind

- `grep -rn "message" app/actions` returns only the sponsor-application free-text field
  (`lib/schemas/limits.ts:18`, `message: 3000`) and error strings. No table, no action, no
  component.
- The only sponsor↔coach communication that exists is `sendHandshakeEmail`
  (`lib/notify.ts:158-234`), which fires once on acceptance and cross-wires `replyTo` so the
  two humans continue **off-platform**. That is the current answer to "how do they talk",
  and it only unlocks after the money decision is already made.

### The three surfaces a thread has to live on

| Surface | File | What exists today |
|---|---|---|
| Sponsor portal | `app/(sponsor)/sponsor/submissions/[id]/page.tsx:22-40` → `components/sponsor/review-shell.tsx:80` | Full review console. Reads through the RLS-respecting server client; ownership re-checked in TS at `page.tsx:38`. |
| Tokenized sponsor view | `app/sponsor-view/[token]/page.tsx` | Public route. Resolves `sha256(token)` at `:25`, reads through the **admin client** at `:23`, renders `SponsorDecisionPanel` only when `!expired && !decided && isAwaitingSponsor(status)` (`:300-314`). |
| Admin queue | `app/(admin)/moderation/page.tsx` | Two sections: `ModerationQueue` (`:63`, pending pitches) and `InFlightSubmissions` (`:72`, dispatched/delivered/opened). |

**Coach side — read this before planning the UI.** There is **no coach submission detail
page.** `find "app/(coach)" -type f` returns only `dashboard`, `sponsors/browse`,
`submissions/[id]/edit`, `submissions/new`, `team/*`. `submissions/[id]/edit/page.tsx` is a
`PortfolioForm` and is only meaningful for coach-editable statuses; a thread only matters
for `dispatched | delivered | opened`, which are **not** editable. So "add the thread to the
coach submission page" means **creating** `app/(coach)/submissions/[id]/page.tsx`. Do not
bolt a message thread onto the edit form.

The coach dashboard lists submissions at `app/(coach)/dashboard/page.tsx:33-64` and computes
`is_locked` inline at `:57` (a hand-rolled duplicate of `COACH_EDITABLE_STATUSES`,
`lib/submission-status.ts:35` — noted, not in scope to fix). That list is where the link to
the new detail page goes.

### The moderation pattern you are mirroring

`app/actions/moderation.ts` is the reference: `requireAdmin()` → RPC or guarded write →
`audit_log` via the admin client → `createInAppNotification`. The sponsor-side notification
fan-out at `:113-131` (every `profiles` row with `role='sponsor'` and matching `sponsor_id`)
is exactly the fan-out a message release needs. Copy its shape.

### Rate limiting

`check_throttle(p_key text, p_limit int, p_window interval)` —
`supabase/migrations/0055_coach_denial_and_throttle.sql:33-57`. `SECURITY DEFINER`,
`EXECUTE` revoked from `PUBLIC`/`anon`/`authenticated`, granted to `service_role` only
(`:61-64`), backed by the deny-all `request_throttle` table (`:18-29`). Callable **only**
through the admin client.

The TypeScript wrapper `checkThrottle` lives at `app/actions/sponsor.ts:18-43`. It fails
**open** with a Sentry report so a throttle outage cannot take the surface down. It is
module-private, and `app/actions/sponsor.ts` is a `'use server'` module — **you cannot
simply add `export` to it**, because Next requires every export of a `'use server'` module
to be an async server action. See "Files you will touch" for the extraction.

`app/actions/auth.ts:316-329` calls the RPC inline rather than through that helper. Leave it
alone.

### Status and expiry vocabulary

`lib/submission-status.ts` is canonical — import from it, never re-declare:

- `AWAITING_SPONSOR_STATUSES = ['dispatched','delivered','opened']` (`:21`)
- `TERMINAL_STATUSES = ['approved','declined','expired','bounced']` (`:27`)
- `isAwaitingSponsor()` (`:39`), `isTerminal()` (`:43`)

`submissions.expires_at` is stamped `now() + interval '14 days'` by
`approve_submission_atomic` (`supabase/migrations/0044_approve_submission_consolidate.sql:26,56`)
and the nightly cron sweeps overdue rows to `expired`.

### Contradiction found while verifying — read this

The brief says the message body is sanitized "via the existing `plainTextField` /
`richTextField` helpers." **Neither helper is exported.** `plainTextField` is a module-local
`function` at `lib/schemas/submission.ts:6`; `richTextField` is module-local at
`lib/schemas/team.ts:13`. You must add `export` to `plainTextField` (a one-word change, no
behaviour change) before a new schema file can use it. Do **not** touch `richTextField` —
see the decision below.

---

## What you are building

1. `submission_messages` — one table, RLS on, read-only policies per role, all writes
   through server actions on the admin client.
2. Two `SECURITY DEFINER` predicate helpers so the policies do not recurse.
3. A `BEFORE INSERT` trigger that enforces attribution, liveness, and a per-thread cap in
   the database — not only in TypeScript.
4. Four server actions: `postSponsorQuestion`, `postCoachReply`, `releaseCoachReply` /
   `rejectCoachReply`, `reportSubmissionMessage`.
5. One token-path action, `postSponsorQuestionByToken`, that authenticates by token hash and
   **does not consume the token**.
6. A new email template + typed sender for released messages.
7. Thread UI on four surfaces, including a **new** coach submission detail page.

### Decision: asymmetric moderation

**Sponsor → coach posts immediately. Coach → sponsor waits for an admin.**

The asymmetry is justified in one line: the sponsor already holds an admin-approved pitch
and is the party initiating contact, so their question adds no new outreach and carries no
student PII — whereas the coach's reply is new material travelling toward a sponsor, which
is precisely what Core Mandate 2 gates and precisely where COPPA risk lives.

Concretely: a sponsor message is inserted with `status = 'released'` and `released_at =
now()`; a coach message is inserted with `status = 'pending'` and is invisible to the
sponsor until an admin sets `released`.

### Decision: the token path DOES get Q&A — yes

Most sponsors never create an account. `dispatchApprovedSubmission` emails a
`/sponsor-view/<token>` link and that is the only surface many of them ever touch; a Q&A
feature that only works in the portal would miss the majority of the people it exists for.

**The token is the credential.** That is not a new trust level — it is exactly the trust
`record_sponsor_decision_atomic` already places in it to move money
(`0071:50-62`). Posting a question is strictly less consequential than approving funding, so
gating it more tightly than the funding decision would be incoherent.

Two constraints follow:

- **Never consume the token when posting.** `0071` exists entirely because the decision RPC
  used to burn the token before validating. A message post must resolve the token
  (`used_at IS NULL AND revoked_at IS NULL AND expires_at > now()`) and leave `used_at`
  untouched. A sponsor who asks a question must still be able to fund afterwards.
- **Attribution.** See below.

### Decision: `author_profile_id` is nullable, with a trigger — not a CHECK

A token-path sponsor has no `profiles` row, so `author_profile_id` cannot be `NOT NULL`.
The row instead carries whichever attribution it has:

```
author_profile_id  uuid NULL  → the portal path (a real profiles row)
author_token_id    uuid NULL  → the token path (submission_access_tokens.id)
author_role        user_role  → always set: 'coach' | 'sponsor'
author_label       text       → always set: display name snapshot at write time
```

Exactly one of the two ids is set **at insert**, and that is enforced by a trigger rather
than a table `CHECK`. The reason is specific and load-bearing: both FKs are
`ON DELETE SET NULL`, and a `CHECK` is re-evaluated when a referential action nulls the
column — so deleting a Clerk account would fail the constraint and abort the cascade. That
is the exact class of breakage
`supabase/migrations/0067_release_reservation_on_submission_delete.sql` exists to handle,
and account deletion runs **no app code**. A trigger fires on `INSERT` only, so the
tombstone state (both ids null, `author_role` and `author_label` intact) is representable
and the thread survives a deleted account with its shape and authorship legible.

### Decision: plain text, not rich text

Use `plainTextField`, not `richTextField`. `richTextField` (`lib/schemas/team.ts:13-41`)
DOMPurify-sanitizes and *keeps* markup, which means it keeps `<img>`. A Q&A message has no
need for formatting and every reason not to carry an image tag. This is a COPPA control, not
a styling preference — say so in the schema comment.

---

## Data model — `supabase/migrations/0085_submission_qa_thread.sql`

Contains `$$`-quoted function bodies → **must** be applied with `psql -f`
(`_CONTEXT.md` §8 rule 2).

### Table

```sql
CREATE TABLE IF NOT EXISTS submission_messages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id     uuid NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,

  -- Attribution: exactly one of these is set at INSERT (see trg_guard_submission_message).
  -- Both may become NULL later via ON DELETE SET NULL; author_role and author_label keep
  -- the row legible, which is why they are NOT NULL and why this is not a CHECK.
  author_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  author_token_id   uuid REFERENCES submission_access_tokens(id) ON DELETE SET NULL,
  author_role       user_role NOT NULL,
  author_label      text NOT NULL,

  body              text NOT NULL,

  status            text NOT NULL DEFAULT 'pending',
  released_by       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  released_at       timestamptz,
  rejected_reason   text,

  flagged_at        timestamptz,
  flagged_by        uuid REFERENCES profiles(id) ON DELETE SET NULL,

  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT submission_messages_status_check
    CHECK (status IN ('pending', 'released', 'rejected')),
  CONSTRAINT submission_messages_author_role_check
    CHECK (author_role IN ('coach', 'sponsor')),
  CONSTRAINT submission_messages_rejected_needs_reason
    CHECK (status <> 'rejected' OR nullif(btrim(rejected_reason), '') IS NOT NULL)
);
```

`status` is `text + CHECK` rather than a new enum, matching `notifications.type`
(`supabase/migrations/0023_admin_fixes.sql:30-40`) — the house idiom for a small, mutable
value set. `author_role` reuses the existing `user_role` enum with a `CHECK` narrowing it;
do not create a new type.

Indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_submission_messages_submission
  ON submission_messages (submission_id, created_at);
CREATE INDEX IF NOT EXISTS idx_submission_messages_pending
  ON submission_messages (created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_submission_messages_flagged
  ON submission_messages (flagged_at) WHERE flagged_at IS NOT NULL;
```

The partial index on `status = 'pending'` is what the admin queue and the badge count read.

### Predicate helpers (SECURITY DEFINER, callable from policies)

`_CONTEXT.md` §8 rule 8: anything reading `submissions` / `teams` from inside a policy goes
through a `SECURITY DEFINER` function or you get 42P17. `sponsor_can_view_team()` exists for
exactly this reason (`_CONTEXT.md` §1). Follow that precedent.

```sql
CREATE OR REPLACE FUNCTION coach_owns_submission(p_submission_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM submissions s
      JOIN teams t ON t.id = s.team_id
     WHERE s.id = p_submission_id
       AND s.deleted_at IS NULL
       AND t.owner_id = current_profile_id()
  );
$$;

CREATE OR REPLACE FUNCTION sponsor_owns_submission(p_submission_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM submissions s
      JOIN profiles p ON p.id = current_profile_id()
     WHERE s.id = p_submission_id
       AND s.deleted_at IS NULL
       AND s.sent_at IS NOT NULL          -- cleared the admin gate; mirrors 0064:59
       AND p.role = 'sponsor'
       AND p.sponsor_id = s.sponsor_id
  );
$$;
```

`sent_at IS NOT NULL` is deliberate and must not be dropped: it is the same admin-gate
marker `submissions_select_sponsor` uses (`0064:55-66`). Without it a sponsor could read a
thread on a draft.

**These two keep `EXECUTE` for `authenticated`,** because RLS policies call them as the
`authenticated` role — the same exception prompt `11` documents for `is_super_admin()`. Put
a comment in the migration saying so, so a future lock-down sweep does not break every read.
Every *other* function this migration adds gets the full treatment:

```sql
REVOKE EXECUTE ON FUNCTION <sig> FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION <sig> TO service_role;
```

### RLS

```sql
ALTER TABLE submission_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sm_select_admin" ON submission_messages;
CREATE POLICY "sm_select_admin" ON submission_messages FOR SELECT
  USING (is_admin());

-- The coach sees every message they wrote (any status, so they can see "awaiting review"
-- and "rejected"), plus counterparty messages only once RELEASED.
DROP POLICY IF EXISTS "sm_select_coach" ON submission_messages;
CREATE POLICY "sm_select_coach" ON submission_messages FOR SELECT
  USING (
    coach_owns_submission(submission_id)
    AND (author_role = 'coach' OR status = 'released')
  );

DROP POLICY IF EXISTS "sm_select_sponsor" ON submission_messages;
CREATE POLICY "sm_select_sponsor" ON submission_messages FOR SELECT
  USING (
    sponsor_owns_submission(submission_id)
    AND (author_role = 'sponsor' OR status = 'released')
  );
```

**No INSERT / UPDATE / DELETE policies at all.** Every write goes through a server action on
the admin client, which is the same shape `transactions_ledger` uses (`0069:14-15`) and the
`_CONTEXT.md` §8 rule 9 recommendation. Because the admin client bypasses RLS, **each action
must re-verify ownership itself** — this is the same discipline the RPCs follow when called
with a `p_*_id` (`_CONTEXT.md` §1). State it in a comment at the top of the new action file.

`released_by` / `released_at` / `rejected_reason` / `flagged_*` therefore have no
client-writable path at all.

> Note, mirroring `0069:33-36`: these policies sublink into `submissions` and `profiles` only
> through the two `SECURITY DEFINER` helpers, so they are insulated from the 42P17 hazard
> `0066` created rules about. Do not inline the helper bodies into the policies.

### Write guard trigger

```sql
CREATE OR REPLACE FUNCTION guard_submission_message_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_sub   submissions%ROWTYPE;
  v_count int;
BEGIN
  -- 1. Exactly one attribution source, and only a sponsor may be token-attributed.
  IF (NEW.author_profile_id IS NULL) = (NEW.author_token_id IS NULL) THEN
    RAISE EXCEPTION 'submission_messages: exactly one of author_profile_id / author_token_id is required'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.author_token_id IS NOT NULL AND NEW.author_role <> 'sponsor' THEN
    RAISE EXCEPTION 'submission_messages: token attribution is sponsor-only'
      USING ERRCODE = '23514';
  END IF;

  -- 2. Asymmetric moderation is a DB rule, not just an app rule.
  IF NEW.author_role = 'coach' AND NEW.status <> 'pending' THEN
    RAISE EXCEPTION 'submission_messages: a coach message must enter review as pending'
      USING ERRCODE = '23514';
  END IF;

  -- 3. The pitch must be genuinely live. The status list duplicates
  --    AWAITING_SPONSOR_STATUSES (lib/submission-status.ts:21) because SQL cannot import
  --    it — the same duplication 0047/0065/0071 already accept (see 0071:70).
  SELECT * INTO v_sub FROM submissions WHERE id = NEW.submission_id;
  IF NOT FOUND OR v_sub.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'submission_messages: submission not found' USING ERRCODE = '23503';
  END IF;
  IF v_sub.status NOT IN ('dispatched', 'delivered', 'opened') THEN
    RAISE EXCEPTION 'submission_messages: this pitch is no longer open for questions'
      USING ERRCODE = '23514';
  END IF;
  IF v_sub.expires_at IS NOT NULL AND v_sub.expires_at <= now() THEN
    RAISE EXCEPTION 'submission_messages: the 14-day window for this pitch has closed'
      USING ERRCODE = '23514';
  END IF;

  -- 4. A coach can never open a thread.
  IF NEW.author_role = 'coach' AND NOT EXISTS (
    SELECT 1 FROM submission_messages m
     WHERE m.submission_id = NEW.submission_id AND m.author_role = 'sponsor'
  ) THEN
    RAISE EXCEPTION 'submission_messages: only the sponsor can open a thread'
      USING ERRCODE = '23514';
  END IF;

  -- 5. Hard per-thread cap. check_throttle limits rate; this limits total volume.
  SELECT count(*) INTO v_count FROM submission_messages WHERE submission_id = NEW.submission_id;
  IF v_count >= 50 THEN
    RAISE EXCEPTION 'submission_messages: this thread has reached its message limit'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_submission_message ON submission_messages;
CREATE TRIGGER trg_guard_submission_message
  BEFORE INSERT ON submission_messages
  FOR EACH ROW EXECUTE FUNCTION guard_submission_message_insert();
```

Rules 3 and 4 are the Admin-Gatekept-Outreach and expiry enforcement, at the layer no write
path can skip — including the service-role admin client, which is what the actions use.
`RETURN NEW` unconditionally at the end; there is no trusted-context escape hatch here, and
that is intentional.

Apply the `REVOKE`/`GRANT` block to `guard_submission_message_insert()` per `_CONTEXT.md`
§8 rule 4. Postgres does not check `EXECUTE` on a trigger function when the trigger fires,
so revoking it only removes direct PostgREST callability — confirm that on your Postgres
version before relying on it, and note the result in your report.

### `submissions` is untouched

This slice adds **no column to `submissions`**, so `guard_submission_writable_columns()`
(`0064:81-190`) needs no allowlist change. Mentioned because `_CONTEXT.md` §8 rule 7 makes
this the first thing to check and it is easy to over-apply. If you find yourself wanting a
`submissions.last_message_at` denormalisation, **don't** — derive it from
`submission_messages` and add the allowlist entry only if a coach must write it, which they
must not.

### Type regeneration

Hand-add or regenerate `lib/supabase/types.ts`: the `submission_messages` Row/Insert/Update
block, and the two new helper functions under `Functions`. `check_throttle` is already there
at `lib/supabase/types.ts:953` — match its shape.

---

## Schemas

### `lib/schemas/limits.ts`

Add one constant, alphabetically adjacent to the existing pitch fields:

```ts
submissionMessage: 2000,
```

Reference it; never hardcode `2000` in the schema. (Existing wart, noted not fixed:
`lib/schemas/submission.ts:38-51` hardcodes `1500`/`1000` instead of reading `LIMITS`. Do
not fix it in this slice — no drive-by refactors.)

### `lib/schemas/submission.ts`

One-word change: `export function plainTextField(...)` at `:6`. No behaviour change.

### `lib/schemas/message.ts` (new)

```ts
import { z } from '@/lib/zod-config'
import { plainTextField } from './submission'
import { LIMITS } from './limits'

// PLAIN text, deliberately — richTextField (lib/schemas/team.ts:13) preserves sanitized
// markup, which means it preserves <img>. A Q&A message must not be able to carry an
// image of a student. This is a COPPA control, not a formatting preference.
const messageBody = plainTextField(
  5,
  LIMITS.submissionMessage,
  'Write a message before sending.',
  `Messages must be ${LIMITS.submissionMessage} characters or fewer`
)

export const postMessageSchema = z.object({
  submissionId: z.string().uuid(),
  body: messageBody,
})

export const postMessageByTokenSchema = z.object({
  token: z.string().min(1),
  body: messageBody,
})

export const releaseMessageSchema = z.object({ messageId: z.string().uuid() })

export const rejectMessageSchema = z.object({
  messageId: z.string().uuid(),
  reason: z.string().trim().min(10, 'Give the coach a reason of at least 10 characters')
    .max(LIMITS.feedback),
})

export const reportMessageSchema = z.object({
  messageId: z.string().uuid(),
  reason: z.string().trim().min(10).max(LIMITS.feedback),
})
```

Always `safeParse`, return the joined issue messages (`_CONTEXT.md` §7).

---

## Server actions — `app/actions/messages.ts` (new)

All follow the canonical five-step shape (`_CONTEXT.md` §7). File-level comment: *every
write here uses the admin client, which bypasses RLS, so every action re-verifies ownership
from the resolved profile / token before it writes.*

### `postSponsorQuestion(input)`

- Guard: `requireSponsor()` → `{ user, sponsorId, adminClient }`.
- Re-verify: read the submission with `adminClient`, assert `sponsor_id === sponsorId`,
  `deleted_at IS NULL`, `isAwaitingSponsor(status)`, `expires_at > now()`. Return a friendly
  message per failure; do not lean on the trigger for the user-facing text.
- Throttle: `checkThrottle(adminClient, \`qa:sponsor:${user.id}\`, 20, '1 hour')`.
- Insert `{ status: 'released', released_at: now(), author_profile_id: user.id,
  author_role: 'sponsor', author_label: user.full_name ?? sponsor contact_name ?? 'Sponsor' }`.
- Audit: `action: 'post_sponsor_question'`, `entity_type: 'submission_messages'`,
  `entity_id: <message id>`, metadata `{ submission_id }`. **Never put the message body in
  `audit_log`** — it is admin-readable forever and this is a COPPA surface.
- Notify: the coach (`teams.owner_id`), `type: 'general'`, title
  `"<Sponsor> asked a question about your pitch"`, body **omitted** — the email mirror would
  otherwise carry the message text to an inbox before anyone reviewed the thread. Link via
  `submissionId`.

### `postCoachReply(input)`

- Guard: `requireVerifiedCoach()`. Surface `e.code === 'NEEDS_VERIFICATION'` to the caller
  (`_CONTEXT.md` §7).
- Re-verify: the submission's team is owned by `user.id`; liveness as above; and at least one
  sponsor message exists (friendly error, not the trigger's).
- Throttle: `checkThrottle(adminClient, \`qa:coach:${user.id}\`, 10, '1 hour')`.
- Insert `{ status: 'pending', author_profile_id: user.id, author_role: 'coach',
  author_label: user.full_name ?? 'Coach' }`.
- Audit: `post_coach_reply`.
- Notify **every admin**, mirroring the fan-out in `app/actions/submission.ts:170-183`:
  `type: 'general'`, `"Coach reply awaiting release"`, body pointing at `/moderation`.
- Return `{ success: true, pending: true }` so the UI can say "sent for review", not "sent".

### `releaseCoachReply(input)` / `rejectCoachReply(input)`

- Guard: `requireAdmin()` — a reviewer, per prompt `11`'s table. Releasing a message is
  moderation, not governance.
- Guarded update: `.eq('id', messageId).eq('status','pending').eq('author_role','coach')`
  then `.select()`; zero rows → `'This message was already handled.'` (the same optimistic
  pattern `markNotificationRead` uses at `app/actions/notifications.ts:27-38`).
- Release sets `status='released'`, `released_by=user.id`, `released_at=now()`.
  Reject sets `status='rejected'`, `rejected_reason`, and also `released_by`/`released_at`
  as the reviewer stamp — or add `reviewed_by`-style columns if you prefer; pick one and
  document it in the migration comment.
- Audit: `release_coach_reply` / `reject_coach_reply`, metadata `{ submission_id }`
  (again, no body).
- Notify on release:
  - **Portal sponsors** — fan out over `profiles` where `role='sponsor'` and
    `sponsor_id = submission.sponsor_id`, exactly as `app/actions/moderation.ts:113-131`
    does. `createInAppNotification({ type: 'general', skipEmail: true, ... })`, because the
    dedicated email below is richer.
  - **Everyone** — one `sendThreadMessageEmail(messageId)`. For a token-only sponsor there
    is no `profiles` row, so `createInAppNotification` is impossible and email is the only
    channel. Say this in a comment.
- Notify on reject: the coach, `type: 'general'`, with `rejected_reason` in the body.

### `reportSubmissionMessage(input)`

- Guard: `requireAuth()`, then assert the caller is the coach on that submission (the only
  direction that is un-moderated is sponsor→coach, so only a coach reports).
- Sets `flagged_at`, `flagged_by`. Does **not** change `status` — the message was already
  delivered; hiding it retroactively would be theatre.
- Audit: `report_submission_message`, metadata `{ submission_id, reason }`. This is the one
  place the reason text is stored, and it is the reporter's words, not a student's.
- Notify every admin.

### `postSponsorQuestionByToken(input)` — the public path

- **No auth guard.** Authenticates by `sha256(token)` exactly as
  `app/sponsor-view/[token]/page.tsx:25` and `app/actions/sponsor-decision.ts` do.
- Resolve `submission_access_tokens` on `token_hash` with `used_at IS NULL AND revoked_at
  IS NULL AND expires_at > now()`. **Do not write `used_at`.** The whole point of `0071` is
  that a live link stays live; a question must never cost the sponsor their ability to fund.
- Throttle twice: `qa:token:<token_id>` at 10 / '1 hour', and `qa:ip:<getClientIp()>` at
  20 / '1 hour' (`getClientIp` is `lib/actions-utils.ts:39-42`).
- Insert `{ author_token_id, author_profile_id: null, author_role: 'sponsor',
  author_label: sponsors.contact_name ?? sponsors.company_name, status: 'released' }`.
- Audit with `actor_id: null` — the same convention `record_sponsor_decision_atomic` uses for
  the token path (`0071:126`).
- Notify the coach, as in `postSponsorQuestion`.

### `lib/throttle.ts` (new) — required extraction

Move `checkThrottle` out of `app/actions/sponsor.ts:18-43` into `lib/throttle.ts` verbatim
(parameterise the `[sponsor-apply]` log prefix into a `context` argument), and have
`app/actions/sponsor.ts` import it, deleting the local copy. This is not a drive-by: a
`'use server'` module can only export async server actions, so the helper is unreachable
from `app/actions/messages.ts` where it lives today. Keep the fail-open behaviour and the
Sentry report exactly as-is — a throttle outage must not take the sponsor-view page down.
Leave `app/actions/auth.ts:316-329` alone.

---

## Email

### `emails/thread-message-email.tsx` (new)

Model it on `emails/notification-email.tsx` — same `@react-email/components` imports, same
`main` / `container` / `h1` / `text` / `button` / `hr` / `footer` style objects.

Props: `{ recipientName, counterpartyLabel, teamName, sponsorName, messageBody, ctaUrl?,
ctaLabel? }`.

Content rules, and they are the Core Mandate 2 boundary:

- The released message body, and nothing else from the pitch.
- **No** budget items, media URLs, mission statement, achievements, team stats, or any other
  portfolio field. If you find yourself importing `lib/dispatch-budget.ts`, stop.
- `ctaUrl` is the portal thread for an account sponsor, or `/sponsor-view/<token>` for a
  token sponsor **only when the token is still unused, unrevoked and unexpired**; otherwise
  render no button at all.

### `sendThreadMessageEmail(messageId)` in `lib/notify.ts`

- Same contract as every other sender: returns `NotifyResult`, **never throws**, reports to
  Sentry via `notifyFailure` (`lib/notify.ts:34-43`), sends through `sendViaResend`
  (`:46-58`).
- `from: env.RESEND_FROM_EMAIL`. `replyTo` → `SUPPORT_EMAIL` (`lib/site-config.ts`), **not**
  the coach's address. Cross-wiring `replyTo` to the humans is what `sendHandshakeEmail`
  does deliberately *after* a match (`lib/notify.ts:194-216`); doing it here would create the
  unmoderated backchannel this whole design exists to prevent.
- `idempotencyKey: createHash('sha256').update(messageId + 'thread').digest('hex')` — same
  pattern as `:210` / `:220`.

---

## UI

### 1. Coach — new detail page

- **`app/(coach)/submissions/[id]/page.tsx`** (new). Server component, `getAuthedProfile()`,
  team-ownership check mirroring `app/(coach)/submissions/[id]/edit/page.tsx:14-33`
  (`notFound()` on a miss). Renders a read-only pitch summary + `components/messages/thread.tsx`.
- **`app/(coach)/submissions/[id]/loading.tsx`** (new) — skeleton matching the sibling
  `edit/loading.tsx`.
- `app/(coach)/submissions/[id]/not-found.tsx` already exists and covers this route segment.
- **Link in from the dashboard list**: `components/coach/dashboard-shell.tsx` renders the
  submissions array built at `app/(coach)/dashboard/page.tsx:33-64`. Add an unread-question
  count to that projection and a "View thread" link per row.
- States: **empty** — "No questions yet. If <Sponsor> has one, it will appear here."
  **pending** — the coach's own unreleased reply renders inline with an "Awaiting admin
  review" pill and muted styling. **rejected** — renders with the admin's reason, so the
  coach can rewrite. **closed** — composer replaced by "This pitch is no longer awaiting a
  sponsor decision, so the thread is read-only."

### 2. Sponsor portal

- `app/(sponsor)/sponsor/submissions/[id]/page.tsx` — fetch released + own messages through
  the RLS-respecting server client (the policies already do the filtering; do not re-filter
  in TS and do not use the admin client here) and pass them into
  `components/sponsor/review-shell.tsx:80`.
- Add the thread as a new `<section>` alongside the existing one at `:146`, below the
  decision console. A sponsor should read the answer before deciding.

### 3. Tokenized sponsor view

- `app/sponsor-view/[token]/page.tsx` — it already resolves the token and the submission
  through the admin client at `:23-33`. Load the thread in the same round trip
  (`submission_messages` filtered to `status='released' OR author_role='sponsor'` in the
  query, since the admin client bypasses RLS and will otherwise return coach drafts —
  **this is the single most likely leak in the slice, get it right**).
- Render the thread above the decision panel. Show the composer under exactly the condition
  the decision panel uses at `:300-314`: `!expired && !decided &&
  isAwaitingSponsor(submission.status)`. Reuse that expression, don't re-derive it.
- No middleware change: `/sponsor-view(.*)` is already public (`_CONTEXT.md` §1).

### 4. Admin moderation queue

- `app/(admin)/moderation/page.tsx` — add a third section, **"Coach replies awaiting
  release"**, above `InFlightSubmissions` (`:65-73`). Query `submission_messages` where
  `status='pending'`, joined to team name + sponsor company name, oldest first.
- **`components/admin/message-review-queue.tsx`** (new, client) — per row: the sponsor's
  question for context, the coach's proposed reply, `Release` / `Reject` with a required
  reason, and a standing COPPA checklist ("no student names · no student photos · no
  identifying detail") rendered beside the body, not behind a tooltip.
- Also surface flagged sponsor messages here — a compact "Reported messages" list. Zero
  flagged is the good state; render it as such.
- **`app/api/admin/queue/count/route.ts`** — add the pending-message count. Keep the JSON key
  `count` as the **sum** of pending submissions + pending messages, so
  `components/admin/admin-sidebar.tsx` (which reads `data?.count`, `:28-35` nav config) needs
  no change and the badge reflects total work. Add `{ submissions, messages }` alongside for
  future use. Note the collision risk: prompt `13` also wants to add to this count.

### 5. Shared component

- **`components/messages/thread.tsx`** (new) — one component, three consumers. Props:
  `{ messages, viewerRole: 'coach' | 'sponsor' | 'admin', canCompose, composerWarning?,
  onSubmit }`. Coach and sponsor bubbles differ by alignment and label; status pills for
  `pending` / `rejected`. The COPPA warning above the coach composer is passed in as
  `composerWarning` and is **not** dismissible.

### 6. Dev preview fixtures — do not skip

All three preview modes are forced off in production but must still render
(`_CONTEXT.md` §9):

- `lib/dev-bypass.ts` — the mock table map (`submissions:` fixture at `:130`) needs a
  `submission_messages` entry including at least one `pending` coach reply, or
  `/moderation` throws in `npm run dev:admin-preview`.
- `lib/dev-preview.ts` (`submissions` at `:250`, exported at `:326`) — sponsor thread fixture.
- `lib/dev-coach-preview.ts` (`submissions` at `:142`, exported at `:177`) — coach thread
  fixture.

---

## Out of scope

- Attachments, images, file upload of any kind on messages. Permanently, not just this slice.
- Real-time / websockets / typing indicators. Server components + `revalidatePath`, matching
  every other surface in this app.
- Threading, replies-to-a-reply, reactions, read receipts.
- A student-PII classifier. See the COPPA section — this is a deliberate refusal.
- Any change to `lib/dispatch.ts`, `approve_submission_atomic`,
  `release_submission_reservation`, `sponsor_decide_submission_atomic`, or
  `record_sponsor_decision_atomic`. This slice moves no money and re-dispatches no pitch.
- Extending `notifications_type_check` (`0023:30-40`). Every notification here is
  `type: 'general'`; adding an enum-ish value would ripple into the union in
  `lib/notify.ts:259` and the inbox UI for no user-visible gain.
- Messaging on a submission that is `draft` / `pending` / terminal. The thread exists for the
  live decision window only.

## Guardrails specific to this slice

- **Never `auth.uid()`.** NULL under Clerk. `current_profile_id()` / `is_admin()` only.
- `coach_owns_submission()` and `sponsor_owns_submission()` **keep** `EXECUTE` for
  `authenticated` (policies call them). Everything else gets the full REVOKE/GRANT.
- `sponsor_owns_submission()` must keep `sent_at IS NOT NULL`. Dropping it re-opens P0-2.
- The token path **must not** stamp `used_at`. Re-read `0071` before writing that action.
- The `/sponsor-view` page reads through the **admin client**, which bypasses RLS. Filter
  `status='released' OR author_role='sponsor'` in the query itself.
- Do not put message bodies in `audit_log`.
- Do not add a column to `submissions` — see the note about
  `guard_submission_writable_columns()` failing closed.
- The migration has `$$` blocks → **`psql -f`**, not the Supabase CLI.
- `checkThrottle` fails **open**. Keep it that way; do not "fix" it into failing closed.
- Import status groupings from `lib/submission-status.ts`. Do not re-declare arrays (the app
  already carries two hand-rolled duplicates at `app/actions/submission.ts:12` and
  `app/(coach)/dashboard/page.tsx:57` — do not add a third).

---

## Files you will touch

**Create:**
- `supabase/migrations/0085_submission_qa_thread.sql`
- `lib/schemas/message.ts`
- `lib/throttle.ts`
- `app/actions/messages.ts`
- `emails/thread-message-email.tsx`
- `components/messages/thread.tsx`
- `components/admin/message-review-queue.tsx`
- `app/(coach)/submissions/[id]/page.tsx`
- `app/(coach)/submissions/[id]/loading.tsx`
- `lib/__tests__/submission-messages.test.ts`
- `tests/e2e/qa-thread.spec.ts`

**Modify:**
- `lib/schemas/limits.ts` (`submissionMessage`)
- `lib/schemas/submission.ts` (`export` on `plainTextField`)
- `lib/notify.ts` (`sendThreadMessageEmail`)
- `lib/supabase/types.ts` (`submission_messages` + two functions)
- `app/actions/sponsor.ts` (import `checkThrottle` from `lib/throttle.ts`, delete the copy)
- `app/(sponsor)/sponsor/submissions/[id]/page.tsx` (fetch thread)
- `components/sponsor/review-shell.tsx` (render thread)
- `app/sponsor-view/[token]/page.tsx` (fetch + render thread, composer)
- `app/(admin)/moderation/page.tsx` (release queue section)
- `app/api/admin/queue/count/route.ts` (include pending messages in `count`)
- `components/coach/dashboard-shell.tsx` (link + unread count)
- `lib/dev-bypass.ts`, `lib/dev-preview.ts`, `lib/dev-coach-preview.ts` (fixtures)

---

## Tests

### Vitest — `lib/__tests__/submission-messages.test.ts` (MANDATORY)

Follow the mocking style in `lib/__tests__/sponsor-application.test.ts`.

- `postSponsorQuestion` inserts with `status: 'released'`.
- `postCoachReply` inserts with `status: 'pending'` and returns `{ pending: true }`.
- `postCoachReply` on a submission with **no** sponsor message returns an error and performs
  zero inserts (assert the insert mock was never called).
- `postCoachReply` on a `declined` / `expired` / `approved` submission returns an error and
  writes nothing.
- `postCoachReply` past `expires_at` returns an error and writes nothing.
- Throttle: when `check_throttle` resolves `false`, the action returns a rate-limit message
  and does not insert. When the RPC **errors**, the action still inserts (fail-open).
- `releaseCoachReply` on an already-released message returns "already handled" and calls
  `sendThreadMessageEmail` zero times.
- `releaseCoachReply` fans out `createInAppNotification` to every sponsor profile with the
  matching `sponsor_id`, and calls `sendThreadMessageEmail` exactly once.
- `postSponsorQuestionByToken` **never** writes `used_at` (assert no update against
  `submission_access_tokens`).
- No action passes a message body into an `audit_log` insert.

### Cross-tenant isolation (MANDATORY, named acceptance test)

Both as a Vitest action-level test and as a live SQL/PostgREST check on a scratch DB:

- **Sponsor B cannot read submission A's thread.** As sponsor B (a different `sponsor_id`),
  `GET /rest/v1/submission_messages?submission_id=eq.<A>` → `[]`, and
  `/sponsor/submissions/<A>` → `notFound()`.
- Sponsor A cannot read a `pending` coach reply on their own thread → the row is absent from
  the REST response, not merely hidden in the UI.
- A coach cannot read another coach's thread → `[]`.
- Anon: `GET /rest/v1/submission_messages?select=*` → `[]`.
- `INSERT` / `UPDATE` / `DELETE` on `submission_messages` as coach, sponsor, or anon → 0 rows
  (no write policy exists).

### Playwright — `tests/e2e/qa-thread.spec.ts`

- Sponsor asks a question in the portal → it appears immediately for the sponsor, and the
  coach's detail page shows it.
- Coach replies → the coach sees "Awaiting admin review"; the sponsor's page does **not**
  show it.
- Admin releases → the sponsor now sees it.
- Admin rejects with a reason → the coach sees the reason; the sponsor never sees the body.
- On the token page: the composer renders for a live pitch, and after posting a question the
  Approve/Decline panel is **still** live (the token was not consumed).

### RLS audit (MANDATORY, gate on it)

Run the **`rls-auditor`** agent against `submission_messages` (and re-check `submissions`,
since two new SECURITY DEFINER functions now read it). It must report zero `auth.uid()`
references and confirm the three isolation properties above. Paste its findings into your
report.

---

## Acceptance criteria

- [ ] `psql -f supabase/migrations/0085_submission_qa_thread.sql` succeeds twice in a row.
- [ ] A sponsor question is visible to the coach within one page load, with no admin action.
- [ ] A coach reply is **not** visible to the sponsor — verified by reading
      `/rest/v1/submission_messages` as that sponsor, not just by looking at the UI — until
      an admin releases it.
- [ ] An admin release sends exactly one email, whose body contains the message text and
      **no** portfolio/budget/media content.
- [ ] **Cross-tenant isolation:** sponsor B reading submission A's thread gets `[]` from
      PostgREST and `notFound()` from the portal.
- [ ] A coach reading another coach's thread gets `[]`.
- [ ] A coach cannot post the first message in a thread (error, zero rows inserted).
- [ ] Posting is rejected once the submission reaches any terminal status, and once
      `expires_at` has passed — both enforced at the database, provable by a direct
      `INSERT` as `service_role` that still raises.
- [ ] Existing threads remain **readable** after terminality/expiry; only composing stops.
- [ ] Asking a question through `/sponsor-view/<token>` leaves `used_at` NULL, and the
      Approve/Decline panel still works afterwards.
- [ ] The 51st message in a thread is rejected.
- [ ] `submission_messages` has no INSERT/UPDATE/DELETE policy —
      `SELECT policyname, cmd FROM pg_policies WHERE tablename='submission_messages'`
      returns exactly three `SELECT` rows.
- [ ] Deleting a coach's Clerk account does not error and does not orphan the thread in a
      constraint violation (exercise the cascade on a scratch DB).
- [ ] `rls-auditor` passes with zero `auth.uid()` hits — findings pasted in the report.
- [ ] All three dev preview modes still render the pages they own.
- [ ] `npm run typecheck && npm run lint && npm run build && npm run test` all green.
- [ ] Browser-verified: coach, sponsor-portal, sponsor-token, and admin surfaces each
      exercised at least once.

---

## Rollback

`vercel rollback` reverts code, not the database.

```sql
BEGIN;
DROP TRIGGER IF EXISTS trg_guard_submission_message ON submission_messages;
DROP FUNCTION IF EXISTS guard_submission_message_insert();
DROP TABLE IF EXISTS submission_messages;   -- policies and indexes go with it
DROP FUNCTION IF EXISTS coach_owns_submission(uuid);
DROP FUNCTION IF EXISTS sponsor_owns_submission(uuid);
COMMIT;
```

Nothing else in the schema references these objects, so the drop is clean. Roll the code
back first or every thread query 42P01s.

`lib/throttle.ts` and the `export` on `plainTextField` are harmless on their own; leave them
if you are only reverting the database.

---

## Commit

```
feat(messaging): admin-moderated sponsor↔coach Q&A on a live pitch

Adds submission_messages with asymmetric moderation: a sponsor's question
posts immediately (they already hold an admin-approved pitch and are
initiating contact), while a coach's reply enters the moderation queue and
requires admin release — the same gate app/actions/moderation.ts applies to
pitches, and the control that keeps student PII off the wire.

Threads are plain text with no attachments, live only while the pitch is
awaiting a sponsor decision inside its 14-day window, and are enforced at
the database by a BEFORE INSERT trigger rather than only in the action.
Read access is three SELECT policies keyed off current_profile_id(); there
is no client write path at all. The tokenized /sponsor-view path can ask
questions without consuming its decision token.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```
