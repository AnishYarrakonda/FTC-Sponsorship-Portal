import { cn } from '@/lib/utils'
import React from 'react'

export function AccentSection({ children, className }: { children: React.ReactNode, className?: string }) {
  return (
    <section className={cn("bg-primary text-primary-foreground py-20 md:py-32", className)}>
      <div className="mx-auto max-w-[1440px] px-6 lg:px-10">
        {children}
      </div>
    </section>
  )
}

export function CharcoalCard({ children, className }: { children: React.ReactNode, className?: string }) {
  return (
    <div className={cn("rounded-2xl bg-charcoal text-charcoal-foreground p-8 md:p-12 shadow-xl", className)}>
      {children}
    </div>
  )
}
