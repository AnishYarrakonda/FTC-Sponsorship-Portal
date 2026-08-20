import { requireSponsor } from '@/lib/actions-utils'
import { redirect } from 'next/navigation'
import { SponsorSubmissionsList } from '@/components/sponsor/submissions-list'
import { SPONSOR_SUBMISSION_SELECT } from '@/lib/sponsor-visibility'

export default async function SponsorSubmissionsPage() {
  /**
   * Company membership comes from requireSponsor (profiles.sponsor_id + sponsor_members),
   * never from `profiles.sponsor_id` alone. That column is null for anyone invited through a
   * Clerk Organization, and the old guard bounced them to /dashboard — which the coach
   * layout bounces straight back here, producing an infinite redirect loop.
   */
  let supabase: Awaited<ReturnType<typeof requireSponsor>>['supabase']
  let sponsorIds: string[]
  try {
    ;({ supabase, sponsorIds } = await requireSponsor())
  } catch {
    redirect('/login')
  }

  const { data: submissions } = await supabase
    .from('submissions')
    .select(`${SPONSOR_SUBMISSION_SELECT}, teams(team_name, ftc_team_number, city, state)`)
    .in('sponsor_id', sponsorIds)
    .order('created_at', { ascending: false })

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Sponsorship Requests</h1>
          <p className="text-muted-foreground mt-1">Review and manage all incoming team pitches.</p>
        </div>
      </div>

      <SponsorSubmissionsList submissions={submissions ?? []} />
    </div>
  )
}
