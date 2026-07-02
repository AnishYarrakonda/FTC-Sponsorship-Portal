import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import { createHash } from 'crypto'
import { SponsorDecisionPanel } from '@/components/sponsor/sponsor-decision-panel'
import { RichText } from '@/components/ui/rich-text'
import { htmlToPlainText } from '@/lib/utils'

interface Props {
  params: Promise<{ token: string }>
}

function taxBadge(status: string): { label: string; className: string } | null {
  if (status === '501c3') return { label: '✓ IRS 501(c)(3) Tax-Exempt', className: 'bg-[var(--badge-success-bg)] text-[var(--badge-success-text)] border-[var(--badge-success-text)]/20' }
  if (status === 'School') return { label: '✓ Public School Program', className: 'bg-[var(--bg-elevated)] text-[var(--text-primary)] border-[var(--border-default)]' }
  return null
}

function safeHttpUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null
  } catch {
    return null
  }
}

export default async function SponsorViewPage({ params }: Props) {
  const { token } = await params
  const supabase = createAdminClient()

  const tokenHash = createHash('sha256').update(token).digest('hex')

  const { data: accessToken } = await supabase
    .from('submission_access_tokens')
    .select('*, submissions:submission_id(*, teams:team_id(*, team_achievements(*), profiles:owner_id(full_name, email)), sponsors:sponsor_id(*))')
    .eq('token_hash', tokenHash)
    .single()

  if (!accessToken) return notFound()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = accessToken as any
  if (row.revoked_at) return notFound()

  const expired = new Date(row.expires_at) < new Date()
  const decided = !!row.used_at

  const submission = row.submissions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const team = submission.teams as Record<string, any>
  const budgetItems = (team.budget_items as { label: string; qty: number; unit_cost_cents: number; total_cents: number }[]) ?? []
  const totalAsk = (team.financial_ask_cents as number) ?? 0
  const mediaUrls = (team.media_urls as string[]) ?? []
  const achievements = ((team.team_achievements as { id: string; season: string | null; event_name: string; award: string | null; description: string | null }[]) ?? [])
    .slice()
    .sort((a, b) => (b.season ?? '').localeCompare(a.season ?? ''))
  const pastSponsors = (team.past_sponsors as string[]) ?? []
  const pressLinks = ((team.press_links as { label: string; url: string }[]) ?? [])
    .map((p) => ({ label: p.label, url: safeHttpUrl(p.url) }))
    .filter((p): p is { label: string; url: string } => !!p.url)
  const impactStats = [
    team.students_reached ? { label: 'Students reached', value: team.students_reached as number } : null,
    team.events_hosted ? { label: 'Events hosted', value: team.events_hosted as number } : null,
    team.volunteer_hours ? { label: 'Volunteer hours', value: team.volunteer_hours as number } : null,
  ].filter(Boolean) as { label: string; value: number }[]
  const storyFacts = [
    team.founded_year ? `Founded ${team.founded_year}` : null,
    team.team_size ? `${team.team_size} students` : null,
    team.seasons_competed ? `${team.seasons_competed} season${team.seasons_competed === 1 ? '' : 's'} competed` : null,
  ].filter(Boolean) as string[]

  const tax = taxBadge(team.tax_status as string)
  const youtubeUrl = (() => {
    try {
      const h = new URL(String(team.youtube_url ?? '')).hostname.toLowerCase()
      return h === 'youtu.be' || h.endsWith('youtube.com') ? String(team.youtube_url) : null
    } catch { return null }
  })()
  const githubUrl = safeHttpUrl(team.github_link)

  return (
    <div className="min-h-screen">
      <div className="max-w-3xl mx-auto py-12 px-4 space-y-8">

        {/* Header */}
        <div className="bg-card rounded-xl border p-8 shadow-sm space-y-3">
          {mediaUrls.length > 0 && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={mediaUrls[0]}
              alt="Team photo"
              className="w-full h-56 object-cover rounded-lg mb-4"
            />
          )}
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-3xl font-bold text-foreground">{String(team.team_name ?? '')}</h1>
              <p className="text-muted-foreground mt-1">
                {team.ftc_team_number ? `FTC Team #${team.ftc_team_number}` : 'Incubator Team'} · {String(team.state ?? '')}
              </p>
            </div>
            <div className="flex flex-col gap-2 items-end">
              {tax && (
                <span className={`text-xs font-bold px-3 py-1 rounded-full border ${tax.className}`}>
                  {tax.label}
                </span>
              )}
              <span className="text-2xl font-bold text-foreground">
                ${(totalAsk / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </span>
              <span className="text-xs text-muted-foreground">Total Request</span>
            </div>
          </div>

          {(expired || decided) && (
            <div className="mt-4 p-3 rounded-lg bg-[var(--badge-warning-bg)] border border-[var(--badge-warning-text)]/20 text-[var(--badge-warning-text)] text-sm font-medium">
              {decided ? 'A decision has already been recorded for this proposal.' : 'This proposal link has expired.'}
            </div>
          )}
        </div>

        {/* Custom Pitch (submission-specific) */}
        <div className="bg-card rounded-xl border p-8 shadow-sm space-y-4">
          <h2 className="text-lg font-semibold text-foreground">Why We Align With You</h2>
          <p className="whitespace-pre-wrap text-muted-foreground leading-relaxed">{htmlToPlainText(submission.custom_pitch_alignment)}</p>
          <h2 className="text-lg font-semibold text-foreground pt-2">Our Specific Needs</h2>
          <p className="whitespace-pre-wrap text-muted-foreground leading-relaxed">{htmlToPlainText(submission.specific_needs_statement)}</p>
        </div>

        {/* 1. Achievements & Awards */}
        {achievements.length > 0 && (
          <div className="bg-card rounded-xl border p-8 shadow-sm space-y-4">
            <h2 className="text-xl font-bold text-foreground">Achievements &amp; Awards</h2>
            <div className="divide-y divide-border">
              {achievements.map((a) => (
                <div key={a.id} className="py-3">
                  <p className="text-base font-semibold text-foreground">{a.award ?? a.event_name}</p>
                  <p className="text-sm text-muted-foreground">
                    {[a.season, a.award ? a.event_name : null].filter(Boolean).join(' · ')}
                  </p>
                  {a.description && <p className="text-sm text-muted-foreground mt-1">{a.description}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 2. Team Story & People */}
        <div className="bg-card rounded-xl border p-8 shadow-sm space-y-4">
          <h2 className="text-xl font-bold text-foreground">Team Story &amp; People</h2>
          {team.tagline && (
            <p className="text-muted-foreground italic">&ldquo;{String(team.tagline)}&rdquo;</p>
          )}
          {storyFacts.length > 0 && (
            <p className="text-sm font-medium text-foreground">{storyFacts.join(' · ')}</p>
          )}
          {team.mission_statement && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Mission</p>
              <RichText html={String(team.mission_statement)} className="text-foreground leading-relaxed" />
            </div>
          )}
          {team.coach_experience && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Coaching</p>
              <p className="text-muted-foreground leading-relaxed">{String(team.coach_experience)}</p>
            </div>
          )}
          {team.subteam_breakdown && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Team Structure</p>
              <p className="text-muted-foreground leading-relaxed">{String(team.subteam_breakdown)}</p>
            </div>
          )}
        </div>

        {/* 3. Credibility */}
        {(pastSponsors.length > 0 || pressLinks.length > 0 || team.community_endorsements) && (
          <div className="bg-card rounded-xl border p-8 shadow-sm space-y-4">
            <h2 className="text-xl font-bold text-foreground">Credibility</h2>
            {pastSponsors.length > 0 && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Past Sponsors</p>
                <div className="flex flex-wrap gap-2">
                  {pastSponsors.map((s) => (
                    <span key={s} className="inline-flex items-center rounded-full border border-border bg-accent/60 px-3 py-1 text-xs font-medium text-foreground">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {pressLinks.length > 0 && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">In the Press</p>
                <ul className="space-y-1.5">
                  {pressLinks.map((p) => (
                    <li key={p.url}>
                      <a href={p.url} target="_blank" rel="noreferrer" className="text-primary underline text-sm">
                        {p.label} ↗
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {team.community_endorsements && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Community Endorsements</p>
                <RichText html={String(team.community_endorsements)} className="text-muted-foreground leading-relaxed" />
              </div>
            )}
          </div>
        )}

        {/* 4. Community & Ethics Impact */}
        {(impactStats.length > 0 || team.outreach_summary || team.community_interest_text) && (
          <div className="bg-card rounded-xl border p-8 shadow-sm space-y-4">
            <h2 className="text-xl font-bold text-foreground">Community Impact</h2>
            {impactStats.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-3">
                {impactStats.map((s) => (
                  <div key={s.label} className="rounded-lg border border-border bg-background p-4 text-center">
                    <p className="text-2xl font-bold tabular-nums text-foreground">{s.value.toLocaleString()}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{s.label}</p>
                  </div>
                ))}
              </div>
            )}
            {team.outreach_summary && (
              <RichText html={String(team.outreach_summary)} className="text-foreground leading-relaxed" />
            )}
            {team.community_interest_text && (
              <p className="text-muted-foreground leading-relaxed">{String(team.community_interest_text)}</p>
            )}
          </div>
        )}

        {/* 5. Goals & Funding Ask */}
        <div className="bg-card rounded-xl border p-8 shadow-sm space-y-4">
          <h2 className="text-xl font-bold text-foreground">Budget Breakdown</h2>
          <div className="divide-y divide-border">
            {budgetItems.map((item, i) => (
              <div key={i} className="flex justify-between py-2 text-sm">
                <span className="text-muted-foreground">{item.qty}× {item.label}</span>
                <span className="font-medium text-foreground">${(item.total_cents / 100).toFixed(2)}</span>
              </div>
            ))}
            <div className="flex justify-between py-3 font-bold text-base text-foreground">
              <span>Total Request</span>
              <span>${(totalAsk / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
            </div>
          </div>
          {team.sustainability_plan && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Sustainability Plan</p>
              <p className="text-muted-foreground leading-relaxed">{String(team.sustainability_plan)}</p>
            </div>
          )}
        </div>

        {/* 6. Media */}
        {youtubeUrl && (
          <div className="bg-card rounded-xl border p-8 shadow-sm space-y-2">
            <h2 className="text-lg font-semibold text-foreground">Video</h2>
            <a href={youtubeUrl} target="_blank" rel="noreferrer" className="text-primary underline text-sm">
              Watch on YouTube →
            </a>
          </div>
        )}

        {/* 7. Robot & Engineering (slim, optional) */}
        {(team.technical_summary || githubUrl) && (
          <div className="bg-card/60 rounded-xl border border-border/70 p-6 shadow-sm space-y-2">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Robot &amp; Engineering</p>
            {team.technical_summary && (
              <RichText html={String(team.technical_summary)} className="text-sm text-muted-foreground leading-relaxed" />
            )}
            {githubUrl && (
              <a href={githubUrl} target="_blank" rel="noreferrer" className="text-primary underline text-sm">
                View code on GitHub →
              </a>
            )}
          </div>
        )}

        {/* Decision Panel */}
        {!expired && !decided && (
          <SponsorDecisionPanel
            token={token}
            totalAskCents={totalAsk}
            teamName={String(team.team_name ?? '')}
          />
        )}

        <p className="text-center text-xs text-muted-foreground pb-8">
          Verified by FTC Matchmaker
        </p>
      </div>
    </div>
  )
}
