'use client'

import { FadeUp } from '@/components/motion/fade-up'
import { Accordion } from '@/components/ui/accordion'
import { Section } from '@/components/ui/section'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { SUPPORT_EMAIL } from '@/lib/site-config'

const items = [
  {
    q: 'Is FTC Matchmaker COPPA compliant?',
    a: 'Yes — structurally, not just on paper. Only verified adult coaches can register. Student PII never enters the database, and row-level security enforces that guarantee even against a misbehaving admin.',
  },
  {
    q: 'How long does dispatch review usually take?',
    a: 'Every email is read by a human admin before it leaves the platform — we aim to review within one business day. No auto-send, no LLM-grammar-check-and-ship.',
  },
  {
    q: 'How do you vet sponsors?',
    a: 'Sponsors apply through a dedicated form and are approved manually. Funding caps are declared up front and enforced at the database level — a sponsor cannot be over-committed, even under race conditions.',
  },
  {
    q: 'Does it cost anything?',
    a: 'FTC Matchmaker is free for teams during the 2026 season. Sponsors pay nothing to be listed. We do not take a cut of funding.',
  },
  {
    q: 'What happens to my team data if we leave?',
    a: 'Coaches can export their full portfolio as JSON + PDF and request deletion at any time. Deletion is hard — not soft — and is logged in an immutable audit trail.',
  },
  {
    q: 'Can my team use FTC Matchmaker without my coach onboard?',
    a: 'No. The platform requires a verified adult coach to originate every submission. This is a hard constraint, not a policy — student-only accounts cannot be created.',
  },
]

export function FAQ() {
  return (
    <Section id="faq" className="bg-card border-y border-border">
      <div className="mx-auto max-w-4xl flex flex-col items-center">
        <FadeUp className="text-center flex flex-col items-center">
          <h2 className="text-3xl md:text-4xl font-medium tracking-tight text-foreground">
            Questions coaches actually ask.
          </h2>
          <p className="mt-4 text-[17px] text-muted-foreground leading-relaxed max-w-2xl">
            Have a question that isn&apos;t answered here? Reach out to our team.
          </p>
          <Link 
            href={`mailto:${SUPPORT_EMAIL}`}
            className="mt-8 mb-12 inline-flex w-fit items-center gap-2 rounded-full border border-border bg-background px-6 py-3 text-sm font-medium text-foreground hover:bg-accent transition-colors shadow-sm"
          >
            Contact support
            <ArrowRight className="h-4 w-4" strokeWidth={1.5} />
          </Link>
        </FadeUp>
        <div className="w-full">
          <FadeUp delay={0.1}>
            <Accordion items={items} />
          </FadeUp>
        </div>
      </div>
    </Section>
  )
}
