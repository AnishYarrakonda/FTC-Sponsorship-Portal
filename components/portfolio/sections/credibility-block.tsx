import { RichText } from '@/components/ui/rich-text'

export interface PressLink {
  label: string
  url: string
}

interface Props {
  pastSponsors: string[]
  pressLinks: PressLink[]
  communityEndorsements: string | null
  taxStatus: string | null
  organization: string | null
  ftcTeamNumber: number | null
}

function safeHttpUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null
  } catch {
    return null
  }
}

function taxLabel(status: string | null): string | null {
  if (status === '501c3') return 'IRS 501(c)(3) tax-exempt nonprofit'
  if (status === 'School') return 'School-based program'
  return null
}

export function CredibilityBlock({
  pastSponsors,
  pressLinks,
  communityEndorsements,
  taxStatus,
  organization,
  ftcTeamNumber,
}: Props) {
  const tax = taxLabel(taxStatus)
  const validPress = pressLinks
    .map((p) => ({ label: p.label, url: safeHttpUrl(p.url) }))
    .filter((p): p is { label: string; url: string } => !!p.url)

  const registrations = [
    ftcTeamNumber ? `Registered FIRST Tech Challenge team #${ftcTeamNumber}` : null,
    organization,
    tax,
  ].filter(Boolean) as string[]

  if (pastSponsors.length === 0 && validPress.length === 0 && !communityEndorsements && registrations.length === 0) {
    return null
  }

  return (
    <section className="grid gap-x-12 gap-y-6 md:grid-cols-12">
      <div className="md:col-span-4">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Credibility</span>
      </div>
      <div className="md:col-span-8 md:col-start-5 space-y-5">
        {registrations.length > 0 && (
          <ul className="space-y-1.5">
            {registrations.map((r) => (
              <li key={r} className="flex items-start gap-2 text-sm text-foreground/80">
                <span className="mt-0.5 text-emerald-600 dark:text-emerald-400">✓</span>
                {r}
              </li>
            ))}
          </ul>
        )}
        {pastSponsors.length > 0 && (
          <div>
            <p className="mb-2 text-[11px] font-mono uppercase tracking-widest text-muted-foreground">Past sponsors</p>
            <div className="flex flex-wrap gap-2">
              {pastSponsors.map((s) => (
                <span
                  key={s}
                  className="inline-flex items-center rounded-full border border-border bg-accent/60 px-3 py-1 text-xs font-medium text-foreground"
                >
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}
        {validPress.length > 0 && (
          <div>
            <p className="mb-2 text-[11px] font-mono uppercase tracking-widest text-muted-foreground">In the press</p>
            <ul className="space-y-1.5">
              {validPress.map((p) => (
                <li key={p.url}>
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                  >
                    {p.label} ↗
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
        {communityEndorsements && (
          <div className="rounded-xl border border-border bg-card p-5">
            <p className="mb-1 text-[11px] font-mono uppercase tracking-widest text-muted-foreground">Community endorsements</p>
            <RichText html={communityEndorsements} className="text-sm leading-relaxed text-foreground/80" />
          </div>
        )}
      </div>
    </section>
  )
}
