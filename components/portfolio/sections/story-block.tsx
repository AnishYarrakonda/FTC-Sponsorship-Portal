import { RichText } from '@/components/ui/rich-text'

interface Props {
  missionStatement: string | null
  foundedYear: number | null
  teamSize: number | null
  seasonsCompeted: number | null
  coachExperience: string | null
  subteamBreakdown: string | null
  coachPhotoUrl: string | null
}

export function StoryBlock({
  missionStatement,
  foundedYear,
  teamSize,
  seasonsCompeted,
  coachExperience,
  subteamBreakdown,
  coachPhotoUrl,
}: Props) {
  const facts = [
    foundedYear ? { label: 'Founded', value: String(foundedYear) } : null,
    teamSize && teamSize > 0 ? { label: 'Students', value: teamSize.toLocaleString() } : null,
    seasonsCompeted && seasonsCompeted > 0
      ? { label: seasonsCompeted === 1 ? 'Season competed' : 'Seasons competed', value: seasonsCompeted.toLocaleString() }
      : null,
  ].filter(Boolean) as { label: string; value: string }[]

  if (!missionStatement && !coachExperience && !subteamBreakdown && facts.length === 0) return null

  return (
    <section className="grid gap-x-12 gap-y-6 md:grid-cols-12">
      <div className="md:col-span-4">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Team Story &amp; People</span>
        {facts.length > 0 && (
          <dl className="mt-4 space-y-3">
            {facts.map((f) => (
              <div key={f.label}>
                <dd className="text-2xl font-semibold tabular-nums text-foreground">{f.value}</dd>
                <dt className="text-xs text-muted-foreground">{f.label}</dt>
              </div>
            ))}
          </dl>
        )}
      </div>
      <div className="md:col-span-8 md:col-start-5 space-y-5">
        {missionStatement && (
          <RichText html={missionStatement} className="text-xl font-medium leading-relaxed text-foreground" />
        )}
        {coachExperience && (
          <div className="flex items-start gap-4 rounded-xl border border-border bg-card p-5">
            {coachPhotoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={coachPhotoUrl}
                alt="Coach"
                className="h-14 w-14 shrink-0 rounded-full border border-border object-cover"
              />
            )}
            <div>
              <p className="mb-1 text-[11px] font-mono uppercase tracking-widest text-muted-foreground">Coaching</p>
              <p className="text-sm leading-relaxed text-foreground/80">{coachExperience}</p>
            </div>
          </div>
        )}
        {subteamBreakdown && (
          <div>
            <p className="mb-1 text-[11px] font-mono uppercase tracking-widest text-muted-foreground">How the team is organized</p>
            <p className="text-sm leading-relaxed text-foreground/80">{subteamBreakdown}</p>
          </div>
        )}
      </div>
    </section>
  )
}
