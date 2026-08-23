/**
 * A-10-05. Cheap guards for `/sponsor-view/[token]`, the only unauthenticated route in the
 * app that performs a database read on every request.
 *
 * The route hits Supabase through the ADMIN client (it has to — it serves a bearer token,
 * so RLS has no session to key off), with no caching and nothing in front of it. A crawler
 * or a token-guessing script turns one HTTP request into one unauthenticated query, all
 * day, and each miss is also an oracle telling the caller whether a token exists.
 *
 * Deliberately dependency-free. `.claude/rules/workflows.md` records that Upstash/Redis was
 * removed from this project and must not be reintroduced, so this is what is available:
 *
 *  1. `isWellFormedAccessToken` — a shape check that runs BEFORE the query. Tokens are
 *     minted as `encode(gen_random_bytes(32), 'hex')` (approve_submission_atomic), so a
 *     valid token is exactly 64 lowercase hex characters. Anything else cannot match a row
 *     and is refused without touching the database. That is the entire cost of scanning
 *     traffic and of every /sponsor-view/foo style probe in the finding's own repro.
 *
 *  2. `throttleTokenView` — a per-instance sliding window over the token hash. On Fluid
 *     Compute an instance is reused across concurrent requests, so this genuinely caps a
 *     single attacker hammering one URL through one instance. It is NOT a distributed rate
 *     limiter and does not pretend to be: with N instances the real ceiling is N * LIMIT.
 *     It is a cost floor, not a security boundary, and the shape check above is what
 *     actually removes the bulk of the traffic.
 *
 * The honest characterisation of the finding: the mechanism is real, the stated consequence
 * ("10,000 requests exhausts DB connections and crashes the site") is overstated for a
 * pooled Supabase project. Treated as a hardening item, fixed as one.
 */

/** 32 random bytes, hex-encoded. Nothing else can be a valid token. */
const ACCESS_TOKEN_PATTERN = /^[0-9a-f]{64}$/

export function isWellFormedAccessToken(token: unknown): boolean {
  return typeof token === 'string' && ACCESS_TOKEN_PATTERN.test(token)
}

const WINDOW_MS = 60_000
const LIMIT_PER_WINDOW = 30

/** key -> timestamps within the current window. Bounded by the sweep in `throttleTokenView`. */
const hits = new Map<string, number[]>()

/**
 * Returns true when the request should be served, false when it has exceeded the window.
 *
 * Keyed on the token HASH rather than the raw token so nothing secret is retained in
 * process memory, and so the key is a fixed-width string.
 */
export function throttleTokenView(key: string, now: number = Date.now()): boolean {
  const cutoff = now - WINDOW_MS

  // Opportunistic sweep: without it this Map grows once per distinct token, forever, in a
  // long-lived Fluid Compute instance.
  if (hits.size > 5_000) {
    for (const [k, times] of hits) {
      const live = times.filter((t) => t > cutoff)
      if (live.length === 0) hits.delete(k)
      else hits.set(k, live)
    }
  }

  const recent = (hits.get(key) ?? []).filter((t) => t > cutoff)
  if (recent.length >= LIMIT_PER_WINDOW) {
    hits.set(key, recent)
    return false
  }
  recent.push(now)
  hits.set(key, recent)
  return true
}

/** Test seam — the module-level Map would otherwise leak between test cases. */
export function __resetTokenViewThrottle(): void {
  hits.clear()
}

export const TOKEN_VIEW_WINDOW_MS = WINDOW_MS
export const TOKEN_VIEW_LIMIT_PER_WINDOW = LIMIT_PER_WINDOW
