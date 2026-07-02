import { redirect } from 'next/navigation'
import { getAuthedProfile } from '@/lib/actions-utils'
import { TopNav } from '@/components/landing/top-nav'
import { Hero } from '@/components/landing/hero'
import { FeatureGrid } from '@/components/landing/feature-grid'
import { ProductShowcase, PortfolioMock, ModerationMock } from '@/components/landing/product-showcase'
import { HowItWorks } from '@/components/landing/how-it-works'
import { FAQ } from '@/components/landing/faq'
import { LandingFooter } from '@/components/landing/footer'
import { InitialLoader } from '@/components/landing/initial-loader'
import { AccentSection, CharcoalCard } from '@/components/ui/accent-section'
import Link from 'next/link'

export default async function HomePage() {
  const authed = await getAuthedProfile()

  if (authed) {
    const { supabase, user } = authed
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, coach_verified')
      .eq('id', user.id)
      .single()

    if (profile?.role === 'admin') redirect('/admin')
    if (profile?.role === 'sponsor') redirect('/sponsor/dashboard')
    if (profile?.role === 'coach' && !profile.coach_verified) {
      redirect('/awaiting-verification')
    }
    redirect('/dashboard')
  }

  return (
    <div className="min-h-screen text-foreground antialiased transition-colors duration-300 selection:bg-primary/20">
      <InitialLoader />
      <TopNav />
      <main>
        <Hero />
        <div id="product">
          <FeatureGrid />
        </div>
        
        <ProductShowcase
          title="Build your team story once. Fork it a hundred times."
          body="Your Portfolio is the canonical source — story, budget bands, achievements, links. Every submission forks from it, keeping the asks custom without rewriting the fundamentals."
          bullets={[
            'One portfolio, zero duplicated maintenance',
            'Budget line-items with live totals',
            'FTC team number verification built in',
          ]}
          visual={<PortfolioMock />}
        />
        
        <ProductShowcase
          flipped
          title="Nothing ships without a human read."
          body="Every outbound sponsor email queues for admin review. Approve, send changes back, or block — the submission thread stays tied to the audit log."
          bullets={[
            'Every email read by a human admin',
            'Inline redlines, not rejection emails',
            'Immutable audit trail per decision',
          ]}
          visual={<ModerationMock />}
        />

        <AccentSection>
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-24 items-center">
            <div>
              <h2 className="text-4xl md:text-5xl lg:text-6xl font-medium tracking-tight leading-[1.1] mb-6">
                Fund your season without the busywork.
              </h2>
              <p className="text-lg md:text-xl text-primary-foreground/80 mb-10 max-w-lg leading-relaxed">
                Stop managing spreadsheets and tracking cold emails. 
                Focus on building the robot while we handle the dispatch and follow-ups.
              </p>
              <Link href="/signup" className="inline-flex items-center justify-center rounded-full bg-card px-8 py-4 text-sm font-medium text-primary hover:bg-card/90 transition-colors shadow-xl active:scale-[0.98]">
                Start pitching
              </Link>
            </div>
            <CharcoalCard className="flex flex-col justify-center">
              <div className="text-sm font-mono text-text-muted uppercase tracking-wider mb-2">Platform Metrics</div>
              <div className="text-5xl md:text-6xl font-medium tracking-tight text-white mb-2">100%</div>
              <div className="text-lg text-charcoal-foreground/70 mb-10">Of pitches read by a human admin before dispatch.</div>

              <div className="text-5xl md:text-6xl font-medium tracking-tight text-white mb-2">&lt; 24h</div>
              <div className="text-lg text-charcoal-foreground/70">Average turnaround for review and URL signing.</div>
            </CharcoalCard>
          </div>
        </AccentSection>

        <HowItWorks />
        <FAQ />
      </main>
      <LandingFooter />
    </div>
  )
}
