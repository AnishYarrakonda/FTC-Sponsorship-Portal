import { getAuthedProfile } from '@/lib/actions-utils'
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { CoachSidebar } from '@/components/coach/coach-sidebar'
import { CommandPaletteProvider } from '@/components/command-palette-provider'

export default async function CoachLayout({ children }: { children: React.ReactNode }) {
  const authed = await getAuthedProfile()
  if (!authed) {
    // Clerk session without a profiles row = orphaned signup → recovery page
    // (redirecting to /login would loop: middleware bounces authed users back).
    const { userId } = await auth()
    redirect(userId ? '/complete-profile' : '/login')
  }
  const { supabase, user } = authed

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, coach_verified')
    .eq('id', user.id)
    .single()

  // Fail CLOSED. Every guard below used optional chaining with no `else`, so a null
  // profile — a failed query, a Supabase blip, a deleted row — fell straight through
  // and rendered the coach shell to whoever asked. (admin) and (sponsor) both fail
  // closed; the permissive one was guarding the largest surface.
  if (profileError || !profile) {
    console.error('[coach-layout] could not resolve profile; denying access', profileError)
    redirect('/complete-profile')
  }

  if (profile.role === 'admin') redirect('/admin?redirected=coach')
  if (profile.role === 'sponsor') redirect('/sponsor/dashboard?redirected=coach')
  if (profile.role !== 'coach') redirect('/complete-profile')
  if (!profile.coach_verified) redirect('/awaiting-verification')

  const userName = user.full_name ?? user.email ?? 'Coach'
  const userEmail = user.email ?? ''

  return (
    <div className="flex h-screen flex-col overflow-hidden text-foreground lg:flex-row">
      <Suspense fallback={<div className="hidden w-56 shrink-0 border-r border-border bg-card lg:block" />}>
        <CoachSidebar userName={userName} userEmail={userEmail} />
      </Suspense>
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1100px] px-4 py-6 sm:px-8 sm:py-8 lg:px-12">
          {children}
        </div>
      </main>
      <CommandPaletteProvider />
    </div>
  )
}
