import { z } from 'zod'

/**
 * Zod 4 compiles object schemas with `new Function(...)` for a faster parse path. Under
 * our Content-Security-Policy (`script-src` without `'unsafe-eval'`, see next.config.ts)
 * that call is blocked, and Chrome reports a CSP issue on every route that ships a schema
 * to the browser.
 *
 * Nothing actually breaks — Zod feature-detects via `util.allowsEval` and falls back to
 * the interpreted path — but "it only fails safely" is a poor reason to keep emitting
 * security violations, and the alternative (adding `'unsafe-eval'` to the CSP) would give
 * back most of what the policy is there to take away.
 *
 * `jitless` skips the probe entirely. The cost is the interpreted parse path, which is
 * irrelevant for form-sized objects.
 *
 * Import `z` from HERE, not from 'zod', in any module that builds a schema reachable from
 * a Client Component — the config has to be applied before the first schema is
 * constructed, because that is when Zod evaluates whether the fast path is available.
 */
z.config({ jitless: true })

export { z }
