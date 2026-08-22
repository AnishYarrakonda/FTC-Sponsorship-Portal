# A-10 — Security posture

**Lane A (static — parallel-safe).** Audit id `A-10`.
**Outputs:** `prompts/audits/findings/A-10-findings.md` · `prompts/audits/handoff/A-10-claude-prompt.md`

> Read `prompts/audits/_CONTEXT-AUDIT.md` in full first.
> Report only what you can point at in this codebase. **Never write a discovered secret into a
> finding** — name the variable and the file, never the value. Do not attack production.

---

## You own

Everything an attacker touches that is not covered by `A-01` (identity) or `A-02` (RLS): input
handling, secrets, headers, tokens, third-party surface, and abuse resistance.
Relevant files: `lib/env.ts`, `lib/safe-url.ts`, `lib/botid-paths.ts`, `lib/email-domain.ts`,
`lib/sponsor-domain-gate.ts`, `lib/errors.ts`, `lib/client-errors.ts`, `middleware.ts`,
`next.config.*`, `vercel.json`, `instrumentation*.ts`, the `request_throttle` table and
`check_throttle()`, and every route handler in `app/api/**`.

## Investigate

1. **Secrets.** Every env var read anywhere: is it validated in `lib/env.ts`, is a server-only
   secret ever referenced from a `'use client'` file or a `NEXT_PUBLIC_` name, and is anything
   secret-shaped committed to the repo or to a migration? Scan the git history for a key that
   was committed and later removed — it is still in the history and still needs rotating.
   Report the *location*, never the value.
2. **Every `/api` route, one by one.** Auth, authorization, input validation, method
   restriction, and response shape. Confirm the documented behavior — unauthenticated `/api/*`
   returns JSON 401/403 and is never redirected — actually holds for each. Check the webhooks
   (`clerk`, `resend`) verify signatures with a constant-time comparison and reject replays,
   and check `/api/cron/*` rejects a request that is not from the scheduler.
3. **Tokens.** `submission_access_tokens`, `remint_submission_access_token()`, and any
   signature or receipt id in a URL. Entropy, expiry, single-use or not, revocation, and
   whether the token is logged anywhere (Sentry breadcrumbs, Vercel logs, `Referer` leakage to
   third parties). Are ids sequential and therefore enumerable?
4. **Injection.** SQL built by string concatenation anywhere (including inside `SECURITY
   DEFINER` functions using `EXECUTE`), `dangerouslySetInnerHTML`, unsanitized rich text
   reaching an email or PDF, CSV formula injection in the admin export (a cell beginning `=`,
   `+`, `-`, `@`), and any user value used in a filename or a redirect target.
5. **SSRF and outbound requests.** Every server-side `fetch` with a URL influenced by user
   input — the FTC API path, FTCScout fallback, logo/image fetches, webhook callbacks. Confirm
   `lib/safe-url.ts` is applied at each and that it blocks private ranges, redirects, and
   non-HTTPS. Also confirm timeouts and failure handling exist on each outbound call.
6. **Abuse and rate limiting.** Rate limiting was deliberately removed (no Upstash) and
   replaced in part by `request_throttle` / `check_throttle()` and BotID on selected paths.
   Enumerate every unauthenticated or cheap-to-call endpoint — sponsor application, signup,
   FTC lookup, token-backed views, password reset entry points — and state, for each, what
   stops 10,000 requests. Then check `lib/botid-paths.ts` covers the paths that actually need
   it. **Do not propose reintroducing Upstash/Redis** — it was removed on purpose; propose
   something that fits the current architecture.
7. **Headers and transport.** CSP, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`,
   HSTS, `X-Content-Type-Options`, and cookie flags. Report what is missing and what breaks if
   it is added (an over-tight CSP with Clerk and Sentry is a real risk — say so).
8. **Dependencies.** Run `npm audit --omit=dev` and read the actual output. Report only what is
   reachable from this app's code paths, and say why. Note the `jsdom`/`cssstyle` overrides in
   `package.json` exist to fix a runtime `ERR_REQUIRE_ESM` and **must not be removed**.
9. **Logging and error leakage.** What reaches Sentry and the Vercel logs? PII, EIN, tokens,
   email bodies, request bodies? Does any user-visible error carry a stack trace or a raw
   Postgres message?
10. **Domain gating.** `lib/email-domain.ts` + `lib/sponsor-domain-gate.ts` + `email_domain_rules`:
    can a free-mail or lookalike domain get through, is matching case- and unicode-safe
    (homograph), and does a subdomain match when it should not?

## Enterprise lens

A corporate security review will ask for: data classification, retention and deletion, breach
notification, subprocessor list, SSO and SCIM, penetration-test evidence, and an SLA. Record
which of these have no answer in the repo today — each is a gap, not a bug.

## Done when

Every API route has a verdict, every token's lifecycle is described, and each abuse surface has
a named control or an explicit "nothing stops this".
