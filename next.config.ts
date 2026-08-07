import type { NextConfig } from "next";

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
 * Security headers. Production served only Vercel's default HSTS — no CSP, no
 * X-Frame-Options, no X-Content-Type-Options, no Referrer-Policy, no Permissions-Policy.
 *
 * The sharpest of these is Referrer-Policy: /sponsor-view/[token] is a TOKEN-BEARING URL
 * that renders coach-supplied outbound links, so the default referrer behaviour leaks a
 * live sponsor-decision token to every third-party site a sponsor clicks through to.
 * `rel="noreferrer"` is set at that call site today, but that should not depend on
 * remembering the attribute at every future one.
 *
 * CSP is deliberately NOT set here — see docs/REMEDIATION-LOG.md. It needs a real nonce
 * strategy across Clerk, Supabase and Vercel origins, and a wrong CSP takes the site
 * down hard. Proposed separately rather than rushed.
 */
const securityHeaders = [
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

export default nextConfig;
