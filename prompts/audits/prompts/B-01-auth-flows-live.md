# B-01 — Auth flows, live

**Lane B (live stack — run alone).** Audit id `B-01`.
**Outputs:** `prompts/audits/findings/B-01-findings.md` · `prompts/audits/handoff/B-01-claude-prompt.md`

> Read `prompts/audits/_CONTEXT-AUDIT.md` **and** `prompts/audits/prompts/_LANE-B-SETUP.md` in
> full before you start anything. Do not skip the two pre-run verification checks — they are
> the only thing keeping this audit off production Clerk and production Supabase.

---

## You own

Every authentication flow as a real user experiences it, in a browser: sign-up, email
verification, sign-in, sign-out, password reset, the coach credential upload, the
awaiting-verification holding state, and session behavior over time and across tabs.

Clerk owns the mechanics of verification and reset email. You are auditing **the seams** — what
this app does before Clerk takes over and after it hands back, and what the user actually sees.

## Run these, and record what happens at every step

1. **Coach sign-up, end to end.** The multi-step wizard: DOB under 18, DOB exactly 18, missing
   COPPA/ToS/age acknowledgements, an email that already exists, a weak password, the static
   test OTP, a wrong OTP, an expired OTP, and the back button mid-wizard. At each failure, note
   whether the message is accurate and actionable, whether progress is preserved, and whether a
   partial `profiles` row is left behind. **Profile creation runs after the Clerk session is
   active** — so specifically test what happens when the Clerk user is created and
   `createCoachProfile` then fails. Is the account recoverable, or is the user permanently
   stuck with a session and no profile?
2. **Sponsor application.** `/sponsors/apply` unauthenticated: a personal-email domain, a
   blocked domain, a duplicate application, and the state between applying and approval. What
   does the applicant see while waiting, and what email do they get?
3. **Sign-in.** Wrong password, unknown email, an account mid-verification, an account whose
   profile row was deleted, and case/whitespace variations of the email. Then sign in as each
   of the nine test accounts and confirm each lands on the right home for its role.
4. **Password reset.** Request, the email, the link, setting a new password, and then: does the
   old session survive? Does resetting change what the app believes about the user? Try the
   link twice, and try it after requesting a second reset.
5. **Session behavior.** Two tabs, then sign out in one — what does the other do on its next
   action? Leave a tab idle and come back. Change a user's role in the database while their
   session is live, and see how long stale authorization persists. Take a Server Action from a
   tab whose session has been revoked, and confirm it fails safely rather than half-succeeding.
6. **Route protection, exercised.** Hit every protected path signed out and confirm the
   redirect; hit an `/api/*` path signed out and confirm you get JSON `401`, **not** an HTML
   login page. Then, signed in as a coach, try to reach every admin and sponsor page and record
   exactly what you get — a redirect, a 403, an empty page, or worse, data.
7. **The verification gate.** As an unverified coach, attempt every action a verified coach can
   take, including by calling the Server Action directly rather than through the UI. Confirm the
   `NEEDS_VERIFICATION` path shows a real CTA and not a dead end.
8. **Deletion.** Delete a Clerk test user and observe what the app does with the orphan: the
   `user.deleted` webhook path, the team they owned, and their submissions.

## Capture

For each flow: the steps, the observed result, the expected result, and a screenshot or the
console/network evidence when they differ. Console errors and failed network requests on a
flow that *appears* to work are findings — note that an error boundary returns HTTP 200 here,
so a 200 proves nothing.

## Done when

All eight flows have been executed against the live local stack, teardown is complete per
`_LANE-B-SETUP.md`, and your report states exactly what fixture data you left behind.
