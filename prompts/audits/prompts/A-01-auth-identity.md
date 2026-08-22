# A-01 — Auth & the Clerk↔Supabase identity bridge

**Lane A (static — parallel-safe).** Audit id `A-01`.
**Outputs:** `prompts/audits/findings/A-01-findings.md` · `prompts/audits/handoff/A-01-claude-prompt.md`

> Read `prompts/audits/_CONTEXT-AUDIT.md` in full first. It defines the safety rules, the
> severity scale, the evidence standard, and the exact shape of both output files.
> You find and prove problems. You never fix them.

---

## You own

The identity layer: how a request proves who it is, and how that claim reaches Postgres.

- `middleware.ts` (repo root) — `clerkMiddleware()` and the `createRouteMatcher` public list.
- `lib/actions-utils.ts` — `requireAuth`, `getAuthedProfile`, `requireAdmin`, `requireSponsor`,
  `requireVerifiedCoach`, `getClientIp`.
- `lib/supabase/{client,server,admin}.ts` — which client forwards the Clerk token, which
  bypasses RLS.
- `app/actions/auth.ts` — `createCoachProfile`, `createSponsorApplication`.
- `app/api/webhooks/clerk/route.ts` — `user.deleted`, email sync.
- The SQL identity helpers: `current_profile_id()`, `is_admin()`, `is_coach_verified()`,
  `is_super_admin()`, `is_trusted_server_context()`, `prevent_role_elevation()`,
  `assert_super_admin_floor()`, `handle_new_user()`.
- `app/(auth)/*` route structure and the dev bypasses in `lib/dev-bypass.ts`,
  `lib/dev-preview.ts`, `lib/dev-coach-preview.ts`.

**Not yours:** table-by-table RLS policy correctness (`A-02`), whether actions audit-log
(`A-03`), live browser flows (`B-01`).

## Investigate

1. **Enumerate every route and classify it.** Walk `app/**/page.tsx` and `app/api/**/route.ts`
   and build the full list of paths. For each, determine what actually protects it: the
   middleware matcher, a guard inside the component, a guard inside the action, or nothing.
   **Any authenticated-looking page or API route whose protection you cannot name is a
   finding.** Pay attention to routes that are public by design — `/sponsor-view/*`,
   `/agreement-records/*`, `/receipts/*`, `/legal/*`, `/sponsors/apply` — and prove what stops
   an unauthenticated stranger from enumerating other people's records there.
2. **Trace every guard's failure mode.** Read each function in `lib/actions-utils.ts` line by
   line. What happens when the Clerk session exists but the `profiles` row does not? When the
   row exists but `role` is null? When `sponsor_id` is null but `sponsor_members` says
   otherwise? Does any guard **fail open** — returning a usable client instead of throwing?
3. **Find every caller that does not use a guard.** `grep` every `'use server'` file for
   `createClient(`, `createAdminClient(`, and `auth()`. Any server action or route handler
   reaching Supabase without first passing through a guard is a finding; state which one it
   should use.
4. **Audit admin-client usage.** `grep -rn "createAdminClient\|SUPABASE_SERVICE_ROLE_KEY" app lib`.
   For every hit, answer: does this operation *legitimately* need to bypass RLS, and is the
   authorization decision made **before** the admin client is used? An admin client used to
   read a row the caller then displays, without an ownership check, is a P0.
5. **Check the role trust boundary.** `publicMetadata.role` is mirrored into Clerk for UX only.
   Find every read of Clerk metadata and prove none of them gates an authorization decision.
6. **Check the dev bypasses.** `NEXT_PUBLIC_DEV_AUTH_BYPASS`, `NEXT_PUBLIC_SPONSOR_PREVIEW`,
   `NEXT_PUBLIC_COACH_PREVIEW`. Prove each is genuinely inert in production — read the actual
   forcing logic, do not trust the comment. A `NEXT_PUBLIC_` variable is attacker-visible and
   set at build time; confirm the check is not client-side-only.
7. **Account lifecycle.** What happens when Clerk fires `user.deleted` for: a coach who owns a
   team with live submissions; a sponsor org's last remaining admin; a super admin? Follow the
   FK actions in the migrations (`ON DELETE CASCADE` vs `SET NULL`) and describe the resulting
   state. Orphaned or unreachable data here is at least P1.
8. **Role elevation.** Read `prevent_role_elevation()` and `assert_super_admin_floor()` from
   the migrations, and note that `0093`/`0094`/`0096` exist because a `CREATE OR REPLACE`
   silently dropped guards. Compare each function's **latest** definition against every earlier
   definition of the same function and report any guard that was present earlier and is absent
   now.
9. **Session reality.** Session lifetime, idle timeout, and what happens to an open tab after a
   role change or a revocation. Where is that configured, and is it configured at all?

## Enterprise lens

A corporate sponsor's IT team will ask: how long do sessions live, what happens when an
employee is terminated, can we force a sign-out, is there an audit trail of authentication
events, and what happens to that employee's in-flight approvals. Answer each from the code and
record every one you cannot answer as an enterprise gap.

## Done when

Your findings report names every route and its protector, every guard and its failure mode,
every admin-client call site and its justification, and the account-lifecycle outcome for the
three deletion cases above — plus the two required closing sections (`Fix by subscription`,
`Fix by code`). Then write the handoff prompt and print it as one fenced block.
