/**
 * Client-side helpers for calling server actions safely.
 *
 * The audit found ~12 mutating submit handlers shaped like:
 *
 *     setIsPending(true)
 *     const result = await someServerAction(...)   // <- no try/catch
 *     if (result?.error) { setError(...); setIsPending(false); return }
 *     router.push(...)
 *
 * If the action *throws* rather than returning `{ error }` — a network drop, a Supabase
 * outage, an unhandled exception on the server — `setIsPending(false)` never runs. The
 * form stays disabled forever with no message and no recovery, and the retry button is
 * `void form.handleSubmit(onSubmit)()`, which discards the rejection too. The user's only
 * option is a full page reload, and they have no way to know that.
 */

/**
 * `redirect()` and `notFound()` inside a Server Action signal control flow by THROWING.
 * Next identifies them by a `digest` string. A `catch` that treats these as failures
 * swallows the navigation and shows a bogus error on a request that actually succeeded,
 * so every catch block around a server action must re-throw them.
 */
export function isNextControlFlowError(e: unknown): boolean {
  if (typeof e !== 'object' || e === null || !('digest' in e)) return false
  const digest = (e as { digest?: unknown }).digest
  return (
    typeof digest === 'string' &&
    (digest.startsWith('NEXT_REDIRECT') || digest === 'NEXT_NOT_FOUND')
  )
}

/** User-facing copy for an action that threw instead of returning a handled error. */
export const UNEXPECTED_ACTION_ERROR =
  'Something went wrong and your changes may not have been saved. Please check your connection and try again.'

/**
 * Normalizes a thrown value from a server action.
 * Re-throws Next control-flow errors so navigation still happens.
 */
export function describeActionError(e: unknown, context: string): string {
  if (isNextControlFlowError(e)) throw e
  console.error(`[action:${context}] threw`, e)
  return UNEXPECTED_ACTION_ERROR
}

/**
 * Same-origin path guard for `redirect_url`-style query parameters.
 *
 * `components/auth/login-form.tsx` read `redirect_url` with no allowlist and
 * `router.push`ed it at three call sites. `middleware.ts:55` only ever sets a pathname,
 * but the parameter is attacker-controllable, so
 * `…/login?redirect_url=https://evil.example/` sent a freshly-authenticated user
 * straight off-site — a credible phishing hand-off, because the victim has just proved
 * they trust this domain.
 *
 * Accepts only a single-slash-prefixed relative path. Rejects absolute URLs, scheme-
 * relative `//evil.example`, backslash variants that some parsers normalise to `/`, and
 * anything that fails to parse.
 */
export function safeInternalPath(value: string | null | undefined, fallback = '/'): string {
  if (!value) return fallback
  if (!value.startsWith('/')) return fallback
  if (value.startsWith('//') || value.startsWith('/\\')) return fallback
  try {
    // Resolve against an arbitrary origin: anything that escapes it is not a path.
    const url = new URL(value, 'https://internal.invalid')
    if (url.origin !== 'https://internal.invalid') return fallback
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return fallback
  }
}
