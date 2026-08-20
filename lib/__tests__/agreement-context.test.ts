import { describe, it, expect } from 'vitest'
import { buildSubmissionAgreementContext } from '../agreements/context'
import { MissingMergeFieldError } from '../agreements/render'

interface FixtureOverrides {
  submission?: Record<string, unknown>
  team?: Record<string, unknown>
  sponsor?: Record<string, unknown>
  payout?: Record<string, unknown> | null
}

// Minimal fluent stand-in for the admin SupabaseClient — enough to exercise
// buildSubmissionAgreementContext's read pattern (.from(x).select(...).eq(...).single()/
// .maybeSingle()) without a real database.
function makeAdminClient(overrides: FixtureOverrides = {}): any {
  const submission = overrides.submission ?? {
    id: 'sub-1',
    sponsor_id: 'sponsor-1',
    team_id: 'team-1',
    reserved_amount_cents: 1_250_000,
    season: '2025-2026',
  }
  const team = overrides.team ?? {
    id: 'team-1',
    team_name: 'Iron Kestrels',
    ftc_team_number: 14821,
    organization: 'Northgate High School',
    city: 'Dayton',
    state: 'OH',
    owner_id: 'owner-1',
  }
  const sponsor = overrides.sponsor ?? {
    id: 'sponsor-1',
    company_name: 'Acme Robotics, Inc.',
    contact_name: 'Dana Whitfield',
    contact_email: 'dana@acme.example',
  }
  const payout =
    overrides.payout === undefined ? { legal_payee_name: 'Northgate HS Robotics Boosters' } : overrides.payout

  const tables: Record<string, unknown> = {
    submissions: submission,
    teams: team,
    sponsors: sponsor,
    team_payout_profiles: payout,
  }

  return {
    from(table: string) {
      const row = tables[table]
      const builder = {
        select: () => builder,
        eq: () => builder,
        single: async () => ({ data: row ?? null, error: row ? null : { message: 'not found' } }),
        maybeSingle: async () => ({ data: row ?? null, error: null }),
      }
      return builder
    },
  }
}

describe('buildSubmissionAgreementContext', () => {
  it('builds a complete MergeContext from a full submission fixture', async () => {
    const result = await buildSubmissionAgreementContext(makeAdminClient(), 'sub-1')
    expect(result.mergeContext).toMatchObject({
      sponsor_company_name: 'Acme Robotics, Inc.',
      sponsor_contact_name: 'Dana Whitfield',
      sponsor_contact_email: 'dana@acme.example',
      team_number: '14821',
      team_name: 'Iron Kestrels',
      team_organization: 'Northgate High School',
      team_legal_payee_name: 'Northgate HS Robotics Boosters',
      team_city: 'Dayton',
      team_state: 'OH',
      season: '2025-2026',
      amount_formatted: '$12,500.00',
    })
    expect(result.mergeContext.agreement_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('a missing legal payee name surfaces as MissingMergeFieldError naming team_legal_payee_name, and no document is produced', async () => {
    const client = makeAdminClient({
      payout: null,
      team: {
        id: 'team-1',
        team_name: 'Iron Kestrels',
        ftc_team_number: 14821,
        organization: null,
        city: 'Dayton',
        state: 'OH',
        owner_id: 'owner-1',
      },
    })

    let caught: unknown
    try {
      await buildSubmissionAgreementContext(client, 'sub-1')
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(MissingMergeFieldError)
    expect((caught as MissingMergeFieldError).keys).toEqual(['team_legal_payee_name'])
  })

  it('renders cents correctly and is stable across TZ/LANG changes', async () => {
    const originalTz = process.env.TZ
    const originalLang = process.env.LANG
    try {
      process.env.TZ = 'Pacific/Kiritimati'
      process.env.LANG = 'de-DE'
      const result = await buildSubmissionAgreementContext(makeAdminClient(), 'sub-1')
      expect(result.mergeContext.amount_formatted).toBe('$12,500.00')
    } finally {
      if (originalTz === undefined) delete process.env.TZ
      else process.env.TZ = originalTz
      if (originalLang === undefined) delete process.env.LANG
      else process.env.LANG = originalLang
    }
  })

  it('entity_snapshot contains only the permitted keys', async () => {
    const result = await buildSubmissionAgreementContext(makeAdminClient(), 'sub-1')
    expect(Object.keys(result.entitySnapshot).sort()).toEqual(
      ['amount_cents', 'sponsor_company_name', 'team_name', 'team_number', 'team_organization'].sort()
    )
  })
})
