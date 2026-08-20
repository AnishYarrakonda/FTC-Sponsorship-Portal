import { RichText } from '@/components/ui/rich-text'

interface Props {
  technicalSummary: string | null
  githubLink: string | null
}

/**
 * Slim, de-emphasized engineering footnote. Sponsors fund achievements, people,
 * and impact — this exists only for teams that want to show off their build.
 */
export function EngineeringBlock({ technicalSummary, githubLink }: Props) {
  if (!technicalSummary && !githubLink) return null

  return (
    <section className="grid gap-x-12 gap-y-4 md:grid-cols-12">
      <div className="md:col-span-4">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Robot &amp; Engineering</span>
      </div>
      <div className="md:col-span-8 md:col-start-5 space-y-3">
        {technicalSummary && (
          <RichText html={technicalSummary} className="text-sm leading-relaxed text-foreground/70" />
        )}
        {githubLink && (
          <a
            href={githubLink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            View code on GitHub →
          </a>
        )}
      </div>
    </section>
  )
}
