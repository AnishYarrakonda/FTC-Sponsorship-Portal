import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAuthedProfile } from '@/lib/actions-utils'
import { PayoutProfileForm } from '@/components/coach/payout-profile-form'

export default async function CoachPayoutPage() {
  const authed = await getAuthedProfile()
  if (!authed) redirect('/login')
  const profile = authed.user
  
  if (!profile.coach_verified) {
    redirect('/awaiting-verification')
  }

  const supabase = await createClient()

  // Find the team owned by the coach
  const { data: team } = await (supabase as any)
    .from('teams')
    .select('id')
    .eq('owner_id', profile.id)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .single()

  if (!team) {
    // If no team, they can't set up a payout profile
    return (
      <div className="max-w-3xl mx-auto py-10 px-4">
        <h1 className="text-2xl font-bold mb-4">No Team Found</h1>
        <p className="text-muted-foreground">You must create a team before setting up a payout profile.</p>
      </div>
    )
  }

  const { data: payoutProfile } = await supabase
    .from('team_payout_profiles')
    .select('*')
    .eq('team_id', team.id)
    .single()

  return (
    <div className="max-w-4xl mx-auto py-10 px-4">
      <PayoutProfileForm teamId={team.id} initialData={payoutProfile} />
    </div>
  )
}
