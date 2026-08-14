/**
 * The same-origin path prefix Vercel BotID serves its challenge and proxy traffic from.
 *
 * `withBotId` (next.config.ts) rewrites this prefix to api.vercel.com. The value is a
 * hardcoded constant inside the `botid` package — it is not exported, so it is mirrored
 * here and pinned by lib/__tests__/botid-paths.test.ts, which reads the installed package
 * and fails if a `botid` upgrade ever changes it.
 *
 * Why this matters: the prefix has to be a PUBLIC route in middleware.ts. If clerkMiddleware
 * redirects the challenge traffic to /login, `checkBotId()` sees no challenge response and
 * classifies every anonymous human on /sponsors/apply and /signup as a bot — a total
 * signup outage that looks like a working deploy.
 */
export const BOTID_PROXY_PREFIX =
  '/149e9513-01fa-4fb0-aad4-566afd725d1b/2d206a39-8ed7-437e-a3be-862e0f06eea3'
