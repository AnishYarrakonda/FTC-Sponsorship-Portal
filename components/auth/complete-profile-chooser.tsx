'use client'

import { useState } from 'react'
import { CompleteProfileForm } from '@/components/auth/complete-profile-form'
import { CompleteSponsorApplicationForm } from '@/components/auth/complete-sponsor-application-form'
import { GraduationCap, Building2 } from 'lucide-react'
import { cn } from '@/lib/utils'

type Role = 'coach' | 'sponsor'

const ROLE_OPTIONS: { value: Role; title: string; sub: string; icon: typeof GraduationCap }[] = [
  { value: 'coach', title: "I'm an FTC coach", sub: 'I lead a team and want to raise sponsorships.', icon: GraduationCap },
  { value: 'sponsor', title: "I'm a sponsor representative", sub: 'My company wants to fund FTC teams.', icon: Building2 },
]

/**
 * Dual-role orphan recovery: an authenticated Clerk user with no `profiles`
 * row picks how they signed up, then completes the matching form. Coaches get
 * the full coach recovery form; sponsors get the company + sponsorship
 * application form (their step-1 account already exists in Clerk).
 */
export function CompleteProfileChooser({ email, defaultName }: { email: string; defaultName: string }) {
  const [role, setRole] = useState<Role>('coach')

  return (
    <section className="fixed inset-0 overflow-y-auto bg-background text-foreground">
      <div className="min-h-screen w-full flex flex-col items-center px-4 py-16">
        <div className="w-full max-w-2xl space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-semibold text-foreground">Finish setting up your account</h1>
            <p className="text-sm text-muted-foreground">
              Your sign-in for <span className="font-medium text-foreground">{email}</span> is ready, but your
              profile was never completed. Choose how you use the portal to pick up where you left off.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" role="radiogroup" aria-label="Account type">
            {ROLE_OPTIONS.map(({ value, title, sub, icon: Icon }) => {
              const selected = role === value
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setRole(value)}
                  className={cn(
                    'flex items-start gap-3 rounded-lg border p-4 text-left transition-colors',
                    selected ? 'border-primary bg-primary/10' : 'border-border bg-card/70 hover:bg-accent'
                  )}
                >
                  <Icon className={cn('h-5 w-5 mt-0.5 shrink-0', selected ? 'text-primary' : 'text-muted-foreground')} />
                  <span className="space-y-0.5">
                    <span className="block text-sm font-semibold text-foreground">{title}</span>
                    <span className="block text-xs text-muted-foreground">{sub}</span>
                  </span>
                </button>
              )
            })}
          </div>

          {role === 'coach' ? (
            <CompleteProfileForm email={email} defaultName={defaultName} />
          ) : (
            <CompleteSponsorApplicationForm email={email} defaultName={defaultName} />
          )}
        </div>
      </div>
    </section>
  )
}
