import { getAuthedProfile } from '@/lib/actions-utils'
import { createAdminClient } from '@/lib/supabase/admin'
import { deriveTeamSlug, uniquifyTeamSlug } from '@/lib/team-slug'
import type { Database } from '@/lib/supabase/types'
import { redirect } from 'next/navigation'

type TeamStatus = Database['public']['Enums']['team_status']
type TaxStatus = Database['public']['Enums']['tax_status_type']
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
      // NOTE: no `sponsors:sponsor_id(company_name)` embed. A PostgREST embed resolves
      // against the BASE TABLE, and 0063 makes `sponsors_select` admin-only to close
      // P0-4 — so for a coach the embed silently returns null and every sponsor name on
      // this page renders blank. Names are resolved below from v_sponsors_public, which
      // is SECURITY DEFINER and includes any sponsor this coach has already pitched.
      .select('id, status, admin_feedback, updated_at, created_at, team_id, sponsor_id, teams:team_id(team_name)')
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
          // filled in from v_sponsors_public after both queries resolve
          company_name: undefined as string | undefined,
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

  // Resolve sponsor company names for this coach's own submissions. Kept out of the
  // query above because the embed cannot see them post-0063 (see the note there).
  // A second read of the view without the status filter, so a pitch to a sponsor that
  // has since gone inactive or filled its cap still shows a name rather than a blank.
  {
    const missingIds = Array.from(
      new Set((submissions ?? []).map((s: any) => s.sponsor_id).filter(Boolean))
    ) as string[]

    if (missingIds.length > 0) {
      const { data: names } = await supabase
        .from('v_sponsors_public')
        .select('id, company_name')
        .in('id', missingIds)

      const byId = new Map((names ?? []).map((r: any) => [r.id, r.company_name]))
      for (const s of submissions as any[]) {
        s.company_name = byId.get(s.sponsor_id) ?? undefined
      }
    }
  }

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
    // Both enum columns are narrowed here rather than cast away at the insert:
    // pending_team_data is untyped jsonb, and the `as any` that used to paper over that
    // is exactly what hid the missing NOT NULL `slug` below (P0-14).
    const ftcTeamNumber = payloadData.ftcTeamNumber ?? null
    const status: TeamStatus =
      payloadData.status === 'existing' && ftcTeamNumber ? 'existing' : 'incubator'
    const rawTaxStatus = payloadData.taxStatus || 'None'
    const taxStatus: TaxStatus =
      rawTaxStatus === '501c3' || rawTaxStatus === 'School' ? rawTaxStatus : 'None'

    const rawBudgetItems = (payloadData.budgetItems as Array<any> | undefined) || []
    const normalizedBudgetItems = rawBudgetItems.map((item) => ({
      label: item.label?.trim() || '',
      qty: item.qty || 1,
      unit_cost_cents: item.unitCostCents || 0,
      total_cents: item.totalCents || 0,
    }))
    const totalAsk = normalizedBudgetItems.reduce((sum, item) => sum + item.total_cents, 0)

    const adminClient = createAdminClient()

    // P0-14: teams.slug is NOT NULL UNIQUE with no DB default (0046:5,20). Both inserts
    // below omitted it and were cast `as any`, so tsc never saw the missing field and
    // both failed 23502 at runtime — stranding every re-verified coach on the
    // "Setting up your workspace…" spinner below, forever.
    const teamName = (payloadData.teamName || profile.full_name || 'My Team').trim()
    const baseSlug = deriveTeamSlug(teamName, ftcTeamNumber)

    const teamPayload = {
      owner_id: user.id,
      status: status,
      ftc_team_number: ftcTeamNumber,
      team_name: teamName,
      slug: baseSlug,
      organization: payloadData.organization?.trim() || null,
      city: payloadData.city?.trim() || '',
      state: payloadData.state?.trim() || '',
      mission_statement: payloadData.missionStatement?.trim() || 'Mission pending.',
      tax_status: taxStatus,
      budget_items: normalizedBudgetItems,
      financial_ask_cents: totalAsk,
      technical_summary: payloadData.technicalSummary?.trim() || null,
      outreach_summary: payloadData.outreachSummary?.trim() || null,
    }

    let { data: newTeam, error: createError } = await adminClient
      .from('teams')
      .insert(teamPayload)
      .select('*')
      .single()

    // Two teams can share a name, so a slug collision is expected, not exceptional.
    if (createError?.code === '23505') {
      ;({ data: newTeam, error: createError } = await adminClient
        .from('teams')
        .insert({ ...teamPayload, slug: uniquifyTeamSlug(baseSlug) })
        .select('*')
        .single())
    }

    if (!createError && newTeam) {
      await adminClient.from('profiles').update({ pending_team_data: null }).eq('id', user.id)
      redirect('/dashboard')
    } else {
      console.error('[Dashboard] Auto-provisioning critical failure:', createError)

      // ABSOLUTE FALLBACK: If even the "smart" insert fails, create a barebones incubator record
      // to ensure the user is NEVER stuck on the loading screen.
      const fallbackName = (profile.full_name || 'My Team').trim()
      const fallbackSlug = deriveTeamSlug(fallbackName)
      const fallbackPayload = {
        owner_id: user.id,
        status: 'incubator' as TeamStatus,
        team_name: fallbackName,
        slug: fallbackSlug,
        tax_status: 'None' as TaxStatus,
      }

      let { data: fallbackTeam, error: fallbackError } = await adminClient
        .from('teams')
        .insert(fallbackPayload)
        .select('*')
        .single()

      if (fallbackError?.code === '23505') {
        ;({ data: fallbackTeam, error: fallbackError } = await adminClient
          .from('teams')
          .insert({ ...fallbackPayload, slug: uniquifyTeamSlug(fallbackSlug) })
          .select('*')
          .single())
      }

      if (fallbackTeam) {
        redirect('/dashboard')
      }

      // Both inserts failed. Previously this fell through in silence to the spinner
      // below with no log line at all beyond the first console.error.
      console.error('[Dashboard] Fallback team provisioning ALSO failed:', fallbackError)
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
