# B-03 — Full journeys, live

**Lane B (live stack — run alone).** Audit id `B-03`.
**Outputs:** `prompts/audits/findings/B-03-findings.md` · `prompts/audits/handoff/B-03-claude-prompt.md`

> Read `prompts/audits/_CONTEXT-AUDIT.md` **and** `_LANE-B-SETUP.md` in full first.
> This is the longest audit in the pack. Budget accordingly and do not run anything else in
> Lane B alongside it.

---

## You own

The whole product, walked end to end as the three actors, in a browser — the parts a green E2E
suite does not prove because it only walks the happy path.

## Journey 1 — the golden path, walked slowly

Coach registers → is verified → builds the portfolio → composes a pitch → submits → admin
moderates and approves → dispatch reaches the sponsor → sponsor reviews and decides → agreement
is signed → fulfillment progresses to complete → receipt is issued → recognition tier is awarded
→ the impact report includes it.

At **every** step record: what the other two actors see at that moment, what notification each
receives (in-app and email), what the database says, and whether the three agree. Divergence
between what the coach sees, what the sponsor sees, and what the row says is the thing to hunt.

## Journey 2 — the unhappy paths

Run each of these to completion and record the final state of the submission, the sponsor's
capacity, the notifications, and the audit trail:

1. Admin requests changes; coach revises; resubmits.
2. Admin declines. Coach appeals. Appeal is granted. Then: appeal is denied instead.
3. Sponsor declines after dispatch.
4. Submission expires untouched (drive the clock or invoke the cron route directly with the
   local `CRON_SECRET` — never against production).
5. Coach cancels after approval but before the sponsor decides.
6. Fulfillment is started and then cancelled, before and after a receipt is issued.
7. A receipt is voided.
8. A team is deleted with a live submission; a coach account is deleted mid-flow.

After each, verify the capacity invariant holds — compare `sponsors` caps against
`transactions_ledger` and `submissions.reserved_amount_cents` directly, and cross-check with
`detect_capacity_drift()`.

## Journey 3 — adversarial

- Submit the same pitch twice quickly (double-click the button, and replay the action).
- Approve the same submission from two admin tabs simultaneously.
- Sign an agreement twice; sign a superseded template version.
- Open a sponsor-view token link after the submission moved to a terminal state; open it after
  the token should have expired; open it in a second browser.
- Paste HTML, a very long string, emoji, RTL text, and a leading `=` into every free-text field,
  then look for where it renders: the UI, the emails, the receipt PDF, and the CSV export.
- Upload a wrong-type file, an oversized file, and a zero-byte file to every upload point.
- Navigate away mid-submit; kill the network mid-submit; hit back after a completed mutation.

## Journey 4 — the QA thread and messaging

Exercise `submission_messages` from both sides: message before dispatch, after a terminal
decision, as a sponsor who does not own the submission, and as a coach who does not own the
team. Confirm the database-level enforcement (`guard_submission_message_insert`) actually fires
rather than only the UI hiding the control.

## Capture

For each journey step: what you did, what you saw, what the database said, and any console or
network error. Remember that an error boundary here returns **HTTP 200** — a page that loads is
not proof it rendered; check the console.

## Done when

All four journeys are complete, the capacity invariant has been verified after every unhappy
path, and teardown is complete with the fixture sponsor's capacity confirmed back at its
starting value and no orphaned `transactions_ledger` rows.
