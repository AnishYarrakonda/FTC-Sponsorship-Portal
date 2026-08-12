import { createAdminClient } from './supabase/admin'
import { fetchTeamFromFirstApi, type FirstApiTeam } from './first-api'
import { scoreTeamMatch } from './ftc-team-match'

export interface FTCTeam {
  team_number: number
  team_name: string
  city: string | null
  state: string | null
  country: string | null
}

const FTCSCOUT_URL = 'https://api.ftcscout.org/graphql'
const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000

async function fetchFromFTCScout(teamNumber: number): Promise<FTCTeam | null> {
  // FTCScout's schema moved city/state/country under a nested `location` object at
  // some point after this query was first written — the old flat
  // `city / stateProv / country` selection is invalid against the live schema and
  // silently returns 0 usable data (a GraphQL validation error, not a network
  // failure, so the old `!res.ok` check never caught it). Found while verifying
  // prompt 07's FTCScout-fallback acceptance criterion against the real API.
  const query = `
    query {
      teamByNumber(number: ${teamNumber}) {
        number
        name
        location {
          city
          state
          country
        }
      }
    }
  `

  try {
    const res = await fetch(FTCSCOUT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(5000),
    })

    if (!res.ok) return null

    const json = await res.json()
    if (json?.errors) return null
    const team = json?.data?.teamByNumber
    if (!team) return null

    return {
      team_number: team.number,
      team_name: team.name,
      city: team.location?.city ?? null,
      state: team.location?.state ?? null,
      country: team.location?.country ?? null,
    }
  } catch {
    return null
  }
}

// Shape of the ftc_teams_cache row this module actually reads/writes. Kept local rather
// than importing Database['public']['Tables']['ftc_teams_cache']['Row'] verbatim so the
// admin-client casts below stay in one place.
interface CacheRow {
  team_number: number
  team_name: string
  city: string | null
  state: string | null
  country: string | null
  official_team_name: string | null
  organization: string | null
  rookie_year: number | null
  region_code: string | null
  district_code: string | null
  source: 'first_api' | 'ftcscout' | 'manual'
  verified_at: string | null
  last_synced: string
}

function cacheRowFromFirstApiTeam(team: FirstApiTeam): Omit<CacheRow, 'source' | 'verified_at' | 'last_synced'> {
  return {
    team_number: team.teamNumber,
    // team_name <- nameShort, falling back to nameFull when short is empty (§ prompt).
    team_name: team.nameShort || team.nameFull || `Team ${team.teamNumber}`,
    official_team_name: team.nameShort || null,
    organization: team.schoolName ?? team.nameFull ?? null,
    city: team.city ?? null,
    state: team.stateProv ?? null,
    country: team.country ?? null,
    rookie_year: team.rookieYear ?? null,
    region_code: team.homeCMP ?? null,
    district_code: team.districtCode ?? null,
  }
}

function toFTCTeam(row: CacheRow): FTCTeam {
  return {
    team_number: row.team_number,
    team_name: row.team_name,
    city: row.city,
    state: row.state,
    country: row.country,
  }
}

/**
 * Resolves the freshest team record available, trying (in order): a fresh cache hit,
 * the official FIRST Events API, the FTCScout fallback, then a stale cache row rather
 * than nothing. Shared by validateFTCTeam (existence/autofill) and
 * verifyFTCTeamIdentity (the name/organization cross-check), which is why it returns
 * the full cache row — validateFTCTeam narrows it down to the public FTCTeam shape.
 */
