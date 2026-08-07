'use client'

import { Check } from 'lucide-react'
import { FadeUp } from '@/components/motion/fade-up'
import { WindowDots } from '@/components/ui/window-dots'
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'
import { PORTFOLIO_MOCK, DISPATCH_REVIEW } from '@/lib/site-config'

export function ProductShowcase({
  eyebrow,
  title,
  body,
  bullets,
  visual,
  flipped = false,
}: {
  eyebrow?: string
  title: string
  body: string
  bullets: string[]
  visual: ReactNode
  flipped?: boolean
}) {
  return (
    <section className="mx-auto max-w-[1440px] px-6 py-24">
      <div className={cn('grid gap-12 lg:grid-cols-2 lg:gap-16 items-center', flipped && 'lg:[&>*:first-child]:order-2')}>
        <FadeUp>
          {eyebrow && <p className="text-xs font-mono uppercase tracking-[0.15em] text-primary">{eyebrow}</p>}
          <h2 className="mt-3 text-3xl sm:text-4xl font-semibold tracking-tight text-foreground">{title}</h2>
          <p className="mt-4 text-muted-foreground leading-relaxed">{body}</p>
          <ul className="mt-8 space-y-3">
            {bullets.map((b) => (
              <li key={b} className="flex gap-3 text-sm text-muted-foreground">
                <span className="mt-0.5 inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border border-border bg-accent">
                  <Check className="h-2.5 w-2.5 text-muted-foreground" strokeWidth={2.5} />
                </span>
                {b}
              </li>
            ))}
          </ul>
        </FadeUp>

        <FadeUp delay={0.1}>{visual}</FadeUp>
      </div>
    </section>
  )
}

export function PortfolioMock() {
  const { teamNumber, teamName, budgetItems } = PORTFOLIO_MOCK
  return (
    <div className="relative rounded-2xl border border-border bg-background/80 p-3 shadow-xl shadow-foreground/5 backdrop-blur">
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <WindowDots />
        <span className="ml-3 font-mono text-xs text-muted-foreground">ftcmatchmaker.app/portfolio</span>
      </div>
      <div className="rounded-lg border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-muted-foreground">Team {teamNumber}</div>
            <div className="text-sm font-medium text-foreground">{teamName}</div>
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-2 py-0.5 text-xs font-medium text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            Verified
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {['Story', 'Budget', 'Achievements'].map((s) => (
            <div key={s} className="rounded-md border border-border bg-accent/40 p-3">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">{s}</div>
              <div className="mt-2 h-1 rounded-full bg-border overflow-hidden">
                <div className="h-full w-3/4 bg-primary" />
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-2 pt-2">
          {budgetItems.map((r) => (
            <div key={r.label} className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-xs">
              <span className="text-muted-foreground">{r.label}</span>
              <span className="font-mono text-foreground tabular-nums">{r.funded} / {r.goal}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function ModerationMock() {
  const { team, submissionRef, subject, steps } = DISPATCH_REVIEW
  return (
    <div className="relative rounded-2xl border border-border bg-background/80 p-3 shadow-xl shadow-foreground/5 backdrop-blur">
      <div className="flex items-center justify-between px-2 py-1.5">
        <WindowDots />
        <span className="font-mono text-xs text-muted-foreground">ftcmatchmaker.app/admin/review</span>
      </div>
      <div className="rounded-lg border border-border bg-card">
        {/* submission header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">Submission #{submissionRef}</span>
              <span className="rounded-md border border-border bg-accent px-1.5 py-0.5 text-xs font-mono text-muted-foreground">
                {team.name} · {team.number}
              </span>
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">{subject}</div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/5 px-2 py-0.5 text-xs font-medium text-status-warning">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            In review
          </span>
        </div>
        {/* review lifecycle timeline */}
        <ol className="px-4 py-4">
          {steps.map((s, i) => (
            <li key={s.label} className="relative flex items-start gap-3 pb-4 last:pb-0">
              {i < steps.length - 1 && (
                <span aria-hidden className="absolute left-[7px] top-4 bottom-0 w-px bg-border" />
              )}
              <TimelineDot state={s.state} />
              <div className="flex flex-1 items-center justify-between">
                <span className={cn('text-xs', s.state === 'todo' ? 'text-muted-foreground' : 'text-foreground')}>
                  {s.label}
                </span>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">{s.meta}</span>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

function TimelineDot({ state }: { state: 'done' | 'active' | 'todo' }) {
  if (state === 'done') {
    return (
      <span className="relative z-10 mt-0.5 inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10">
        <Check className="h-2.5 w-2.5 text-primary" strokeWidth={3} />
      </span>
    )
  }
  if (state === 'active') {
    return (
      <span className="relative z-10 mt-0.5 inline-flex h-4 w-4 flex-shrink-0 items-center justify-center">
        <span className="absolute inline-flex h-3 w-3 animate-ping rounded-full bg-primary/40" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-primary/20" />
      </span>
    )
  }
  return (
    <span className="relative z-10 mt-0.5 inline-flex h-4 w-4 flex-shrink-0 items-center justify-center">
      <span className="h-2.5 w-2.5 rounded-full border border-border bg-background" />
    </span>
  )
}
