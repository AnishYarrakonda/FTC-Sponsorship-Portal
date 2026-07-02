import { getAuthedProfile } from '@/lib/actions-utils'
import { redirect } from 'next/navigation'
import { SponsorSidebar } from '@/components/sponsor/sponsor-sidebar'

export default async function SponsorLayout({ children }: { children: React.ReactNode }) {
  const authed = await getAuthedProfile()
  if (!authed) redirect('/login')
  const { supabase, user } = authed

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profile } = await supabase
    .from('profiles')
    .select('*, sponsors(*)')
    .eq('id', user.id)
    .single()

  if (profile?.role === 'admin') redirect('/admin')
  if (profile?.role === 'coach') redirect('/dashboard')
  if (profile?.role !== 'sponsor') redirect('/login')

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

  // Count pending submissions for the sidebar badge
  const { count: pendingCount } = await supabase
    .from('submissions')
    .select('id', { count: 'exact', head: true })
    .eq('sponsor_id', profile.sponsor_id)
    .eq('status', 'pending')

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
