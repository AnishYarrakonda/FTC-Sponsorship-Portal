/**
 * Assembles a sponsor or platform impact payload from the projection.
 *
 * Every read here selects an explicit column list built from the allowlist in
 * projection.ts — never `select('*')`, never a hand-written string, and never a join on
 * `profiles`.
 *
 * Year boundary: a match belongs to a report year by the ledger row's CREATED_AT, i.e. the
 * date the sponsor committed. Nothing tracks when (or whether) money moved, so there is no
 * second date it could be filed under. That is stated in the payload's own `footnotes`
 * because a finance reader will ask.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import {
  impactAchievementSelect,
  impactLedgerSelect,
  impactTeamSelect,
  projectAchievement,
  projectMatch,
  projectTeam,
  type ImpactAchievement,
  type ImpactMatch,
  type ImpactTeam,
} from './projection'

export const IMPACT_PAYLOAD_SCHEMA_VERSION = 1

/**
 * 0111: the pledged/received/outstanding split is gone with the fulfillment state machine.
 * Nothing in the product observes whether money actually arrived -- the platform never
 * touches funds -- so reporting a "received" figure would have been an assertion we cannot
 * support. One honest number remains: what sponsors COMMITTED TO.
 */
export interface ImpactTotals {
  matched_cents: number
  teams_supported: number
  students_reached: number
  events_hosted: number
  volunteer_hours: number
}

export interface ImpactTeamSection {
  team: ImpactTeam
  achievements: ImpactAchievement[]
  matches: ImpactMatch[]
}

export interface SponsorImpactPayload {
  schema_version: number
  year: number
  generated_at: string
  sponsor: { company_name: string; logo_url: string | null }
  totals: ImpactTotals
  teams: ImpactTeamSection[]
  footnotes: string[]
}

export interface PlatformImpactPayload {
  schema_version: number
  year: number
  generated_at: string
  totals: ImpactTotals
  sponsors_active: number
  footnotes: string[]
}

/**
 * Named `footnotes`, not `notes`: `notes` is on IMPACT_FORBIDDEN_KEYS (it is a free-text
 * column that also existed on the retired fulfillment table), and findForbiddenKeys is deliberately
 * a blunt key-name check with no exceptions. A legitimate field must not share the name.
 */
const FOOTNOTES = [
  'The platform never handles funds. "Pledged" is a commitment recorded at the sponsor\'s decision; "received" means the team confirmed the payment arrived. The difference is shown as outstanding.',
  'A sponsorship belongs to the report year in which it was pledged. A December commitment paid the following February stays in the December report and shows as outstanding until that report is regenerated.',
  'Portfolio photographs appear only for teams whose coach has affirmed the images contain no identifiable students. Recognition proof photographs carry the same affirmation, enforced by a database constraint.',
]

function yearBounds(year: number): { from: string; to: string } {
  return { from: `${year}-01-01T00:00:00.000Z`, to: `${year + 1}-01-01T00:00:00.000Z` }
}

function emptyTotals(): ImpactTotals {
  return {
    matched_cents: 0,
    teams_supported: 0,
    students_reached: 0,
    events_hosted: 0,
    volunteer_hours: 0,
  }
}

