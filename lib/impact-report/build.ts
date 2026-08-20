/**
 * Assembles a sponsor or platform impact payload from the projection.
 *
 * Every read here selects an explicit column list built from the allowlist in
 * projection.ts — never `select('*')`, never a hand-written string, and never a join on
 * `profiles`.
 *
 * Year boundary: a fulfillment belongs to a report year by PLEDGED_AT, the commitment
 * date, not by payment_received_at. A December pledge paid in February stays in the
 * December report and shows as outstanding until the following regeneration. That is
 * stated in the payload's own `footnotes` because a finance reader will ask.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import {
  impactAchievementSelect,
  impactBenefitSelect,
  impactFulfillmentSelect,
  impactTeamSelect,
  projectAchievement,
  projectBenefit,
  projectFulfillment,
  projectTeam,
  type ImpactAchievement,
  type ImpactBenefit,
  type ImpactFulfillment,
  type ImpactTeam,
} from './projection'

export const IMPACT_PAYLOAD_SCHEMA_VERSION = 1

/** Statuses that mean the money actually cleared. Everything else is a promise. */
const RECEIVED_STATUSES = ['payment_received', 'receipted']

export interface ImpactTotals {
  pledged_cents: number
  received_cents: number
  /** pledged − received, floored at zero. */
  outstanding_cents: number
  teams_supported: number
  students_reached: number
  events_hosted: number
  volunteer_hours: number
  benefits_promised: number
  benefits_delivered: number
}

export interface ImpactTeamSection {
  team: ImpactTeam
  achievements: ImpactAchievement[]
  fulfillments: ImpactFulfillment[]
  recognition: { tier_name: string | null; benefits: ImpactBenefit[] }
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
 * column on both sponsors and funding_fulfillments), and findForbiddenKeys is deliberately
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
    pledged_cents: 0,
    received_cents: 0,
    outstanding_cents: 0,
    teams_supported: 0,
    students_reached: 0,
    events_hosted: 0,
    volunteer_hours: 0,
    benefits_promised: 0,
    benefits_delivered: 0,
  }
}

/** Never negative: a receipted total exceeding the pledged total would be a data bug, not
 *  a negative debt to display to a CFO. */
export function outstandingCents(pledged: number, received: number): number {
  return Math.max(0, pledged - received)
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

  const { data: fulfillmentRows } = await adminClient
    .from('funding_fulfillments')
    .select(`team_id, ${impactFulfillmentSelect()}`)
    .eq('sponsor_id', sponsorId)
    .neq('status', 'cancelled')
    .gte('pledged_at', from)
    .lt('pledged_at', to)

  const rows = (fulfillmentRows ?? []) as unknown as (Record<string, unknown> & { team_id: string | null })[]
  const teamIds = Array.from(new Set(rows.map((r) => r.team_id).filter((id): id is string => !!id)))

  const totals = emptyTotals()
  for (const r of rows) {
    const amount = typeof r.amount_cents === 'number' ? r.amount_cents : 0
    totals.pledged_cents += amount
    if (typeof r.status === 'string' && RECEIVED_STATUSES.includes(r.status)) {
      totals.received_cents += amount
    }
  }
  totals.teams_supported = teamIds.length

  const teams: ImpactTeamSection[] = []

  if (teamIds.length > 0) {
    const [{ data: teamRows }, { data: achievementRows }, { data: awardRows }] = await Promise.all([
      adminClient.from('teams').select(impactTeamSelect()).in('id', teamIds).is('deleted_at', null),
      adminClient
        .from('team_achievements')
        .select(`team_id, ${impactAchievementSelect()}`)
        .in('team_id', teamIds),
      adminClient
        .from('sponsor_recognition_awards')
        .select(
          `team_id, tier_name_snapshot, recognition_benefit_deliveries(${impactBenefitSelect()})`
        )
        .eq('sponsor_id', sponsorId)
        .in('team_id', teamIds),
    ])

    const achievementsByTeam = new Map<string, ImpactAchievement[]>()
    for (const a of (achievementRows ?? []) as unknown as Record<string, unknown>[]) {
      const key = String(a.team_id)
      const list = achievementsByTeam.get(key) ?? []
      list.push(projectAchievement(a))
      achievementsByTeam.set(key, list)
    }

    const recognitionByTeam = new Map<string, { tier_name: string | null; benefits: ImpactBenefit[] }>()
    for (const a of (awardRows ?? []) as unknown as Record<string, unknown>[]) {
      const key = String(a.team_id)
      const benefits = Array.isArray(a.recognition_benefit_deliveries)
        ? (a.recognition_benefit_deliveries as Record<string, unknown>[]).map(projectBenefit)
        : []
      recognitionByTeam.set(key, {
        tier_name: typeof a.tier_name_snapshot === 'string' ? a.tier_name_snapshot : null,
        benefits,
      })
      totals.benefits_promised += benefits.length
      totals.benefits_delivered += benefits.filter((b) => b.status === 'delivered').length
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
        fulfillments: rows.filter((r) => r.team_id === id).map(projectFulfillment),
        recognition: recognitionByTeam.get(id) ?? { tier_name: null, benefits: [] },
      })
    }
  }

  totals.outstanding_cents = outstandingCents(totals.pledged_cents, totals.received_cents)

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

  const { data: fulfillmentRows } = await adminClient
    .from('funding_fulfillments')
    .select('team_id, amount_cents, status')
    .neq('status', 'cancelled')
    .gte('pledged_at', from)
    .lt('pledged_at', to)

  const rows = (fulfillmentRows ?? []) as unknown as { team_id: string | null; amount_cents: number; status: string }[]
  const teamIds = Array.from(new Set(rows.map((r) => r.team_id).filter((id): id is string => !!id)))

  const totals = emptyTotals()
  for (const r of rows) {
    totals.pledged_cents += r.amount_cents ?? 0
    if (RECEIVED_STATUSES.includes(r.status)) totals.received_cents += r.amount_cents ?? 0
  }
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

    const { data: benefitRows } = await adminClient
      .from('recognition_benefit_deliveries')
      .select('status')
    for (const b of (benefitRows ?? []) as unknown as { status: string }[]) {
      totals.benefits_promised += 1
      if (b.status === 'delivered') totals.benefits_delivered += 1
    }
  }

  totals.outstanding_cents = outstandingCents(totals.pledged_cents, totals.received_cents)

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
