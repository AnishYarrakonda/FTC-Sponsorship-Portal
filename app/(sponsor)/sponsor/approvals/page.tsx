import { redirect } from 'next/navigation'
import { requireSponsorRole } from '@/lib/actions-utils'
import { listFundingProposals } from '@/app/actions/sponsor-approvals'
import { ApprovalsPanel } from '@/components/sponsor/approvals-panel'
import { hasSponsorRole } from '@/lib/sponsor-roles'

export default async function SponsorApprovalsPage() {
  let auth: Awaited<ReturnType<typeof requireSponsorRole>>
  try {
    auth = await requireSponsorRole('viewer')
  } catch {
    redirect('/login')
  }

  const [result, { data: sponsor }] = await Promise.all([
    listFundingProposals(),
    auth.adminClient.from('sponsors').select('approval_required_above_cents').eq('id', auth.sponsorId).single(),
  ])

  if ('error' in result) {
    return <p className="text-sm text-destructive-text">{result.error}</p>
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Approvals</h1>
        <p className="text-muted-foreground mt-1">
          Funding requests waiting on a second person to confirm before the money commits.
        </p>
      </div>

      <ApprovalsPanel
        proposals={result.proposals}
        memberRole={auth.memberRole}
        currentProfileId={auth.user.id}
        canAct={hasSponsorRole(auth.memberRole, 'approver')}
        approvalsEnabled={sponsor?.approval_required_above_cents !== null && sponsor?.approval_required_above_cents !== undefined}
        isOrgAdmin={auth.memberRole === 'org_admin'}
      />
    </div>
  )
}
