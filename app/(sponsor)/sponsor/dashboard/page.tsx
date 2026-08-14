import { getAuthedProfile } from '@/lib/actions-utils'
import { redirect } from 'next/navigation'
import { SponsorDashboardShell } from '@/components/sponsor/dashboard-shell'
import { RoleRedirectBanner } from '@/components/auth/role-redirect-banner'
import { SPONSOR_SUBMISSION_SELECT } from '@/lib/sponsor-visibility'

export default async function SponsorDashboardPage() {
  const authed = await getAuthedProfile()
  if (!authed) redirect('/login')
  const { supabase, user } = authed

  const { data: profile } = await supabase
    .from('profiles')
    .select('*, sponsors(*)')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'sponsor' || !profile.sponsor_id) {
    redirect('/dashboard')
  }

  // Fetch submissions for this sponsor
  const { data: submissions } = await supabase
    .from('submissions')
    .select(`${SPONSOR_SUBMISSION_SELECT}, teams(team_name, ftc_team_number, city, state, organization)`)
    .eq('sponsor_id', profile.sponsor_id)
    .order('created_at', { ascending: false })

  // Fetch notifications
  const { data: notifications } = await supabase
    .from('notifications')
    .select('*')
    .eq('recipient_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20)

  // Extract sponsor from the nested join — cast to any to satisfy TS since Supabase
  // infers a complex union type for nested selects that doesn't match our local type.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sponsor = (profile as any)?.sponsors ?? null

  return (
    <><RoleRedirectBanner />
    <SponsorDashboardShell
      sponsor={sponsor}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      submissions={(submissions || []) as any[]}
      notifications={notifications || []}
    /></>
  )
}
