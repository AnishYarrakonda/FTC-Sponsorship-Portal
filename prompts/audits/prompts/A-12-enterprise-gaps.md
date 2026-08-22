# A-12 — Enterprise gap analysis

**Lane A (static — parallel-safe).** Audit id `A-12`.
**Outputs:** `prompts/audits/findings/A-12-findings.md` · `prompts/audits/handoff/A-12-claude-prompt.md`

> Read `prompts/audits/_CONTEXT-AUDIT.md` in full first.
> **This audit is different from the other eleven.** The others ask "is what exists correct?"
> This one asks **"what does a 500-person company need that nobody has built?"** Findings here
> are gaps and missing capabilities, not bugs. Severity is by deal impact: P0 = a corporate
> sponsor cannot use the product at all; P1 = it loses the deal or forces a manual workaround
> the customer will resent; P2 = it comes up in the second year; P3 = nice to have.

---

## The scenario to audit against

A 40,000-employee manufacturer wants to fund 25 FTC teams a year. Involved: a CSR program
manager (day to day), a finance approver (signs off above a threshold), a marketing lead
(wants logo placement and an annual impact story), an IT/security reviewer (SSO, data
handling), legal (agreement terms), and a procurement officer (invoicing, vendor forms). The
program manager leaves the company in month seven. Walk that entire year through this codebase.

## Investigate

Read what exists first — `prompts/revamp/08-sponsor-organizations.md`,
`09-org-roles-and-approver-workflow.md`, `10-enterprise-sso.md`, `11-admin-roles-and-capacity-audit.md`,
`15-csr-impact-report-export.md`, `docs/enterprise-sso-runbook.md`, `app/actions/sponsor-members.ts`,
`app/actions/sponsor-approvals.ts`, `lib/sponsor-roles.ts`, `lib/sponsor-visibility.ts`,
`lib/sponsor-org-writes.ts`, `lib/impact-report/*` — then find the gaps in each area below.
For every gap, state: what the company expects, what exists today, what breaks without it, and
**how big the build is** (a migration, a screen, a subsystem).

1. **Org lifecycle.** Creating the org, inviting the first colleague, seat limits, changing
   someone's role, transferring ownership, and **offboarding**: when the program manager
   leaves, what happens to their in-flight approvals, drafted decisions, notification
   subscriptions, signed agreements, and sole ownership of the org? Is there any way to
   reassign work? Is there a "last admin" guard?
2. **Delegation and coverage.** Vacation, a second approver, an approval that expires, an
   escalation path when nobody acts. Check `sponsor_decision_proposals` and
   `expire_stale_decision_proposals` for what already exists and where it stops.
3. **Approval chains.** A single approver may not be enough above a dollar threshold. Does the
   model support threshold-based routing, multi-step approval, or a required second signature?
   What does a company with a $25k sign-off policy do today?
4. **Identity and access at scale.** SSO exists as a runbook — check what is actually
   implemented versus configured per customer, whether the Clerk plan gate is documented, and
   what happens to existing password users when SSO is turned on for their domain. **SCIM /
   automated deprovisioning** is the question IT will ask second; determine whether anything
   removes access when the IdP does.
5. **Procurement and finance.** A vendor form, a W-9 *from* the platform, an invoice or a
   pledge statement, a PO number field, a fiscal-year boundary that is not the calendar year,
   and a single document the finance approver can file. Which of these exist?
6. **Reporting.** The CSR impact report: can it be scheduled, exported in a format a corporate
   team actually uses, branded, filtered to a date range, and reproduced identically next year?
   Can marketing self-serve logos, team stories, and photo permissions without emailing anyone?
7. **Legal and compliance.** Governing law, the agreement template versioning story, data
   retention and deletion on request, a subprocessor list, and where `needs_legal_review` and
   `RECEIPT_COPY_REVIEWED_AT` actually gate anything. Also: what does the platform promise
   about COPPA to a sponsor who asks in writing?
8. **Multi-entity and scale-out.** A parent company with regional subsidiaries or several
   business units under one brand; two employees who belong to two sponsor orgs; a sponsor who
   is also a coach. Does the data model allow these, and what breaks?
9. **Support and self-service.** Can a sponsor admin see their own audit trail, fix their own
   mistake, or answer "why was this declined" without contacting the platform admin? Every
   answer of "email the admin" is a scaling gap — count them.

## Output note

Group findings by the six people in the scenario, so the human can see which stakeholder blocks
the deal. Then give one prioritized build list: **the smallest set of additions that makes this
product credible to that manufacturer**, ordered, with a size estimate each.

## Done when

Each of the nine areas has an explicit verdict, the year-long scenario is walked start to
finish including the month-seven departure, and the prioritized build list exists.
