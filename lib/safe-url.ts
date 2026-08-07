/**
 * Render-time URL allowlists.
 *
 * `updateTeam` performed no validation at all, so `media_urls` and `press_links` were
 * writable with arbitrary content — and, crucially, remained mutable **after** an admin
 * approved a pitch. The admin reviews image A, the coach calls `updateTeam`, the sponsor
 * opens image B. That defeats the Admin-Gatekept Outreach mandate without touching
 * `submissions` or the dispatch path at all.
 *
 * Validation is now enforced on the write path, but a render-side allowlist is the part
 * that actually holds: rows written before the fix are still in the database, and
 * `teams.media_urls` is untyped `jsonb`. `youtubeUrl` already had a render-side host
 * check (app/sponsor-view/[token]/page.tsx:74-78) — these are its missing counterparts,
 * hoisted here so the three ad-hoc `safeHttpUrl` copies stop drifting apart.
 */

/** Any http(s) URL. Blocks javascript:, data:, file:, and anything unparseable. */
export function safeHttpUrl(url: unknown): string | null {
  if (typeof url !== 'string' || url.trim() === '') return null
  try {
    const parsed = new URL(url.trim())
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null
  } catch {
    return null
  }
}

/**
 * Team-supplied imagery must come from our own Supabase Storage — the same rule
 * `teamOnboardingSchema.mediaUrls` enforces on write. A sponsor-facing page must never
 * load a coach-supplied image from an arbitrary third-party host: it leaks the sponsor's
 * IP and the referrer of a token-bearing page to whoever the coach chose.
 */
export function safeMediaUrl(url: unknown): string | null {
  const href = safeHttpUrl(url)
  if (!href) return null
  try {
    const host = new URL(href).hostname.toLowerCase()
    return host.endsWith('.supabase.co') || host.endsWith('.supabase.com') ? href : null
  } catch {
    return null
  }
}

export function safeMediaUrls(urls: unknown): string[] {
  if (!Array.isArray(urls)) return []
  return urls.map(safeMediaUrl).filter((u): u is string => u !== null)
}

/** YouTube-only, matching the existing check on the sponsor-view page. */
export function safeYoutubeUrl(url: unknown): string | null {
  const href = safeHttpUrl(url)
  if (!href) return null
  try {
    const host = new URL(href).hostname.toLowerCase()
    return host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com') ? href : null
  } catch {
    return null
  }
}
