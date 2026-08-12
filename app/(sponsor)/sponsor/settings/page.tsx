import { getAuthedProfile, requireSponsorRole } from '@/lib/actions-utils'
import { redirect } from 'next/navigation'
import { AccountSettings } from '@/components/account/account-settings'
import { ApprovalPolicyCard } from '@/components/sponsor/approval-policy-card'


export default async function SponsorSettingsPage() {
  const authed = await getAuthedProfile()
  if (!authed) redirect('/login')
  const { supabase, user } = authed

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  let approvalPolicy: { approvalRequiredAboveCents: number | null; eligibleApproverCount: number } | null = null
  try {
    const auth = await requireSponsorRole('org_admin')
    const { data: sponsor } = await auth.adminClient
      .from('sponsors')
      .select('approval_required_above_cents')
      .eq('id', auth.sponsorId)
      .single()
    const { count } = await auth.adminClient
      .from('sponsor_members')
      .select('id', { count: 'exact', head: true })
      .eq('sponsor_id', auth.sponsorId)
      .in('role', ['approver', 'org_admin'])
    approvalPolicy = {
      approvalRequiredAboveCents: sponsor?.approval_required_above_cents ?? null,
      eligibleApproverCount: count ?? 0,
    }
  } catch {
    // Not an org_admin (or not a sponsor at all) — the card simply does not render.
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your account and company profile.</p>
      </div>

      <AccountSettings
        currentName={profile?.full_name ?? ''}
        email={profile?.email ?? ''}
        role={profile?.role ?? 'sponsor'}
      />

      {approvalPolicy && (
        <ApprovalPolicyCard
          approvalRequiredAboveCents={approvalPolicy.approvalRequiredAboveCents}
          eligibleApproverCount={approvalPolicy.eligibleApproverCount}
        />
      )}

    </div>
  )
}
