import { safeMediaUrls, safeYoutubeUrl } from '@/lib/safe-url'

interface Props {
  mediaUrls: string[]
  youtubeUrl: string | null
  teamName: string
}

export function MediaBlock({ mediaUrls: rawMediaUrls, youtubeUrl, teamName }: Props) {
  // Render-side allowlist. teams.media_urls is untyped jsonb and predates updateTeam
  // validation, so rows written earlier may point at arbitrary third-party hosts —
  // which on a sponsor-facing page leaks the sponsor's IP to whoever the coach chose.
  const mediaUrls = safeMediaUrls(rawMediaUrls)
  const safeYoutube = safeYoutubeUrl(youtubeUrl)
  if (mediaUrls.length === 0 && !safeYoutube) return null

  return (
    <section className="space-y-6">
      <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Media</span>
      {mediaUrls.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {mediaUrls.map((url, i) => (
            <div key={i} className="aspect-video overflow-hidden rounded-xl border border-border bg-muted">
              <img
                src={url}
                alt={`${teamName} photo ${i + 1}`}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </div>
          ))}
        </div>
      )}
      {safeYoutube && (
        <div className="flex items-center gap-2">
          <a
            href={safeYoutube}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
          >
            ▶ Watch on YouTube
          </a>
        </div>
      )}
    </section>
  )
}