async function resolveTeamRecord(
  teamNumber: number
): Promise<{ row: CacheRow | null; source: 'first_api' | 'ftcscout' | 'cache' | 'none' }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createAdminClient() as any

  const { data: cachedTeam } = await supabase
    .from('ftc_teams_cache')
    .select('*')
    .eq('team_number', teamNumber)
    .maybeSingle()

  const isFresh =
    cachedTeam && Date.now() - new Date(cachedTeam.last_synced).getTime() < CACHE_TTL_MS

  if (isFresh) {
    return { row: cachedTeam as CacheRow, source: 'cache' }
  }

  const firstApiResult = await fetchTeamFromFirstApi(teamNumber)
  if (firstApiResult.status === 'found') {
    const now = new Date().toISOString()
    const payload: CacheRow = {
      ...cacheRowFromFirstApiTeam(firstApiResult.team),
      source: 'first_api',
      verified_at: now,
      last_synced: now,
    }
    const { data: upserted } = await supabase
      .from('ftc_teams_cache')
      .upsert(payload)
      .select('*')
      .maybeSingle()
    return { row: (upserted as CacheRow) ?? payload, source: 'first_api' }
  }

  const ftcScoutTeam = await fetchFromFTCScout(teamNumber)
  if (ftcScoutTeam) {
    const now = new Date().toISOString()
    const payload: CacheRow = {
      team_number: ftcScoutTeam.team_number,
      team_name: ftcScoutTeam.team_name,
      city: ftcScoutTeam.city,
      state: ftcScoutTeam.state,
      country: ftcScoutTeam.country,
      // FTCScout has no reliable organization/school field — leave the official_*
      // columns untouched so a later official-API refresh can still fill them in.
      official_team_name: cachedTeam?.official_team_name ?? null,
      organization: cachedTeam?.organization ?? null,
      rookie_year: cachedTeam?.rookie_year ?? null,
      region_code: cachedTeam?.region_code ?? null,
      district_code: cachedTeam?.district_code ?? null,
      source: 'ftcscout',
      verified_at: cachedTeam?.verified_at ?? null,
      last_synced: now,
    }
    const { data: upserted } = await supabase
      .from('ftc_teams_cache')
      .upsert(payload)
      .select('*')
      .maybeSingle()
    return { row: (upserted as CacheRow) ?? payload, source: 'ftcscout' }
  }

  // Every source failed. A stale cached row beats nothing — returning null here would
  // break createTeam for every existing coach the moment FIRST has an outage.
  if (cachedTeam) {
    return { row: cachedTeam as CacheRow, source: 'cache' }
  }

  return { row: null, source: 'none' }
}

/** UNCHANGED signature and return contract — createTeam and lookupFTCTeam both
 * destructure FTCTeam directly; do not alter this shape. */
export async function validateFTCTeam(teamNumber: number): Promise<FTCTeam | null> {
  const { row } = await resolveTeamRecord(teamNumber)
  return row ? toFTCTeam(row) : null
}

/**
 * Same lookup as validateFTCTeam, plus which source answered — used only by the
 * signup wizard's autofill to render a provenance line ("verified against the
 * official roster" vs "matched via FTCScout" vs "roster temporarily unavailable").
 * validateFTCTeam itself is left untouched since its return shape is load-bearing.
 */
export async function lookupFTCTeamWithSource(
  teamNumber: number
): Promise<{ team: FTCTeam; source: 'first_api' | 'ftcscout' | 'cache' | 'none' } | null> {
  const { row, source } = await resolveTeamRecord(teamNumber)
  return row ? { team: toFTCTeam(row), source } : null
}

export interface VerificationOutcome {
  outcome: 'auto_pass' | 'needs_review' | 'rejected' | 'unavailable'
  confidence: number
  source: 'first_api' | 'ftcscout' | 'cache' | 'none'
  official: FTCTeam | null
  officialOrganization: string | null
  recordId: string | null // team_verification_records.id, always written
  message: string // coach-facing copy, safe to render
}

function buildMessage(
  source: VerificationOutcome['source'],
  outcome: VerificationOutcome['outcome'],
  teamNumber: number
): string {
  if (outcome === 'unavailable') {
    return 'The FIRST roster is temporarily unavailable; an admin will confirm your team number after signup.'
  }

  const sourceCopy =
    source === 'first_api'
      ? 'Verified against the official FIRST roster.'
      : source === 'ftcscout'
        ? 'Matched via FTCScout — pending official confirmation.'
        : 'Matched against a cached FIRST roster record.'

  if (outcome === 'auto_pass') return sourceCopy
  if (outcome === 'needs_review') {
    return (
      `We found FTC Team #${teamNumber}, but the name you entered doesn't closely match ` +
      'the official record. An admin will review this before it is finalized.'
    )
  }
  // rejected
  return (
    `FTC Team #${teamNumber} exists on the official roster, but the team name you entered ` +
    "doesn't match it. Double-check the number, or request an admin review."
  )
}

