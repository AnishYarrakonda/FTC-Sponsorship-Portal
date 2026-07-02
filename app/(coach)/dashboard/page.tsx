import { getAuthedProfile } from '@/lib/actions-utils'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { DashboardShell } from '@/components/coach/dashboard-shell'
import { RoleRedirectBanner } from '@/components/auth/role-redirect-banner'
import Link from 'next/link'

export default async function DashboardPage() {
  const authed = await getAuthedProfile()

  if (!authed) return null
  const { supabase, user } = authed

  // 1. Initial Data Fetch
  const [
    { data: initialTeam },
    { data: profile },
    { data: sponsors },
    { count: unreadCount },
    { data: notifications },
    { data: submissions }
  ] = await Promise.all([
    supabase.from('teams').select('*').eq('owner_id', user.id).order('updated_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase.from('v_sponsors_public').select('id, company_name, industry, funding_cap_cents, funding_used_cents, website, logo_url, status').eq('status', 'active'),
    supabase.from('notifications').select('*', { count: 'exact', head: true }).eq('recipient_id', user.id).is('read_at', null),
    supabase.from('notifications').select('*').eq('recipient_id', user.id).order('created_at', { ascending: false }).limit(50),
    supabase
      .from('submissions')
      .select('id, status, admin_feedback, updated_at, created_at, team_id, sponsor_id, teams:team_id(team_name), sponsors:sponsor_id(company_name)')
      .then((res: any) => {
        if (res.error) {
          console.error('[Dashboard] Failed to fetch submissions:', res.error)
          return { data: [] }
        }
        // Normalize the data to match SubmissionSummary type
        // Manual filter because inner join filters don't always work as expected with Supabase relations
        const data = res.data?.filter((s: any) => s.teams !== null).map((s: any) => ({
          id: s.id,
          team_name: s.teams?.team_name,
          owner_id: user.id,
          sponsor_id: s.sponsor_id,
          company_name: s.sponsors?.company_name,
          status: s.status,
          admin_feedback: s.admin_feedback,
          is_locked: !['draft', 'changes_requested', 'declined'].includes(s.status),
          season: (s as any).season || '2025-26',
          requested_amount_cents: (s as any).requested_amount_cents || 0,
          created_at: s.created_at,
          updated_at: s.updated_at,
        }))
        return { data: data || [] }
      }),
  ])

  // 2. Role & Verification Guards
  if (profile?.role === 'admin') {
    redirect('/admin')
  }

  if (profile?.role === 'sponsor') {
    redirect('/sponsor/dashboard')
  }

  if (profile?.role === 'coach' && !profile.coach_verified) {
    redirect('/awaiting-verification')
  }

  const currentTeam = initialTeam

  // 3. Auto-Provisioning Logic
  if (!currentTeam && profile?.coach_verified) {
    const payloadData = (profile as any).pending_team_data || {}
    
    // Constraint Safeguard: Existing teams MUST have a team number.
    // If missing, we force status to 'incubator' to satisfy the DB constraint.
    const ftcTeamNumber = payloadData.ftcTeamNumber ?? null
    const status = (payloadData.status === 'existing' && !ftcTeamNumber) ? 'incubator' : (payloadData.status || 'incubator')

    const rawBudgetItems = (payloadData.budgetItems as Array<any> | undefined) || []
    const normalizedBudgetItems = rawBudgetItems.map((item) => ({
      label: item.label?.trim() || '',
      qty: item.qty || 1,
      unit_cost_cents: item.unitCostCents || 0,
      total_cents: item.totalCents || 0,
    }))
    const totalAsk = normalizedBudgetItems.reduce((sum, item) => sum + item.total_cents, 0)

    const adminClient = createAdminClient()
    const { data: newTeam, error: createError } = await adminClient
      .from('teams')
      .insert({
        owner_id: user.id,
        status: status,
        ftc_team_number: ftcTeamNumber,
        team_name: (payloadData.teamName || profile.full_name || 'My Team').trim(),
        organization: payloadData.organization?.trim() || null,
        city: payloadData.city?.trim() || '',
        state: payloadData.state?.trim() || '',
        mission_statement: payloadData.missionStatement?.trim() || 'Mission pending.',
        tax_status: payloadData.taxStatus || 'None',
        budget_items: normalizedBudgetItems,
        financial_ask_cents: totalAsk,
        technical_summary: payloadData.technicalSummary?.trim() || null,
        outreach_summary: payloadData.outreachSummary?.trim() || null,
      } as any)
      .select('*')
      .single()

    if (!createError && newTeam) {
      await adminClient.from('profiles').update({ pending_team_data: null }).eq('id', user.id)
      redirect('/dashboard')
    } else {
      console.error('[Dashboard] Auto-provisioning critical failure:', createError)
      
      // ABSOLUTE FALLBACK: If even the "smart" insert fails, create a barebones incubator record
      // to ensure the user is NEVER stuck on the loading screen.
      const { data: fallbackTeam } = await adminClient
        .from('teams')
        .insert({
          owner_id: user.id,
          status: 'incubator',
          team_name: (profile.full_name || 'My Team').trim(),
          tax_status: 'None',
        } as any)
        .select('*')
        .single()

      if (fallbackTeam) {
        redirect('/dashboard')
      }
    }
  }

  // 4. Final Safety Check
  if (!currentTeam) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-6 px-6 text-center">
        <div className="flex flex-col items-center gap-2">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-lg font-medium">Setting up your workspace...</p>
        </div>
        
        <div className="max-w-md space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm">
          <p className="text-sm text-muted-foreground leading-relaxed">
            We&apos;re finalizing your team portfolio. This usually takes less than 10 seconds.
          </p>
          <div className="flex flex-col gap-2">
            <Link 
              href="/dashboard"
              className="flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
            >
              Try Again
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // 5. Success: Render Dashboard
  const { data: achievements } = await supabase
    .from('team_achievements')
    .select('*')
    .eq('team_id', currentTeam.id)
    .order('season', { ascending: false })

  return (
    <><RoleRedirectBanner />
    <DashboardShell
      team={currentTeam as any}
      profile={profile as any}
      sponsors={sponsors as any ?? []}
      notifications={notifications as any ?? []}
      unreadCount={unreadCount ?? 0}
      submissions={submissions as any ?? []}
      achievements={(achievements || []) as any}
    /></>
  )
}
