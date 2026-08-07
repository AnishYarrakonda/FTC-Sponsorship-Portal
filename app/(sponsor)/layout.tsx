import { getAuthedProfile } from '@/lib/actions-utils'
import { AWAITING_SPONSOR_STATUSES } from '@/lib/submission-status'
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { SponsorSidebar } from '@/components/sponsor/sponsor-sidebar'

export default async function SponsorLayout({ children }: { children: React.ReactNode }) {
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
    .select('*, sponsors(*)')
    .eq('id', user.id)
    .single()

  if (profile?.role === 'admin') redirect('/admin?redirected=sponsor')
  if (profile?.role === 'coach') redirect('/dashboard?redirected=sponsor')
  if (profile?.role !== 'sponsor') redirect('/complete-profile')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sponsor = (profile as any)?.sponsors ?? null

  if (!profile.sponsor_id) {
    return (
      <div className="flex h-screen items-center justify-center bg-background px-4">
        <div className="max-w-md rounded-xl border border-border bg-card p-8 text-center space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Awaiting verification</h1>
          <p className="text-sm text-muted-foreground">
            Thanks for applying. An administrator is reviewing your sponsor application — most are approved within
            24 hours. You will receive an email when your account is activated.
          </p>
          <p className="text-xs text-muted-foreground">
            Need to update your application?{' '}
            <a className="underline" href="mailto:support@exodiusftc.com">
              Contact support
            </a>
            .
          </p>
        </div>
      </div>
    )
  }

  // Sidebar badge: pitches awaiting THIS SPONSOR's decision.
  // This filtered on status='pending', which means "awaiting the ADMIN" and is a state a
  // sponsor-visible pitch never has — so the badge read 0 while real pitches waited.
  const { count: pendingCount } = await supabase
    .from('submissions')
    .select('id', { count: 'exact', head: true })
    .eq('sponsor_id', profile.sponsor_id)
    .in('status', [...AWAITING_SPONSOR_STATUSES])
    .is('deleted_at', null)

  const companyName = sponsor?.company_name ?? 'Your Company'
  const userName = user.full_name ?? user.email ?? 'Sponsor'
  const userEmail = user.email ?? ''

  return (
    <div className="flex h-screen flex-col overflow-hidden text-foreground lg:flex-row">
      <SponsorSidebar
        companyName={companyName}
        userName={userName}
        userEmail={userEmail}
        pendingCount={pendingCount ?? 0}
      />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1000px] px-4 py-6 sm:px-8 sm:py-8 lg:px-12">
          {children}
        </div>
      </main>
    </div>
  )
}