/**
 * The cross-check: does the coach-supplied team name (and, if given, organization)
 * match the official record for this FTC team number? Always writes exactly one
 * team_verification_records row (append-only, admin-client-only — see 0081), so every
 * check has a durable record regardless of outcome.
 */
export async function verifyFTCTeamIdentity(input: {
  teamNumber: number
  claimedTeamName: string
  claimedOrganization?: string | null
  profileId: string
  teamId?: string | null
}): Promise<VerificationOutcome> {
  const { row, source } = await resolveTeamRecord(input.teamNumber)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createAdminClient() as any

  if (!row) {
    const { data: inserted } = await supabase
      .from('team_verification_records')
      .insert({
        team_id: input.teamId ?? null,
        profile_id: input.profileId,
        ftc_team_number: input.teamNumber,
        claimed_team_name: input.claimedTeamName,
        claimed_organization: input.claimedOrganization ?? null,
        official_team_name: null,
        official_organization: null,
        source: 'none',
        name_score: 0,
        organization_score: null,
        confidence: 0,
        outcome: 'unavailable',
      })
      .select('id')
      .single()

    return {
      outcome: 'unavailable',
      confidence: 0,
      source: 'none',
      official: null,
      officialOrganization: null,
      recordId: inserted?.id ?? null,
      message: buildMessage('none', 'unavailable', input.teamNumber),
    }
  }

  const officialTeamName = row.official_team_name ?? row.team_name
  const match = scoreTeamMatch({
    claimedTeamName: input.claimedTeamName,
    claimedOrganization: input.claimedOrganization,
    officialTeamName,
    officialOrganization: row.organization,
  })

  const { data: inserted } = await supabase
    .from('team_verification_records')
    .insert({
      team_id: input.teamId ?? null,
      profile_id: input.profileId,
      ftc_team_number: input.teamNumber,
      claimed_team_name: input.claimedTeamName,
      claimed_organization: input.claimedOrganization ?? null,
      official_team_name: officialTeamName,
      official_organization: row.organization,
      source,
      name_score: match.nameScore,
      organization_score: match.organizationScore,
      confidence: match.confidence,
      outcome: match.outcome,
    })
    .select('id')
    .single()

  return {
    outcome: match.outcome,
    confidence: match.confidence,
    source,
    official: toFTCTeam(row),
    officialOrganization: row.organization,
    recordId: inserted?.id ?? null,
    message: buildMessage(source, match.outcome, input.teamNumber),
  }
}

/**
 * Nightly refresh (app/api/cron/refresh-ftc-roster) — re-verifies the `limitRows` rows
 * with the oldest last_synced older than the 14-day TTL against the official API only
 * (no FTCScout fallback here; a row that fails simply stays stale and is retried the
 * next night). Rows that are already fresh are never touched.
 */
export async function refreshStaleRosterEntries(
  limitRows = 200
): Promise<{ refreshed: number; failed: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createAdminClient() as any
  const cutoff = new Date(Date.now() - CACHE_TTL_MS).toISOString()

  const { data: staleRows } = await supabase
    .from('ftc_teams_cache')
    .select('team_number')
    .lt('last_synced', cutoff)
    .order('last_synced', { ascending: true })
    .limit(limitRows)

  let refreshed = 0
  let failed = 0

  for (const row of (staleRows ?? []) as { team_number: number }[]) {
    const result = await fetchTeamFromFirstApi(row.team_number)
    if (result.status === 'found') {
      const now = new Date().toISOString()
      const { error } = await supabase.from('ftc_teams_cache').upsert({
        ...cacheRowFromFirstApiTeam(result.team),
        source: 'first_api',
        verified_at: now,
        last_synced: now,
      })
      if (error) failed++
      else refreshed++
    } else {
      failed++
    }
  }

  return { refreshed, failed }
}
