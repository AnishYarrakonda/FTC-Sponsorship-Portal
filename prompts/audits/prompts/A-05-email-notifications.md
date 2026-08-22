# A-05 — Email & notification pipeline

**Lane A (static — parallel-safe).** Audit id `A-05`.
**Outputs:** `prompts/audits/findings/A-05-findings.md` · `prompts/audits/handoff/A-05-claude-prompt.md`

> Read `prompts/audits/_CONTEXT-AUDIT.md` in full first.
> **Admin-gatekept outreach is a Core Mandate.** Any path that can email a sponsor a pitch
> without passing through `dispatchApprovedSubmission` is a P0.

---

## You own

`lib/dispatch.ts`, `lib/notify.ts`, `lib/dispatch-budget.ts`, `lib/sponsor-recipients.ts`,
`lib/decision-followup.ts`, `emails/*` (React Email templates),
`app/api/webhooks/resend/route.ts`, `app/actions/notifications.ts`,
`app/api/coach/notifications/unread`, the `notifications` table and its policies, and
`docs/email-deliverability.md`. Clerk owns verification and password-reset email — audit the
**boundary**, not Clerk's internals.

## Investigate

1. **Prove the outreach gate holds.** Enumerate every call site that can send mail to a sponsor
   address. `grep -rn "resend\|Resend\|sendEmail\|react-email" app lib emails app/api`. For each,
   classify: gated outreach, transactional notification, or a leak. Then work backwards from
   the `sponsors` recipient list — `lib/sponsor-recipients.ts` — and prove every consumer of it
   is behind admin approval. A transactional notification that happens to include pitch content
   is a gate bypass in substance even if it is not one in structure; look for that.
2. **Idempotency and double-send.** `dispatchApprovedSubmission` uses an `idempotencyKey` and
   stores `resend_message_id`. What happens on: a retry after a network timeout where Resend
   actually delivered; two admins approving simultaneously; a redeploy mid-send; a
   re-dispatch after an appeal overturn? Is the key derived from something stable and unique?
   Is the send recorded **before** or **after** the API call, and what does the other ordering
   cost you?
3. **Recipient correctness.** For a multi-employee sponsor org, who receives what? Trace the
   recipient set for each event type against `sponsor_members` roles. Check for: mail to a
   removed member, mail to every member when it should go to one, a decision notice to a viewer
   who cannot act on it, and a missing notice to the approver who must act.
4. **The in-app / email pairing.** `createInAppNotification` writes a row **and** emails.
   Verify `skipEmail: true` is used exactly where a richer dedicated email is already sent —
   list every call site and mark it correct, duplicate, or silently missing. A user getting two
   emails for one event, or none, are both findings.
5. **Failure handling.** If Resend returns 429, 4xx, or times out — is the notification row
   still written, is the error swallowed, is it retried, is it reported to Sentry, and can the
   user tell? A notification the app believes was delivered and was not is at least P1.
6. **Webhooks.** `app/api/webhooks/resend/route.ts` — is the signature verified? Are replays
   and out-of-order events handled? Which event types are handled versus silently dropped?
   Note that `email.complained` is shipped but not subscribed — confirm the handler is correct
   so the subscription is all that is missing.
7. **Templates.** Read every file in `emails/`. Check: user content escaped (an HTML-injecting
   team name), absolute URLs with the right base in every environment, plain-text alternative,
   unsubscribe/preference handling for non-transactional mail, `Reply-To`, sender identity,
   dark-mode and Outlook rendering, and no PII or token in a subject line.
8. **Deliverability posture.** SPF/DKIM/DMARC state per `docs/email-deliverability.md`, bounce
   and complaint handling, suppression list, and whether a hard bounce ever disables further
   sends to that address. What happens when a corporate mail gateway silently quarantines
   everything — is there any signal?
9. **Volume.** Estimate sends per funded submission per year, multiply by a realistic sponsor
   count, and compare against the Resend free tier. That belongs in `Fix by subscription`.

## Enterprise lens

Corporate recipients bring: shared mailboxes, distribution lists, aggressive link rewriting
(Safe Links / Proofpoint) that will pre-fetch any tokenized URL you email, and legal-hold
requirements. **Check specifically whether a link-scanner GET on an emailed action URL can
consume a one-time token or trigger a state change** — that is a classic P1 in this design.

## Done when

Every sender is classified, the gate is proven closed, the recipient set is mapped per event
per role, and each template's escaping and URL construction is checked.
