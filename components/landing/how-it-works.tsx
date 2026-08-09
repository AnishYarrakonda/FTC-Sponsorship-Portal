'use client'

import { UserCheck, Wrench, Send, CheckCircle2 } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'
import { FadeUp } from '@/components/motion/fade-up'
import { StaggerContainer, StaggerItem } from '@/components/motion/stagger-container'
import { Section, SectionHeading } from '@/components/ui/section'

const steps = [
  { icon: UserCheck, label: '01', title: 'Apply & verify', body: 'Adult coaches upload credentials. Admin verifies. Student data never enters the system.' },
  { icon: Wrench, label: '02', title: 'Build your base', body: 'One canonical team portfolio — story, budget, achievements, links. Reused everywhere.' },
  { icon: Send, label: '03', title: 'Fork per sponsor', body: 'Customize the ask, local angle, and amount without rewriting your team story.' },
  { icon: CheckCircle2, label: '04', title: 'Dispatch, reviewed', body: 'Admin approves. FTC Pitfund sends. You get a trackable URL back within hours.' },
]

export function HowItWorks() {
  const reduce = useReducedMotion()
  return (
    <Section id="how" className="pt-0">
      <FadeUp>
        <SectionHeading 
          title="Four steps between your team and a signed check."
        />
      </FadeUp>

      <div className="relative mt-20">


        <StaggerContainer className="grid gap-12 md:grid-cols-4 md:gap-8">
          {steps.map((s, idx) => {
            const Icon = s.icon
            return (
              <StaggerItem key={s.label} className="relative">
                <div className="relative inline-flex h-20 w-20 items-center justify-center rounded-2xl border border-primary/20 bg-primary/5">
                  <Icon className="h-7 w-7 text-primary" strokeWidth={1.5} />
                  <span className="absolute -top-3 -right-3 rounded-full border border-primary/20 bg-card px-2 py-0.5 text-xs font-mono text-primary shadow-sm">
                    {s.label}
                  </span>
                </div>
                {idx < steps.length - 1 && (
                  <div className="hidden md:flex absolute top-0 left-[80px] h-20 w-[calc(100%+32px-80px)] items-center justify-center text-primary/30">
                     <svg width="72" height="24" viewBox="0 0 72 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                       <path d="M0 12h70"/><path d="m63 5 7 7-7 7"/>
                     </svg>
                  </div>
                )}
                <h3 className="mt-6 text-lg font-medium tracking-tight text-foreground">{s.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{s.body}</p>
              </StaggerItem>
            )
          })}
        </StaggerContainer>
      </div>
    </Section>
  )
}