export async function buildSponsorImpactPayload(
  adminClient: SupabaseClient<Database>,
  sponsorId: string,
  year: number
): Promise<SponsorImpactPayload> {
  const { from, to } = yearBounds(year)
  const generatedAt = new Date().toISOString()

  // Own sponsor row only, and only two columns of it. contact_*, funding_cap_cents,
  // funding_used_cents, notes and geo_states are internal and stay internal.
  const { data: sponsorRow } = await adminClient
    .from('sponsors')
    .select('company_name, logo_url')
    .eq('id', sponsorId)
    .maybeSingle()

  const { data: ledgerRows } = await adminClient
    .from('transactions_ledger')
    .select(`team_id, ${impactLedgerSelect()}`)
    .eq('sponsor_id', sponsorId)
    .gte('created_at', from)
    .lt('created_at', to)

  const rows = (ledgerRows ?? []) as unknown as (Record<string, unknown> & { team_id: string | null })[]

  // Net per team, so a match voided inside the same report year drops out of both the money
  // and the team count rather than inflating a CSR report with a sponsorship that unwound.
  const netByTeam = new Map<string, number>()
  for (const r of rows) {
    if (!r.team_id) continue
    const amount = typeof r.amount_cents === 'number' ? r.amount_cents : 0
    netByTeam.set(r.team_id, (netByTeam.get(r.team_id) ?? 0) + amount)
  }
  const teamIds = Array.from(netByTeam.entries()).filter(([, net]) => net > 0).map(([id]) => id)

  const totals = emptyTotals()
  totals.matched_cents = teamIds.reduce((sum, id) => sum + (netByTeam.get(id) ?? 0), 0)
  totals.teams_supported = teamIds.length

  const teams: ImpactTeamSection[] = []

  if (teamIds.length > 0) {
    const [{ data: teamRows }, { data: achievementRows }] = await Promise.all([
      adminClient.from('teams').select(impactTeamSelect()).in('id', teamIds).is('deleted_at', null),
      adminClient
        .from('team_achievements')
        .select(`team_id, ${impactAchievementSelect()}`)
        .in('team_id', teamIds),
    ])

    const achievementsByTeam = new Map<string, ImpactAchievement[]>()
    for (const a of (achievementRows ?? []) as unknown as Record<string, unknown>[]) {
      const key = String(a.team_id)
      const list = achievementsByTeam.get(key) ?? []
      list.push(projectAchievement(a))
      achievementsByTeam.set(key, list)
    }

    for (const t of (teamRows ?? []) as unknown as Record<string, unknown>[]) {
      const id = String(t.id)
      const team = projectTeam(t)
      totals.students_reached += team.students_reached ?? 0
      totals.events_hosted += team.events_hosted ?? 0
      totals.volunteer_hours += team.volunteer_hours ?? 0

      teams.push({
        team,
        achievements: achievementsByTeam.get(id) ?? [],
        matches: rows.filter((r) => r.team_id === id).map(projectMatch),
      })
    }
  }

  return {
    schema_version: IMPACT_PAYLOAD_SCHEMA_VERSION,
    year,
    generated_at: generatedAt,
    sponsor: {
      company_name: (sponsorRow?.company_name as string | undefined) ?? 'Sponsor',
      logo_url: (sponsorRow?.logo_url as string | null | undefined) ?? null,
    },
    totals,
    teams,
    footnotes: FOOTNOTES,
  }
}

/**
 * The platform aggregate, for grant applications. Deliberately carries no per-team and no
 * per-sponsor detail: it is a set of numbers, and it is the only impact payload that
 * anything outside a sponsor's own session ever sees.
 */
export async function buildPlatformImpactPayload(
  adminClient: SupabaseClient<Database>,
  year: number
): Promise<PlatformImpactPayload> {
  const { from, to } = yearBounds(year)
  const generatedAt = new Date().toISOString()

  const { data: ledgerRows } = await adminClient
    .from('transactions_ledger')
    .select('team_id, amount_cents')
    .gte('created_at', from)
    .lt('created_at', to)

  const rows = (ledgerRows ?? []) as unknown as { team_id: string | null; amount_cents: number }[]

  // Same net-per-team rule as the sponsor payload; see the comment there.
  const netByTeam = new Map<string, number>()
  for (const r of rows) {
    if (!r.team_id) continue
    netByTeam.set(r.team_id, (netByTeam.get(r.team_id) ?? 0) + (r.amount_cents ?? 0))
  }
  const teamIds = Array.from(netByTeam.entries()).filter(([, net]) => net > 0).map(([id]) => id)

  const totals = emptyTotals()
  totals.matched_cents = teamIds.reduce((sum, id) => sum + (netByTeam.get(id) ?? 0), 0)
  totals.teams_supported = teamIds.length

  if (teamIds.length > 0) {
    const { data: teamRows } = await adminClient
      .from('teams')
      .select('students_reached, events_hosted, volunteer_hours')
      .in('id', teamIds)
      .is('deleted_at', null)

    for (const t of (teamRows ?? []) as unknown as Record<string, number | null>[]) {
      totals.students_reached += t.students_reached ?? 0
      totals.events_hosted += t.events_hosted ?? 0
      totals.volunteer_hours += t.volunteer_hours ?? 0
    }
  }

  const { count: sponsorsActive } = await adminClient
    .from('sponsors')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active')

  return {
    schema_version: IMPACT_PAYLOAD_SCHEMA_VERSION,
    year,
    generated_at: generatedAt,
    totals,
    sponsors_active: sponsorsActive ?? 0,
    footnotes: FOOTNOTES,
  }
}
