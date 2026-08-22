# B-02 — Sponsor organizations & the approver workflow, live

**Lane B (live stack — run alone).** Audit id `B-02`.
**Outputs:** `prompts/audits/findings/B-02-findings.md` · `prompts/audits/handoff/B-02-claude-prompt.md`

> Read `prompts/audits/_CONTEXT-AUDIT.md` **and** `_LANE-B-SETUP.md` in full first.
> Run only after `B-01`, and never alongside another Lane B audit.

---

## You own

The multi-employee sponsor experience, exercised in a browser: invitations, roles, permissions,
the decision-proposal/approval chain, domain gating, and everything that happens when the
people in an org change. Sponsor multi-user is built on **Clerk Organizations**; the roles and
permissions live in `sponsor_members`, `sponsor_roles.ts`, `has_sponsor_permission()`, and
`current_sponsor_member_role()`.

This is the audit that decides whether a real company with six employees can use the product.

## Run these

1. **Invite and join.** Invite a colleague at the org's domain; invite one at a personal domain;
   invite an address that already belongs to another sponsor org; invite one that belongs to a
   coach. For each: what happens, what email arrives, and what the invitee sees on accept. Then
   accept an invite twice, and accept a revoked one.
2. **The role matrix, exercised — not read.** For every role in the model (viewer, approver,
   admin, or whatever the code actually defines), sign in as that role and attempt **every**
   sponsor-side action: view submissions, view another org's submission by URL, propose a
   decision, confirm a decision, manage members, change a role, edit the org profile, view
   payout and receipt documents, export the impact report, sign an agreement. Record allowed vs
   denied for each cell, and note every case where the UI hides a control but the underlying
   Server Action still permits it — **test the action directly, not just the button.** That gap
   is the single most valuable thing this audit can find.
3. **Cross-org isolation, live.** Signed in as Sponsor Org A, attempt to reach Org B's
   submissions, members, fulfillments, receipts, agreements, awards, and impact snapshots by
   direct URL and by calling actions with B's ids. Any success is a P0 — capture it precisely.
4. **The approval chain.** Create a decision proposal, then: confirm it as someone who lacks
   permission; confirm it twice; confirm it after the submission has moved on; let it go stale
   and check `expire_stale_decision_proposals`; and have two approvers confirm at the same
   moment. Record what the sponsor's capacity looks like after each.
5. **Capacity across an org.** With two members acting concurrently, drive the org toward its
   cap and past it. Confirm the cap holds no matter who acts, and that the remaining figure each
   member sees agrees with the database.
6. **Removal and offboarding.** Remove a member who has: an open proposal, a signed agreement, a
   pending invitation they sent, and notification subscriptions. What happens to each? Then
   remove the org's **last** admin and see whether the product prevents it. Then check whether
   the removed member retains any access — old links, session, emailed URLs.
7. **Domain gating, live.** With `email_domain_rules` in play, test a matching domain, a
   subdomain, a lookalike/homograph domain, a free-mail domain, and a case-varied address.
8. **What each member sees.** Sign in as each role and read the dashboard as a new employee
   would: is it obvious who did what, what needs my attention, and what I am not allowed to do
   and why? Record every disabled control with no explanation.

## Capture

Allowed/denied per role per action as a table, with the evidence for each denial (403? empty
list? silent success?). Screenshots for anything visual. Exact ids and URLs for any isolation
failure.

## Done when

The role matrix is complete and **exercised**, the direct-action tests are done for every
control the UI hides, cross-org isolation has a verdict, and teardown is complete with the
fixture sponsor's capacity confirmed back at its starting value.
