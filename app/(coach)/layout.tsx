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

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, coach_verified')
    .eq('id', user.id)
    .single()

  if (profile?.role === 'admin') redirect('/admin?redirected=coach')
  if (profile?.role === 'sponsor') redirect('/sponsor/dashboard?redirected=coach')
  if (profile?.role === 'coach' && !profile.coach_verified) redirect('/awaiting-verification')

  const userName = user.full_name ?? user.email ?? 'Coach'
  const userEmail = user.email ?? ''

  return (
    <div className="flex h-screen overflow-hidden text-foreground">
      <Suspense fallback={<div className="w-56 shrink-0 border-r border-border bg-card" />}>
        <CoachSidebar userName={userName} userEmail={userEmail} />
      </Suspense>
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1100px] px-6 py-8 sm:px-10 lg:px-12">
          {children}
        </div>
      </main>
      <CommandPaletteProvider />
    </div>
  )
}
