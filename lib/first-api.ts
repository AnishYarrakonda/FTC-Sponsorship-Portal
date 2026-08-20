// Typed client for the official FIRST Events API (https://ftc-api.firstinspires.org/v2.0/).
// This is the authoritative source for FTC team verification — lib/ftc-roster.ts uses it
// first and falls back to the FTCScout community mirror only when this is unavailable.
//
// Never throws. Every outcome — missing credentials, a non-2xx response, a timeout, a
// malformed body — degrades to { status: 'unavailable' } so a FIRST outage never 500s the
// signup wizard. Matches the lib/notify.ts idiom of "return a result object, don't throw."
import { env } from '@/lib/env'

const FIRST_API_BASE = 'https://ftc-api.firstinspires.org/v2.0'

export interface FirstApiTeam {
  teamNumber: number
  nameShort: string | null
  nameFull: string | null
  schoolName: string | null
  city: string | null
  stateProv: string | null
  country: string | null
  rookieYear: number | null
  districtCode: string | null
  homeCMP: string | null
}

export type FirstApiResult =
  | { status: 'found'; team: FirstApiTeam }
  | { status: 'not_found' } // API answered, roster has no such team
  | { status: 'unavailable'; reason: string } // creds missing, timeout, 5xx, 429

// {season} is the STARTING calendar year of the FTC season — the 2025-2026 season is
// 2025. A season runs May -> April, so any date in May or later belongs to the season
// starting that year; January-April belongs to the season that started the PRIOR year.
export function currentFtcSeason(now: Date = new Date()): number {
  const year = now.getFullYear()
  const month = now.getMonth() + 1 // Date#getMonth() is 0-indexed; normalize to 1-12.
  return month >= 5 ? year : year - 1
}

async function fetchSeason(
  teamNumber: number,
  season: number,
  authorization: string
): Promise<FirstApiResult> {
  try {
    const res = await fetch(`${FIRST_API_BASE}/${season}/teams?teamNumber=${teamNumber}`, {
      headers: { Authorization: authorization, Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    })

    if (!res.ok) {
      return { status: 'unavailable', reason: `FIRST API responded ${res.status}` }
    }

    const json = await res.json()
    const teams = json?.teams
    if (!Array.isArray(teams) || teams.length === 0) {
      return { status: 'not_found' }
    }

    const t = teams[0]
    return {
      status: 'found',
      team: {
        teamNumber: t.teamNumber,
        nameShort: t.nameShort ?? null,
        nameFull: t.nameFull ?? null,
        schoolName: t.schoolName ?? null,
        city: t.city ?? null,
        stateProv: t.stateProv ?? null,
        country: t.country ?? null,
        rookieYear: t.rookieYear ?? null,
        districtCode: t.districtCode ?? null,
        homeCMP: t.homeCMP ?? null,
      },
    }
  } catch (err) {
    // Covers a rejected fetch (network error, AbortSignal.timeout firing with
    // AbortError) and a malformed JSON body — none of those may propagate as a throw.
    const reason = err instanceof Error ? err.message : 'FIRST API request failed'
    return { status: 'unavailable', reason }
  }
}

export async function fetchTeamFromFirstApi(teamNumber: number): Promise<FirstApiResult> {
  const username = env.FIRST_API_USERNAME
  const token = env.FIRST_API_TOKEN
  if (!username || !token) {
    return { status: 'unavailable', reason: 'FIRST API credentials are not configured' }
  }

  const authorization = 'Basic ' + Buffer.from(`${username}:${token}`).toString('base64')
  const season = currentFtcSeason()

  const primary = await fetchSeason(teamNumber, season, authorization)
  if (primary.status !== 'not_found') return primary

  // A team that has not yet re-registered for the current season is still a real team —
  // retry once against the prior season before reporting not_found.
  return fetchSeason(teamNumber, season - 1, authorization)
}
