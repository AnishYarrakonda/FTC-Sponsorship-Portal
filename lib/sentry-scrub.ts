/**
 * URL redaction for Sentry (A-10-03).
 *
 * `/sponsor-view/<token>` puts a LIVE, unhashed sponsor access token in the URL path.
 * That token is a bearer credential: whoever holds it can read a pitch and record a
 * funding decision on behalf of the sponsor, until it is burned or expires (14 days).
 * Sentry records the request URL on every event and every navigation breadcrumb, so an
 * unrelated error on that page copies a working credential into a third-party log — one
 * that outlives the session and is readable by anyone with Sentry access.
 *
 * Nothing is captured today (no DSN is set in any Vercel environment), which is exactly
 * why this needs to exist BEFORE one is: the leak would begin silently, retroactively
 * covering every token in flight, at the moment someone pastes a DSN into the dashboard.
 *
 * Pure and dependency-free so it can be unit-tested and imported from the client bundle,
 * the server runtime, and the edge runtime alike.
 */

const REDACTED = '[redacted]'

/** Path segments that follow a secret-bearing route prefix. */
const SECRET_PATH_RE = /(\/sponsor-view\/)[^/?#]+/gi

/** Query parameters that carry a credential rather than a filter. */
const SECRET_QUERY_KEYS = new Set(['token', 'access_token', '__clerk_ticket', 'ticket', 'code', 'secret'])

/**
 * Redact secrets from a URL or a bare path.
 *
 * Accepts both absolute URLs and paths, because Sentry uses each in different places:
 * `event.request.url` is absolute, breadcrumb `data.to`/`data.from` are paths.
 * Anything unparseable is returned with path redaction applied but no query handling —
 * never thrown, because a scrubber that throws inside `beforeSend` drops the event.
 */
export function scrubUrl(value: string): string {
  if (typeof value !== 'string' || !value) return value

  const pathRedacted = value.replace(SECRET_PATH_RE, `$1${REDACTED}`)

  const queryStart = pathRedacted.indexOf('?')
  if (queryStart === -1) return pathRedacted

  const head = pathRedacted.slice(0, queryStart)
  const rawQuery = pathRedacted.slice(queryStart + 1)

  // Hand-rolled rather than URLSearchParams so a fragment survives and key order and
  // encoding are preserved exactly — a scrubber should not also rewrite the URL.
  const hashStart = rawQuery.indexOf('#')
  const query = hashStart === -1 ? rawQuery : rawQuery.slice(0, hashStart)
  const fragment = hashStart === -1 ? '' : rawQuery.slice(hashStart)

  const scrubbed = query
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=')
      if (eq === -1) return pair
      const key = pair.slice(0, eq)
      return SECRET_QUERY_KEYS.has(decodeURIComponent(key).toLowerCase())
        ? `${key}=${REDACTED}`
        : pair
    })
    .join('&')

  return `${head}?${scrubbed}${fragment}`
}

/** Does this string contain anything the scrubber would change? */
export function containsSecretUrl(value: string): boolean {
  return typeof value === 'string' && scrubUrl(value) !== value
}

/**
 * `beforeBreadcrumb` hook. Navigation, fetch, and xhr breadcrumbs all carry URLs, in
 * different shapes depending on the integration, so every string field that can hold one
 * is scrubbed rather than a hardcoded list per breadcrumb type.
 */
export function scrubBreadcrumb<T extends { message?: string | null; data?: Record<string, unknown> | null }>(
  breadcrumb: T
): T {
  if (breadcrumb.message) breadcrumb.message = scrubUrl(breadcrumb.message)

  const data = breadcrumb.data
  if (data) {
    for (const key of ['url', 'to', 'from']) {
      const value = data[key]
      if (typeof value === 'string') data[key] = scrubUrl(value)
    }
  }

  return breadcrumb
}

/**
 * `beforeSend` / `beforeSendTransaction` hook.
 *
 * Breadcrumbs are scrubbed again here even though `beforeBreadcrumb` already ran:
 * breadcrumbs attached by integrations that bypass that hook, or captured before init
 * completed, would otherwise slip through. Redacting twice is free; missing once is not.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function scrubEvent<T extends Record<string, any>>(event: T): T {
  // Indexed access rather than dotted: Sentry's Event type is generic here and the
  // mutation is deliberate (these hooks mutate in place and return the same object).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = event as any
  if (typeof e.transaction === 'string') e.transaction = scrubUrl(e.transaction)

  if (e.request && typeof e.request.url === 'string') {
    e.request.url = scrubUrl(e.request.url)
  }
  if (e.request?.headers && typeof e.request.headers.Referer === 'string') {
    e.request.headers.Referer = scrubUrl(e.request.headers.Referer)
  }
  if (e.request?.headers && typeof e.request.headers.referer === 'string') {
    e.request.headers.referer = scrubUrl(e.request.headers.referer)
  }

  if (Array.isArray(e.breadcrumbs)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    e.breadcrumbs = e.breadcrumbs.map((b: any) => (b ? scrubBreadcrumb(b) : b))
  }

  return event
}
