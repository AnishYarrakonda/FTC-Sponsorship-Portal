'use client'

import { FileCog, ShieldCheck, Mailbox, GitBranch, Gauge, Lock } from 'lucide-react'
import { FadeUp } from '@/components/motion/fade-up'
import { StaggerContainer, StaggerItem } from '@/components/motion/stagger-container'
import { Section, SectionHeading } from '@/components/ui/section'

const features = [
  {
    icon: FileCog,
    title: 'One portfolio, every pitch',
    body: 'Ship a single team portfolio and fork it per sponsor — budget, ask, and local angle stay custom without rewriting your story.',
  },
  {
    icon: ShieldCheck,
    title: 'Admin-gated dispatch',
    body: 'Every outbound email passes through a review queue. Nothing leaves the platform until it has been reviewed and approved.',
  },
  {
    icon: Mailbox,
    title: 'Trackable deliveries',
    body: 'Each pitch gets a signed URL. Know when a sponsor opened it, returned to it, and converted — without a marketing stack.',
  },
  {
    icon: Lock,
    title: 'COPPA by default',
    body: 'Only verified adult coaches register. We never collect student PII and enforce that guarantee in the database, not a policy doc.',
  },
  {
    icon: Gauge,
    title: 'Capacity-aware matching',
    body: 'Funding caps are enforced at the row level. Sponsors cannot be over-committed, even under concurrent submissions.',
  },
  {
    icon: GitBranch,
    title: 'Audit log, not just a log',
    body: 'Every admin action is immutable and queryable. Your advisor, your school district, your grantor — all answerable.',
  },
]

export function FeatureGrid() {
  return (
    <Section id="product" className="pt-0">
      <FadeUp>
        <SectionHeading 
          title="Built for coaches who don't have time to send dozens of cold emails."
          description="FTC Pitfund replaces the spray-and-pray sponsorship workflow with a single pipeline that your admins, your grantors, and your team lead can all trust."
        />
      </FadeUp>

      <StaggerContainer className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((f) => {
          const Icon = f.icon
          return (
            <StaggerItem
              key={f.title}
              className="group relative rounded-xl border border-border bg-card p-8 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                <Icon className="h-6 w-6" strokeWidth={1.5} />
              </div>
              <h3 className="mt-6 text-lg font-medium tracking-tight text-foreground">{f.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{f.body}</p>
            </StaggerItem>
          )
        })}
      </StaggerContainer>
    </Section>
  )
}
