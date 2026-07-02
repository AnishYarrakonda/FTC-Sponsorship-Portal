import { RichText } from '@/components/ui/rich-text'

interface Props {
  outreachSummary: string | null
  studentsReached: number | null
  eventsHosted: number | null
  volunteerHours: number | null
  communityInterestText: string | null
}

export function ImpactBlock({
  outreachSummary,
  studentsReached,
  eventsHosted,
  volunteerHours,
  communityInterestText,
}: Props) {
  const stats = [
    studentsReached && studentsReached > 0 ? { label: 'Students reached', value: studentsReached } : null,
    eventsHosted && eventsHosted > 0 ? { label: 'Events hosted', value: eventsHosted } : null,
    volunteerHours && volunteerHours > 0 ? { label: 'Volunteer hours', value: volunteerHours } : null,
  ].filter(Boolean) as { label: string; value: number }[]

  if (!outreachSummary && !communityInterestText && stats.length === 0) return null

  return (
    <section className="grid gap-x-12 gap-y-6 md:grid-cols-12">
      <div className="md:col-span-4">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Community &amp; Ethics Impact</span>
      </div>
      <div className="md:col-span-8 md:col-start-5 space-y-5">
        {stats.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-3">
            {stats.map((s) => (
              <div key={s.label} className="rounded-xl border border-border bg-card p-4 text-center">
                <p className="text-3xl font-semibold tabular-nums text-foreground">{s.value.toLocaleString()}</p>
                <p className="mt-1 text-xs text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
        )}
        {outreachSummary && (
          <RichText html={outreachSummary} className="text-base leading-relaxed text-foreground/80" />
        )}
        {communityInterestText && (
          <div>
            <p className="mb-1 text-[11px] font-mono uppercase tracking-widest text-muted-foreground">Community interest</p>
            <p className="text-sm leading-relaxed text-foreground/80">{communityInterestText}</p>
          </div>
        )}
      </div>
    </section>
  )
}
