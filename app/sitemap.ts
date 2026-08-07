import { MetadataRoute } from 'next'

/**
 * Deliberately does NOT import `lib/env` — see the note in app/robots.ts. `lib/env.ts`
 * throws at production runtime on any missing variable (SENTRY_DSN is absent from every
 * Vercel environment today), and `lib/env.ts:55` names THIS route as the one that
 * crashes. Verified locally: with the env import, `next start` served
 * `500 Missing required environment variables: SENTRY_DSN` here.
 *
 * Also previously defaulted to the placeholder domain ftcsponsors.example.com, which the
 * product does not own.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')

  // Sitemap entries must be absolute. With no configured origin there is nothing
  // meaningful to publish, so serve an empty sitemap rather than invalid URLs.
  if (!baseUrl) return []

  const lastModified = new Date()

  // Public, indexable routes only. /sponsors/browse was listed here but lives under the
  // (coach) route group behind auth — advertising a login-gated URL to crawlers is a
  // soft-404. /teams/[slug] was removed entirely by P0-8.
  return [
    { url: baseUrl, lastModified, changeFrequency: 'weekly', priority: 1 },
    { url: `${baseUrl}/sponsors/apply`, lastModified, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${baseUrl}/signup`, lastModified, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${baseUrl}/login`, lastModified, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${baseUrl}/legal/privacy`, lastModified, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${baseUrl}/legal/terms`, lastModified, changeFrequency: 'yearly', priority: 0.2 },
  ]
}
