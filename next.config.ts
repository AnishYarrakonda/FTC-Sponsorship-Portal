import type { NextConfig } from "next";
import { withBotId } from "botid/next/config";

/**
 * Supabase Storage host for `next/image`.
 *
 * components/coach/portfolio-tab.tsx renders <Image src={item.url}> where item.url is a
 * Supabase Storage public URL, and this config previously had no `images` key at all —
 * Next throws `Invalid src prop … hostname is not configured under images` for any
 * un-allowlisted host, so the Visual Pitch grid breaks the moment a coach uploads
 * anything. Derived from the env var rather than hardcoded so the scratch/staging
 * project works too.
 */
const supabaseHost = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').hostname
  } catch {
    return null
  }
})()

/**
 * Clerk's frontend API host is encoded in the publishable key: strip the `pk_test_` /
 * `pk_live_` prefix, base64-decode, drop the trailing `$`. Deriving it means the CSP
 * follows the key through the dev -> production Clerk cutover instead of silently
 * blocking auth the moment the instance changes.
 *
 * The `*.clerk.accounts.dev` / `*.clerk.com` wildcards stay as a backstop: if the key is
 * ever absent at build time, a CSP that omits Clerk entirely would lock every user out
 * of sign-in. Failing open on ONE origin is better than an unusable product.
 */
const clerkHost = (() => {
  const pk = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? ''
  try {
    const decoded = Buffer.from(pk.replace(/^pk_(test|live)_/, ''), 'base64').toString('utf8')
    const host = decoded.replace(/\$$/, '').trim()
    return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host) ? `https://${host}` : null
  } catch {
    return null
  }
})()

const clerkOrigins = [clerkHost, 'https://*.clerk.accounts.dev', 'https://*.clerk.com']
  .filter(Boolean)
  .join(' ')

const supabaseOrigin = supabaseHost ? `https://${supabaseHost}` : ''
const supabaseSocket = supabaseHost ? `wss://${supabaseHost}` : ''

/**
 * Content-Security-Policy.
 *
 * `'unsafe-inline'` in script-src is a deliberate, documented compromise, not an
 * oversight. The strict alternative is a per-request nonce + `'strict-dynamic'`, which
 * on App Router has to be minted in middleware and threaded through ClerkProvider. That
 * is a real change to the auth entry path, and this CSP is being added in the same pass
 * as a production deploy whose authenticated routes cannot be browser-verified yet
 * (no test session). A wrong CSP is a hard, total outage.
 *
 * What this policy still buys, with inline scripts allowed:
 *   - no script may load from an origin not listed here (blocks injected 3rd-party JS)
 *   - object-src 'none'          — no Flash/applet/plugin vector
 *   - base-uri 'self'            — cannot re-point every relative URL on the page
 *   - form-action                — an injected <form> cannot POST credentials offsite
 *   - frame-ancestors 'none'     — clickjacking, incl. the sponsor fund button
 *
 * Nonce + strict-dynamic is the tracked follow-up; do it once a browser session can
 * verify every authenticated route.
 */
const csp = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline' ${clerkOrigins} https://challenges.cloudflare.com`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' blob: data: ${supabaseOrigin} https://img.clerk.com`,
  `font-src 'self' data:`,
  // Supabase REST/Storage + realtime socket, Clerk, and Sentry ingest. Sentry is listed
  // even though SENTRY_DSN is currently unset in Vercel, so turning it on does not
  // require a second deploy to unblock the beacon.
  `connect-src 'self' ${supabaseOrigin} ${supabaseSocket} ${clerkOrigins} https://*.ingest.sentry.io https://*.ingest.us.sentry.io`,
  `worker-src 'self' blob:`,
  `frame-src 'self' ${clerkOrigins} https://challenges.cloudflare.com`,
  `frame-ancestors 'none'`,
  `object-src 'none'`,
  `base-uri 'self'`,
  `form-action 'self' ${clerkOrigins}`,
  `upgrade-insecure-requests`,
]
  .map((d) => d.replace(/\s+/g, ' ').trim())
  .join('; ')

/**
 * Security headers. Production served only Vercel's default HSTS — no CSP, no
 * X-Frame-Options, no X-Content-Type-Options, no Referrer-Policy, no Permissions-Policy.
 *
 * The sharpest of these is Referrer-Policy: /sponsor-view/[token] is a TOKEN-BEARING URL
 * that renders coach-supplied outbound links, so the default referrer behaviour leaks a
 * live sponsor-decision token to every third-party site a sponsor clicks through to.
 * `rel="noreferrer"` is set at that call site today, but that should not depend on
 * remembering the attribute at every future one.
 */
const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  // Clickjacking. The realistic attack is framing the sponsor's fund button.
  { key: 'X-Frame-Options', value: 'DENY' },
  // Stops the browser second-guessing Content-Type on user-uploaded objects.
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Never send a token-bearing path cross-origin.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Nothing in this product uses these.
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
]

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '5mb',
    },
  },

  // `x-powered-by: Next.js` leaks the stack for no benefit.
  poweredByHeader: false,

  images: {
    remotePatterns: supabaseHost
      ? [{ protocol: 'https', hostname: supabaseHost, pathname: '/storage/v1/object/public/**' }]
      : [],
  },

  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
};

/**
 * Vercel BotID (Basic mode) — invisible bot protection on the sponsor application and
 * both signup paths. `withBotId` only adds the same-origin rewrites that proxy the
 * challenge script; everything configured above (CSP headers, images, serverActions body
 * limit, poweredByHeader) is preserved untouched.
 *
 * Because the challenge is served same-origin through those rewrites, the existing
 * `script-src 'self'` already covers it — no CSP change is needed, and a CSP-blocked
 * challenge script would make checkBotId() classify every real human as a bot.
 */
export default withBotId(nextConfig);
