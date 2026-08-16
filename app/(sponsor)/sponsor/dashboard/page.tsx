import { requireSponsor } from '@/lib/actions-utils'
import { redirect } from 'next/navigation'
import { SponsorDashboardShell } from '@/components/sponsor/dashboard-shell'
import { RoleRedirectBanner } from '@/components/auth/role-redirect-banner'
import { SPONSOR_SUBMISSION_SELECT } from '@/lib/sponsor-visibility'

export default async function SponsorDashboardPage() {
  /**
   * Resolve the caller's companies with requireSponsor, not `profiles.sponsor_id`.
   *
   * That column is only stamped on the original account holder. A teammate invited through
   * a Clerk Organization (0082) belongs to the company through `sponsor_members` and has it
   * null — so the old guard redirected them to /dashboard, where the coach layout saw
   * role === 'sponsor' and redirected them straight back here. The result was an infinite
   * redirect loop: an invited sponsor could not reach any page in the product.
   */
  let supabase: Awaited<ReturnType<typeof requireSponsor>>['supabase']
  let user: Awaited<ReturnType<typeof requireSponsor>>['user']
  let sponsorId: string
  let sponsorIds: string[]
  try {
    ;({ supabase, user, sponsorId, sponsorIds } = await requireSponsor())
  } catch {
    redirect('/login')
  }

  const { data: sponsor } = await supabase.from('sponsors').select('*').eq('id', sponsorId).single()

  // Fetch submissions for every company this user belongs to
  const { data: submissions } = await supabase
    .from('submissions')
    .select(`${SPONSOR_SUBMISSION_SELECT}, teams(team_name, ftc_team_number, city, state, organization)`)
    .in('sponsor_id', sponsorIds)
    .order('created_at', { ascending: false })

  // Fetch notifications
  const { data: notifications } = await supabase
    .from('notifications')
    .select('*')
    .eq('recipient_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20)

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
