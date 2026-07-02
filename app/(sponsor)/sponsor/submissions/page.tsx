import { getAuthedProfile } from '@/lib/actions-utils'
import { redirect } from 'next/navigation'
import { SponsorSubmissionsList } from '@/components/sponsor/submissions-list'

export default async function SponsorSubmissionsPage() {
  const authed = await getAuthedProfile()
  if (!authed) redirect('/login')
  const { supabase, user } = authed

  const { data: profile } = await supabase
    .from('profiles')
    .select('sponsor_id')
    .eq('id', user.id)
    .single()

  if (!profile?.sponsor_id) redirect('/dashboard')

  const { data: submissions } = await supabase
    .from('submissions')
    .select('*, teams(team_name, ftc_team_number, city, state)')
    .eq('sponsor_id', profile.sponsor_id)
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
