import { getAuthedProfile, requireSponsorRole } from '@/lib/actions-utils'
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
        company_name,
        approval_required_above_cents
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

  let memberRole: Awaited<ReturnType<typeof requireSponsorRole>>['memberRole'] = 'org_admin'
  try {
    memberRole = (await requireSponsorRole('viewer')).memberRole
  } catch {
    // Falls back to the least-privileged read since the console below still gates on
    // memberRole; this only happens for a non-sponsor caller, which notFound()'d above.
  }

  const { data: pendingProposal } = await supabase
    .from('sponsor_decision_proposals')
    .select('id, amount_cents, status')
    .eq('submission_id', id)
    .eq('status', 'pending')
    .maybeSingle()

  const threshold = (submission.sponsors as { approval_required_above_cents?: number | null } | null)?.approval_required_above_cents ?? null

  return (
    <div className="space-y-4">
      <div className="container mx-auto max-w-4xl pt-6">
        {await AgreementStatusRow({ supabase, submissionId: id, viewerRole: 'sponsor' })}
      </div>
      <SponsorReviewShell
        submission={submission}
        team={submission.teams}
        memberRole={memberRole}
        approvalThresholdCents={threshold}
        pendingProposal={pendingProposal ?? null}
      />
    </div>
  )
}
