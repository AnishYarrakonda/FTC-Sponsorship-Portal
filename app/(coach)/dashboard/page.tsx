import { getAuthedProfile } from '@/lib/actions-utils'
import { listAppealableSubjects } from '@/app/actions/appeals'
import { createAdminClient } from '@/lib/supabase/admin'
import { deriveTeamSlug, uniquifyTeamSlug } from '@/lib/team-slug'
import { verifyFTCTeamIdentity } from '@/lib/ftc-roster'
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
    { data: submissions },
    { data: fulfillments },
    { data: payoutProfile },
    { data: recognitionRows }
  ] = await Promise.all([
    supabase.from('teams').select('*').eq('owner_id', user.id).order('updated_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase.from('v_sponsors_public').select('id, company_name, industry, funding_cap_cents, funding_used_cents, website, logo_url, status').eq('status', 'active'),
    supabase.from('notifications').select('*', { count: 'exact', head: true }).eq('recipient_id', user.id).is('read_at', null),
    supabase.from('notifications').select('*').eq('recipient_id', user.id).order('created_at', { ascending: false }).limit(50),
    supabase
      .from('submissions')
      // B-03-04: `season` and `requested_amount_cents` used to be missing from this list
      // while lines below read them through an `as any` cast, so both were always
      // undefined and both silently took their fallback. fundedAmount in
      // dashboard-shell sums requested_amount_cents over approved submissions, so the
      // coach's own progress bar read "$0 of $X · 0%" while the sponsor's page, admin
      // analytics and the ledger all said otherwise. Same class as the $NaN budget-item
      // defect in lib/dispatch.ts: a cast hiding a column that was never fetched.
      .select('id, status, admin_feedback, updated_at, created_at, team_id, sponsor_id, season, requested_amount_cents, teams:team_id(team_name)')
      .then((res: any) => {
        if (res.error) {
          console.error('[Dashboard] Failed to fetch submissions:', res.error)
          return { data: [] }
        }
        const data = res.data?.filter((s: any) => s.teams !== null).map((s: any) => ({
          id: s.id,
          team_name: s.teams?.team_name,
          owner_id: user.id,
          sponsor_id: s.sponsor_id,
          company_name: undefined as string | undefined,
          status: s.status,
          admin_feedback: s.admin_feedback,
          is_locked: !['draft', 'changes_requested', 'declined'].includes(s.status),
          season: s.season || '2025-26',
          requested_amount_cents: s.requested_amount_cents ?? 0,
          created_at: s.created_at,
          updated_at: s.updated_at,
        }))
        return { data: data || [] }
      }),
    // B-03-03: the `sponsors(company_name)` embed that used to be here silently resolved
    // to null for every row — sponsors_select is is_admin() and sponsors_select_own is
    // scoped to current_sponsor_ids(), so a coach matches neither. funding-tab then fell
    // back to the literal string 'Sponsor', which is what the coach read at the exact
    // moment they had to match an incoming check to a bank deposit. The identical trap is
    // already documented on the recognition query below; names are resolved from
    // v_sponsors_public in the resolver further down, the same way submissions do it.
    supabase.from('funding_fulfillments').select('*').order('pledged_at', { ascending: false }),
    supabase.from('team_payout_profiles').select('team_id, w9_uploaded_at, w9_verified_at, w9_rejected_at, w9_rejected_reason, w9_expires_at').maybeSingle(),
    // Recognition owed. recognition_awards_select_coach scopes this to teams this coach
    // owns; the deliveries embed rides can_read_recognition_award(). No sponsors embed —
    // sponsors_select is admin-only since 0063 and the embed would silently return null
    // (the same trap documented for submissions above). Names come from
    // v_sponsors_public in the resolver below.
    supabase
      .from('sponsor_recognition_awards')
      .select(
        'id, sponsor_id, amount_cents, awarded_at, tier_name_snapshot, tier_rank_snapshot, ' +
        'recognition_benefit_deliveries(id, benefit_type, status, proof_url, admin_void_reason, delivered_at)'
      )
      .order('awarded_at', { ascending: false }),
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

  // B-03-03: resolve the payer's company name for each fulfillment, from the same
  // v_sponsors_public view the submissions resolver above uses. Unfiltered by status on
  // purpose — a sponsor that has since gone inactive or filled its cap still has to be
  // nameable on a payment the coach is being asked to confirm.
  {
    const sponsorIds = Array.from(
      new Set((fulfillments ?? []).map((f: any) => f.sponsor_id).filter(Boolean))
    ) as string[]

    if (sponsorIds.length > 0) {
      const { data: names } = await supabase
        .from('v_sponsors_public')
        .select('id, company_name')
        .in('id', sponsorIds)

      const byId = new Map((names ?? []).map((r: any) => [r.id, r.company_name]))
      for (const f of fulfillments as any[]) {
        // Shaped as the embed used to be, so funding-tab's `f.sponsors?.company_name`
        // read keeps working and there is one place that knows about the fallback.
        f.sponsors = { company_name: byId.get(f.sponsor_id) ?? null }
      }
    }
  }

  // How many sponsor questions each pitch is carrying, so the list can flag the rows with
  // something to answer. One query for the whole list, counted in JS — a per-row count
  // would be an N+1 on the dashboard's hottest path. sm_select_coach means this read can
  // only ever return this coach's own threads.
  {
    const submissionIds = (submissions ?? []).map((s: any) => s.id).filter(Boolean) as string[]
    if (submissionIds.length > 0) {
      const { data: questions } = await supabase
        .from('submission_messages')
        .select('submission_id')
        .in('submission_id', submissionIds)
        .eq('author_role', 'sponsor')

      const counts = new Map<string, number>()
      for (const q of questions ?? []) {
        counts.set(q.submission_id, (counts.get(q.submission_id) ?? 0) + 1)
      }
      for (const s of submissions as any[]) {
        s.question_count = counts.get(s.id) ?? 0
      }
    }
  }

  // Appeal eligibility for declined pitches. Computed here, from the same
  // listAppealableSubjects resolver the appeals pages use, so "can I appeal this" has one
  // definition rather than three.
  {
    const result = await listAppealableSubjects()
    if (!('error' in result)) {
      const bySubmission = new Map(
        result.subjects
          .filter((s) => s.subjectType === 'submission')
          .map((s) => [s.subjectId, s])
      )
      for (const s of submissions as any[]) {
        const subject = bySubmission.get(s.id)
        s.appealable = !!subject?.windowOpen && !subject?.existingAppeal
        s.appeal_status = subject?.existingAppeal?.status ?? null
      }
    }
  }

  // Sponsor company names for the recognition cards, resolved the same way submissions
  // resolve theirs.
  const recognitionAwards: any[] = []
  {
    const rows = (recognitionRows ?? []) as any[]
    const sponsorIds = Array.from(new Set(rows.map((r) => r.sponsor_id).filter(Boolean))) as string[]
    const byId = new Map<string, string>()
    if (sponsorIds.length > 0) {
      const { data: names } = await supabase
        .from('v_sponsors_public')
        .select('id, company_name')
        .in('id', sponsorIds)
      for (const n of names ?? []) byId.set(n.id as string, n.company_name as string)
    }
    for (const r of rows) {
      recognitionAwards.push({
        id: r.id,
        amount_cents: r.amount_cents,
        awarded_at: r.awarded_at,
        tier_name_snapshot: r.tier_name_snapshot,
        company_name: byId.get(r.sponsor_id) ?? null,
        deliveries: (r.recognition_benefit_deliveries ?? []).slice().sort(
          (a: any, b: any) => String(a.benefit_type).localeCompare(String(b.benefit_type))
        ),
      })
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
    let status: TeamStatus =
      payloadData.status === 'existing' && ftcTeamNumber ? 'existing' : 'incubator'
    const rawTaxStatus = payloadData.taxStatus || 'None'
    const taxStatus: TaxStatus =
      rawTaxStatus === '501c3' || rawTaxStatus === 'School' ? rawTaxStatus : 'None'

    // Second fallback provisioning path from the same untyped pending_team_data — same
    // enforcement as verifyCoach's provisioning branch: never leave the coach stuck on
    // this "Setting up your workspace…" screen over a verification failure. A rejected
    // match downgrades to incubator (the branch two lines above already handles that
    // status); every other outcome just proceeds and is recorded.
    let verificationRecordId: string | null = null
    if (status === 'existing' && ftcTeamNumber) {
      const verification = await verifyFTCTeamIdentity({
        teamNumber: ftcTeamNumber,
        claimedTeamName: (payloadData.teamName || profile.full_name || 'My Team').trim(),
        claimedOrganization: payloadData.organization ?? null,
        profileId: user.id,
      })
      verificationRecordId = verification.recordId
      if (verification.outcome === 'rejected') {
        status = 'incubator'
      }
    }

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
      if (verificationRecordId) {
        await adminClient
          .from('team_verification_records')
          .update({ team_id: newTeam.id })
          .eq('id', verificationRecordId)
      }
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
              className="flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover transition-colors"
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
      fulfillments={(fulfillments || []) as any}
      payoutProfiles={payoutProfile ? [payoutProfile] : []}
      recognitionAwards={recognitionAwards as any}
    /></>
  )
}
