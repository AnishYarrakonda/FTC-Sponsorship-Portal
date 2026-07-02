import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { HeroBlock } from '@/components/portfolio/sections/hero-block'
import { AchievementsBlock } from '@/components/portfolio/sections/achievements-block'
import { StoryBlock } from '@/components/portfolio/sections/story-block'
import { CredibilityBlock, type PressLink } from '@/components/portfolio/sections/credibility-block'
import { ImpactBlock } from '@/components/portfolio/sections/impact-block'
import { BudgetBlock } from '@/components/portfolio/sections/budget-block'
import { MediaBlock } from '@/components/portfolio/sections/media-block'
import { EngineeringBlock } from '@/components/portfolio/sections/engineering-block'

interface Props {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('teams')
    .select('team_name, mission_statement, logo_url')
    .eq('slug', slug)
    .eq('public', true)
    .is('deleted_at', null)
    .single()

  if (!data) return { title: 'Team Portfolio' }
  return {
    title: `${data.team_name} — FTC Sponsorship Portfolio`,
    description: data.mission_statement ?? undefined,
    openGraph: {
      title: data.team_name,
      description: data.mission_statement ?? undefined,
      images: data.logo_url ? [data.logo_url] : [],
    },
  }
}

export default async function PublicTeamPortfolio({ params }: Props) {
  const { slug } = await params
  const supabase = await createClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: team } = await (supabase as any)
    .from('teams')
    .select('*')
    .eq('slug', slug)
    .eq('public', true)
    .is('deleted_at', null)
    .single()

  if (!team) notFound()

  const { data: achievements } = await supabase
    .from('team_achievements')
    .select('*')
    .eq('team_id', team.id)
    .order('season', { ascending: false })

  const budgetItems = (team.budget_items ?? []) as {
    label: string; qty: number; unit_cost_cents: number; total_cents: number
  }[]
  const mediaUrls = (team.media_urls ?? []) as string[]
  const pastSponsors = (team.past_sponsors ?? []) as string[]
  const pressLinks = (team.press_links ?? []) as PressLink[]

  return (
    <div className="min-h-screen text-foreground">
      {/* Nav */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/85 backdrop-blur-md print:hidden">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-6 py-3">
          <Link href="/" className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground transition-colors">
            FTC Matchmaker
          </Link>
          <Link
            href="/sponsors/apply"
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-foreground px-4 text-xs font-medium text-background hover:-translate-y-px transition-all"
          >
            Sponsor this team
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-16 px-6 py-12">
        <HeroBlock
          teamName={team.team_name}
          ftcTeamNumber={team.ftc_team_number}
          organization={team.organization}
          city={team.city}
          state={team.state}
          taxStatus={team.tax_status}
          logoUrl={team.logo_url}
          financialAskCents={team.financial_ask_cents ?? 0}
        />

        <div className="border-t border-border" />

        {/* 1. Achievements & Awards */}
        <AchievementsBlock achievements={achievements ?? []} />

        {/* 2. Team Story & People */}
        <StoryBlock
          missionStatement={team.mission_statement}
          foundedYear={team.founded_year}
          teamSize={team.team_size}
          seasonsCompeted={team.seasons_competed}
          coachExperience={team.coach_experience}
          subteamBreakdown={team.subteam_breakdown}
          coachPhotoUrl={team.coach_photo_url}
        />

        {/* 3. Credibility */}
        <CredibilityBlock
          pastSponsors={pastSponsors}
          pressLinks={pressLinks}
          communityEndorsements={team.community_endorsements}
          taxStatus={team.tax_status}
          organization={team.organization}
          ftcTeamNumber={team.ftc_team_number}
        />

        {/* 4. Community & Ethics Impact */}
        <ImpactBlock
          outreachSummary={team.outreach_summary}
          studentsReached={team.students_reached}
          eventsHosted={team.events_hosted}
          volunteerHours={team.volunteer_hours}
          communityInterestText={team.community_interest_text}
        />

        {/* 5. Goals & Funding Ask */}
        <BudgetBlock
          items={budgetItems}
          totalCents={team.financial_ask_cents ?? 0}
          sustainabilityPlan={team.sustainability_plan}
          seedFundingGoalsCents={team.status === 'incubator' ? team.seed_funding_goals_cents : null}
        />

        {/* 6. Media */}
        <MediaBlock
          mediaUrls={mediaUrls}
          youtubeUrl={team.youtube_url}
          teamName={team.team_name}
        />

        {/* 7. Robot & Engineering (slim, optional) */}
        <EngineeringBlock
          technicalSummary={team.technical_summary}
          githubLink={team.github_link}
        />

        {/* Footer CTA */}
        <div className="rounded-2xl border border-border bg-card p-8 text-center space-y-3 print:hidden">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Interested in supporting?</p>
          <h2 className="text-2xl font-semibold text-foreground">Partner with {team.team_name}</h2>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Your sponsorship helps cover robot parts, competition fees, and outreach events.
          </p>
          <a
            href="/sponsors/apply"
            className="inline-flex h-11 items-center gap-2 rounded-full bg-foreground px-6 text-sm font-medium text-background shadow-[0_8px_24px_-8px_rgba(0,0,0,0.45)] hover:-translate-y-px hover:shadow-[0_16px_28px_-12px_rgba(0,0,0,0.55)] transition-all"
          >
            Apply to Sponsor →
          </a>
        </div>
      </main>

      {/* Print styles */}
      <style>{`
        @media print {
          header, footer { display: none !important; }
          body { background: white; color: black; }
          .print\\:hidden { display: none !important; }
        }
      `}</style>
    </div>
  )
}
