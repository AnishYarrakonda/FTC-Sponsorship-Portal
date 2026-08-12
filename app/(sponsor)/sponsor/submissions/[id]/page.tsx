import { getAuthedProfile } from '@/lib/actions-utils'
import { notFound, redirect } from 'next/navigation'
import { SponsorReviewShell } from '@/components/sponsor/review-shell'
import { AgreementStatusRow } from '@/components/agreements/agreement-status-row'

export default async function SponsorSubmissionReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const authed = await getAuthedProfile()
  if (!authed) redirect('/login')
  const { supabase, user } = authed

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, sponsor_id')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'sponsor' || !profile.sponsor_id) {
    redirect('/dashboard')
  }

  // Fetch detailed submission data including the team's full profile
  const { data: submission } = await supabase
    .from('submissions')
    .select(`
      *,
      sponsors:sponsor_id (
        company_name
      ),
      teams (
        *,
        owner_id,
        team_achievements (*)
      )
    `)
    .eq('id', id)
    .single()

  if (!submission || submission.sponsor_id !== profile.sponsor_id) {
    notFound()
  }

  return (
    <div className="space-y-4">
      <div className="container mx-auto max-w-4xl pt-6">
        {await AgreementStatusRow({ supabase, submissionId: id, viewerRole: 'sponsor' })}
      </div>
      <SponsorReviewShell
        submission={submission}
        team={submission.teams}
      />
    </div>
  )
}
