import { MetadataRoute } from 'next'

/**
 * Deliberately does NOT import `lib/env`.
 *
 * `lib/env.ts:63-65` THROWS at production runtime for any missing required variable, and
 * `SENTRY_DSN` is absent from every Vercel environment today (report §2 item 1). Importing
 * it here turns a must-never-fail static route into a 500 — verified locally against
 * `next start`, where /robots.txt and /sitemap.xml both returned
 * `500 Missing required environment variables: SENTRY_DSN`. `lib/env.ts:55` even names
 * /sitemap.xml as the route this problem shows up on.
 *
 * That was invisible before the middleware fix, because both routes 307'd to /login
 * before ever executing. Fixing the redirect without this would have swapped a silent
 * redirect for a silent 500 — still unindexable, and harder to notice.
 *
 * NEXT_PUBLIC_APP_URL is a public, build-time-inlined value with no secret in it, so it
 * is read directly and a missing value degrades instead of crashing.
 */
export default function robots(): MetadataRoute.Robots {
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // /teams/ is disallowed because P0-8 removed the public team portfolio route
      // entirely — any URL already in an index should stop being recrawled.
      disallow: ['/admin/', '/api/', '/sponsor-view/', '/dashboard/', '/sponsor/', '/teams/'],
    },
    // Previously hardcoded https://ftcsponsors.example.com/sitemap.xml — a domain this
    // product does not own, so every crawler that read it was pointed at nothing.
    ...(baseUrl ? { sitemap: `${baseUrl}/sitemap.xml`, host: baseUrl } : {}),
  }
}
