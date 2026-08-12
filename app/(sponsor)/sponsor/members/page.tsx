import { redirect } from 'next/navigation'
import { listSponsorMembers } from '@/app/actions/sponsor-members'
import { MembersPanel } from '@/components/sponsor/members-panel'

export default async function SponsorMembersPage() {
  const result = await listSponsorMembers()

  if ('error' in result) {
    if (result.error === 'Unauthorized' || result.error === 'Forbidden') redirect('/login')
    return <p className="text-sm text-destructive">{result.error}</p>
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Team</h1>
        <p className="text-muted-foreground mt-1">Everyone with access to your company&apos;s sponsor portal.</p>
      </div>

      <MembersPanel members={result.members} membership={result.membership} />
    </div>
  )
}
