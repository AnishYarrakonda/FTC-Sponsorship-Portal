/**
 * Placeholder image for the three dev preview fixture sets.
 *
 * The fixtures used to point `proof_url` at `https://example.supabase.co/…`, a host that
 * does not exist and that `img-src` does not allow — so every preview mode rendered a
 * broken image and logged a CSP violation. The point of the preview modes is that someone
 * can look at the portals without a database; a visibly broken image undermines exactly
 * that.
 *
 * A `data:` URI rather than a file in `public/`: `img-src` already permits `data:`, it
 * cannot 404, and it keeps the fixtures self-contained in the dev-only modules that are
 * force-disabled in production.
 */
export const PREVIEW_PLACEHOLDER_IMAGE =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" role="img" aria-label="Sample recognition proof">
       <rect width="480" height="320" fill="#F1ECE3"/>
       <rect x="16" y="16" width="448" height="288" fill="none" stroke="#95886F" stroke-width="2" stroke-dasharray="8 6"/>
       <text x="240" y="156" font-family="system-ui, sans-serif" font-size="20" fill="#6B6459" text-anchor="middle">Sample recognition proof</text>
       <text x="240" y="184" font-family="system-ui, sans-serif" font-size="14" fill="#95886F" text-anchor="middle">preview fixture — not real data</text>
     </svg>`,
  )
