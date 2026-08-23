import { getAuthedProfile, requireSponsorRole } from '@/lib/actions-utils'
import { redirect } from 'next/navigation'
import { AccountSettings } from '@/components/account/account-settings'
import { ApprovalPolicyCard } from '@/components/sponsor/approval-policy-card'
import { FiscalYearCard } from '@/components/sponsor/fiscal-year-card'
import { SsoStatusCard } from '@/components/sponsor/sso-status-card'
import { getSponsorSsoStatus, type SponsorSsoStatus } from '@/lib/sso'


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
  // SSO is read-only and org-wide, so it is shown to org admins alongside the approval
  // policy — both describe how the whole organization behaves, not this one account.
  let ssoStatus: SponsorSsoStatus | null = null
  // A-12-04. Null until we know the caller is an org admin.
  let fiscalYearStartMonth: number | null = null
  try {
    const auth = await requireSponsorRole('org_admin')
    const { data: sponsor } = await auth.adminClient
      .from('sponsors')
      .select('approval_required_above_cents, clerk_org_id, fiscal_year_start_month')
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
    // A-12-04
    fiscalYearStartMonth = sponsor?.fiscal_year_start_month ?? 1
    ssoStatus = await getSponsorSsoStatus(sponsor?.clerk_org_id ?? null)
  } catch {
    // Not an org_admin (or not a sponsor at all) — the cards simply do not render.
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

      {/* A-12-04. Org-wide, like the approval policy beside it. */}
      {fiscalYearStartMonth !== null && (
        <FiscalYearCard fiscalYearStartMonth={fiscalYearStartMonth} />
      )}

      {ssoStatus && <SsoStatusCard status={ssoStatus} />}

    </div>
  )
}
