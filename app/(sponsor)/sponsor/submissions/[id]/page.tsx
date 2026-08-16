import { getAuthedProfile, requireSponsorRole } from '@/lib/actions-utils'
import { notFound, redirect } from 'next/navigation'
import { SponsorReviewShell } from '@/components/sponsor/review-shell'
import { AgreementStatusRow } from '@/components/agreements/agreement-status-row'
import { isAwaitingSponsor } from '@/lib/submission-status'
import type { ThreadMessage } from '@/components/messages/thread'
import { SPONSOR_SUBMISSION_SELECT } from '@/lib/sponsor-visibility'

export default async function SponsorSubmissionReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const authed = await getAuthedProfile()
  if (!authed) redirect('/login')
  const { supabase } = authed

  /**
   * Resolve the caller's companies through requireSponsorRole, not through
   * `profiles.sponsor_id`.
   *
   * Since 0082 a sponsor teammate belongs to a company via `sponsor_members`, and
   * `profiles.sponsor_id` is only stamped for the original account holder — it is null for
   * anyone invited through a Clerk Organization. Gating on that column redirected every
   * invited viewer, submitter, and approver to /dashboard, so multi-user sponsor accounts
   * could not open a pitch at all. `sponsorIds` is the same set `current_sponsor_ids()`
   * uses in RLS, which is what decides the read below.
   */
  let sponsorIds: string[]
  let memberRole: Awaited<ReturnType<typeof requireSponsorRole>>['memberRole']
  try {
    ;({ sponsorIds, memberRole } = await requireSponsorRole('viewer'))
  } catch {
    redirect('/dashboard')
  }

  // Fetch detailed submission data including the team's full profile
  const { data: submission } = await supabase
    .from('submissions')
    .select(`
      ${SPONSOR_SUBMISSION_SELECT},
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

  if (!submission || !sponsorIds.includes(submission.sponsor_id as string)) {
    notFound()
  }

  const { data: pendingProposal } = await supabase
    .from('sponsor_decision_proposals')
    .select('id, amount_cents, status')
    .eq('submission_id', id)
    .eq('status', 'pending')
    .maybeSingle()

  const threshold = (submission.sponsors as { approval_required_above_cents?: number | null } | null)?.approval_required_above_cents ?? null

  // Through the RLS-respecting server client, deliberately NOT the admin client: the
  // sm_select_sponsor policy already hides pending coach drafts and every other sponsor's
  // thread, so there is nothing to re-filter here and nothing to get wrong.
  const { data: threadRows } = await supabase
    .from('submission_messages')
    .select('id, author_role, author_label, body, status, created_at')
    .eq('submission_id', id)
    .order('created_at', { ascending: true })

  const threadCanCompose =
    isAwaitingSponsor(submission.status as string) &&
    (!submission.expires_at || new Date(submission.expires_at as string) > new Date())

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
        threadMessages={(threadRows ?? []) as ThreadMessage[]}
        threadCanCompose={threadCanCompose}
      />
    </div>
  )
}
