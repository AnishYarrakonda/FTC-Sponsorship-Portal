import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import {
  IMPACT_TEAM_FIELDS,
  IMPACT_ACHIEVEMENT_FIELDS,
  IMPACT_LEDGER_FIELDS,
  IMPACT_FORBIDDEN_KEYS,
  IMPACT_MEDIA_LIMIT,
  impactTeamSelect,
  impactAchievementSelect,
  impactLedgerSelect,
  projectTeam,
  projectAchievement,
  projectMatch,
  findForbiddenKeys,
} from '@/lib/impact-report/projection'

const repoRoot = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(repoRoot, p), 'utf8')

/**
 * A raw `teams` row carrying EVERY forbidden column, each populated with a recognisable
 * sentinel. If any of these reaches the output, the string 'FORBIDDEN' appears in the
 * serialised payload and these tests fail loudly.
 */
function rawTeamRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    // Allowlisted
    id: 'team-1',
    ftc_team_number: 31579,
    team_name: 'Exodius',
    organization: 'Plano East Senior High',
    city: 'Plano',
    state: 'TX',
    tax_status: '501c3',
    founded_year: 2019,
    seasons_competed: 6,
    team_size: 22,
    students_reached: 1200,
    events_hosted: 8,
    volunteer_hours: 340,
    tagline: 'Engineering the next generation.',
    mission_statement: 'We build robots and community.',
    outreach_summary: 'Summer camps and library demos.',
    logo_url: 'https://x.supabase.co/storage/v1/object/public/team-logos/a.png',
    media_urls: Array.from({ length: 9 }, (_, i) => `https://x.supabase.co/m/${i}.jpg`),
    media_no_minors_confirmed_at: null,

    // Forbidden — every one of these has a recorded reason in projection.ts
    full_name: 'FORBIDDEN_full_name',
    email: 'FORBIDDEN_email',
    contact_email: 'FORBIDDEN_contact_email',
    contact_name: 'FORBIDDEN_contact_name',
    contact_title: 'FORBIDDEN_contact_title',
    phone_number: 'FORBIDDEN_phone_number',
    date_of_birth: 'FORBIDDEN_date_of_birth',
    address_line1: 'FORBIDDEN_address_line1',
    zip_code: 'FORBIDDEN_zip_code',
    referral_source: 'FORBIDDEN_referral_source',
    coach_credentials_url: 'FORBIDDEN_coach_credentials_url',
    coach_photo_url: 'FORBIDDEN_coach_photo_url',
    coach_experience: 'FORBIDDEN_coach_experience',
    community_endorsements: 'FORBIDDEN_community_endorsements',
    subteam_breakdown: 'FORBIDDEN_subteam_breakdown',
    press_links: ['FORBIDDEN_press_links'],
    past_sponsors: ['FORBIDDEN_past_sponsors'],
    custom_pitch_alignment: 'FORBIDDEN_custom_pitch_alignment',
    specific_needs_statement: 'FORBIDDEN_specific_needs_statement',
    local_connection_notes: 'FORBIDDEN_local_connection_notes',
    payment_reference: 'FORBIDDEN_payment_reference',
    notes: 'FORBIDDEN_notes',
    clerk_user_id: 'FORBIDDEN_clerk_user_id',
    ...overrides,
  }
}

describe('COPPA: no student PII reaches the projection', () => {
  it('projectTeam emits only allowlisted keys and no sentinel', () => {
    const projected = projectTeam(rawTeamRow())
    // `id` and `media_no_minors_confirmed_at` are query-internal and must not be output.
    const allowed = new Set(
      IMPACT_TEAM_FIELDS.filter((f) => f !== 'id' && f !== 'media_no_minors_confirmed_at')
    )
    for (const key of Object.keys(projected)) {
      expect(allowed.has(key as never), `unexpected key ${key}`).toBe(true)
    }
    expect(findForbiddenKeys(projected)).toEqual([])
    expect(JSON.stringify(projected)).not.toContain('FORBIDDEN')
  })

  it('projectAchievement and projectMatch emit no sentinel', () => {
    const achievement = projectAchievement({
      season: '2025-26',
      event_name: 'North Texas Regional',
      award: 'Inspire Award',
      description: 'Judged winner.',
      id: 'a1',
      team_id: 'team-1',
      notes: 'FORBIDDEN_notes',
      full_name: 'FORBIDDEN_full_name',
    })
    const match = projectMatch({
      amount_cents: 250000,
      decision_type: 'full',
      created_at: '2026-03-01T00:00:00.000Z',
      // transactions_ledger has no free-text column today, but the projection is the
      // guarantee -- so feed it one anyway and assert it cannot get through.
      notes: 'FORBIDDEN_notes',
      contact_email: 'FORBIDDEN_contact_email',
    })

    for (const [name, out] of Object.entries({ achievement, match })) {
      expect(findForbiddenKeys(out), name).toEqual([])
      expect(JSON.stringify(out), name).not.toContain('FORBIDDEN')
    }

    expect(Object.keys(achievement).sort()).toEqual([...IMPACT_ACHIEVEMENT_FIELDS].sort())
    // projectMatch renames created_at -> matched_at, so the key set is the allowlist with
    // that one substitution rather than the allowlist verbatim.
    expect(Object.keys(match).sort()).toEqual(
      [...IMPACT_LEDGER_FIELDS].map((f) => (f === 'created_at' ? 'matched_at' : f)).sort()
    )
  })

  it('a fully assembled payload carries no forbidden key and no sentinel', () => {
    const payload = {
      schema_version: 1,
      year: 2026,
      generated_at: '2026-08-13T00:00:00.000Z',
      sponsor: { company_name: 'Acme Robotics', logo_url: null },
      totals: { matched_cents: 250000 },
      teams: [
        {
          team: projectTeam(rawTeamRow()),
          achievements: [projectAchievement({ season: '2025-26', award: 'Inspire' })],
          matches: [projectMatch({ amount_cents: 250000, decision_type: 'full' })],
        },
      ],
      footnotes: [],
    }
    expect(findForbiddenKeys(payload)).toEqual([])
    expect(JSON.stringify(payload)).not.toContain('FORBIDDEN')
  })

  it('findForbiddenKeys actually finds one when it is there (the test that tests the test)', () => {
    // A safety net that never fires is indistinguishable from one that cannot fire.
    expect(findForbiddenKeys({ teams: [{ nested: { contact_email: 'x' } }] })).toEqual([
      'contact_email',
    ])
  })
})

describe('the select strings are derived from the allowlist', () => {
  it('hand-editing one without the other fails here', () => {
    expect(impactTeamSelect()).toBe(IMPACT_TEAM_FIELDS.join(','))
    expect(impactAchievementSelect()).toBe(IMPACT_ACHIEVEMENT_FIELDS.join(','))
    expect(impactLedgerSelect()).toBe(IMPACT_LEDGER_FIELDS.join(','))
  })

  it('no forbidden key appears in any select string', () => {
    const all = [
      impactTeamSelect(),
      impactAchievementSelect(),
      impactLedgerSelect(),
    ].join(',')
    const columns = new Set(all.split(','))
    for (const k of IMPACT_FORBIDDEN_KEYS) {
      expect(columns.has(k), `${k} is selected`).toBe(false)
    }
  })
})

describe('portfolio photos fail closed', () => {
  it('media_urls is empty when the affirmation is missing', () => {
    expect(projectTeam(rawTeamRow()).media_urls).toEqual([])
  })

  it('media_urls is present and capped once affirmed', () => {
    const projected = projectTeam(
      rawTeamRow({ media_no_minors_confirmed_at: '2026-07-01T00:00:00.000Z' })
    )
    expect(projected.media_urls).toHaveLength(IMPACT_MEDIA_LIMIT)
    expect(projected.media_urls[0]).toBe('https://x.supabase.co/m/0.jpg')
  })

  it('an empty-string affirmation does not count as affirmed', () => {
    expect(projectTeam(rawTeamRow({ media_no_minors_confirmed_at: '' })).media_urls).toEqual([])
  })
})

describe('unknown columns cannot reach the output', () => {
  it('adding a key to the raw row changes the projection not at all', () => {
    // The regression test for someone reintroducing a spread.
    const base = projectTeam(rawTeamRow())
    const withExtra = projectTeam(
      rawTeamRow({ some_new_column_next_season: 'FORBIDDEN_surprise', student_names: ['Maya'] })
    )
    expect(withExtra).toEqual(base)
    expect(JSON.stringify(withExtra)).not.toContain('Maya')
  })
})

describe('INVARIANT: the projection has no escape hatch', () => {
  const projectionSrc = read('lib/impact-report/projection.ts')

  it('contains no object spread and no Object.assign', () => {
    const code = projectionSrc
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*(\/\/|\*).*$/gm, '')
    // `{ ...row }` in any form would copy unknown keys straight into a report.
    expect(/\{\s*\.\.\./.test(code), 'object spread found').toBe(false)
    expect(code).not.toContain('Object.assign')
  })

  it('never selects *', () => {
    // Comments stripped first: both files state the prohibition in prose, and matching
    // your own rule is not a violation of it.
    for (const file of ['lib/impact-report/projection.ts', 'lib/impact-report/build.ts']) {
      const code = read(file)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*(\/\/|\*).*$/gm, '')
      expect(code, file).not.toMatch(/select\(\s*['"`]\*/)
    }
  })

  it('nothing under lib/impact-report/ references profiles', () => {
    // Not for a coach name, not for an email, not for a "prepared by" line.
    for (const file of ['lib/impact-report/projection.ts', 'lib/impact-report/build.ts']) {
      const code = read(file)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*(\/\/|\*).*$/gm, '')
      expect(code, file).not.toContain('profiles')
    }
  })
})

describe('INVARIANT: the sponsor route resolves the sponsor from the session', () => {
  const routeSrc = read('app/api/sponsor/impact-report/route.ts')

  it('guards with requireSponsor and reads through the RLS-respecting client', () => {
    expect(routeSrc).toContain('requireSponsor')
    expect(routeSrc).toContain("from '@/lib/supabase/server'")
    // The admin client must not be imported here at all — the audit write goes through
    // the adminClient requireSponsor() already returns.
    expect(routeSrc).not.toContain('createAdminClient')
  })

  it('the snapshot read is filtered by scope, sponsor and year', () => {
    const readBlock = routeSrc.slice(
      routeSrc.indexOf("from('impact_report_snapshots')"),
      routeSrc.indexOf('if (!snapshot)')
    )
    expect(readBlock).toContain(".eq('scope', 'sponsor')")
    expect(readBlock).toContain(".eq('sponsor_id', scopedSponsorId)")
    expect(readBlock).toContain(".eq('report_year', year)")
  })

  it('a contradicting sponsorId parameter is a 403 and an audit row', () => {
    expect(routeSrc).toContain('impact_report_cross_tenant_attempt')
    expect(routeSrc).toContain('sponsorIds.includes(requestedSponsor)')
  })
})

describe('INVARIANT: a page render never writes a snapshot', () => {
  it('no impact page calls upsert_impact_snapshot or a regenerate action', () => {
    // A GET that mutates turns every crawler into a rewrite of the record.
    for (const file of [
      'app/(sponsor)/sponsor/impact/page.tsx',
      'app/(sponsor)/sponsor/impact/[year]/page.tsx',
      'app/(admin)/impact/page.tsx',
      'app/api/sponsor/impact-report/route.ts',
      'app/api/admin/impact-report/route.ts',
    ]) {
      const code = read(file)
      expect(code, file).not.toContain('upsert_impact_snapshot')
      expect(code, file).not.toContain('regenerateImpactSnapshot(')
      expect(code, file).not.toContain('buildSponsorImpactPayload')
    }
  })
})

describe('INVARIANT: 0088 grants and policies', () => {
  const migration = read('supabase/migrations/0088_impact_reports.sql')

  it('every SECURITY DEFINER function is revoked and granted to service_role only', () => {
    for (const fn of [
      'upsert_impact_snapshot',
      'close_impact_report_year',
      'reopen_impact_report_year',
      'refresh_public_platform_stats',
      'trg_reset_media_affirmation',
    ]) {
      expect(migration, `${fn} missing REVOKE`).toMatch(
        new RegExp(`REVOKE EXECUTE ON FUNCTION ${fn}\\([^)]*\\) FROM PUBLIC`)
      )
      expect(migration, `${fn} missing GRANT`).toMatch(
        new RegExp(`GRANT  EXECUTE ON FUNCTION ${fn}\\([^)]*\\) TO service_role`)
      )
    }
  })

  it('only public_platform_stats is anon-readable', () => {
    expect(migration).toContain('CREATE POLICY platform_stats_select_public')
    // If a future change wants landing-page data, it adds a column to
    // public_platform_stats rather than widening the snapshot policy.
    const snapshotPolicies = migration.slice(
      migration.indexOf('impact_snapshots_select_admin'),
      migration.indexOf('platform_stats_select_public')
    )
    expect(snapshotPolicies).not.toContain('TO anon')
  })

  it('has no write policies on either table', () => {
    expect(migration).not.toMatch(/CREATE POLICY[\s\S]{0,200}FOR (INSERT|UPDATE|DELETE)/)
  })

  it('sponsor scoping goes through current_sponsor_ids()', () => {
    expect(migration).toContain('sponsor_id = ANY (current_sponsor_ids())')
    expect(migration).not.toMatch(/p\.sponsor_id = impact_report_snapshots\.sponsor_id/)
  })

  it('never uses auth.uid()', () => {
    expect(migration).not.toContain('auth.uid()')
  })
})

describe('INVARIANT: the CSV helper move is pure', () => {
  it('the admin export imports the helpers instead of redefining them', () => {
    const exportSrc = read('app/api/admin/export/route.ts')
    expect(exportSrc).toContain("from '@/lib/csv'")
    expect(exportSrc).not.toContain('function escapeCell')
    expect(exportSrc).not.toContain('function rowToCsv')
  })

  it('the formula-injection defence survived the move', () => {
    const csv = read('lib/csv.ts')
    expect(csv).toContain('/^[=+\\-@\\t\\r]/')
  })
})

describe('INVARIANT: the rollup cron is auth-hardened and scheduled', () => {
  it('uses timingSafeEqual against CRON_SECRET', () => {
    const cron = read('app/api/cron/impact-rollup/route.ts')
    expect(cron).toContain('crypto.timingSafeEqual')
    expect(cron).toContain('env.CRON_SECRET')
    expect(cron).toContain('token.length !== expectedToken.length')
  })

  /**
   * The rollup used to have its own vercel.json entry. It no longer does, and that is the
   * fix for audit A-09-05, not a regression: Vercel Hobby honours only the first 2 cron
   * entries and vercel.json declared 4, so this job silently never ran in production. It
   * is now invoked by /api/cron/daily-maintenance.
   *
   * The invariant these assertions protect is unchanged — the rollup must actually be
   * REACHABLE from something the scheduler calls — so they now follow that path instead.
   */
  it('is reachable from a cron entry that vercel.json actually schedules', () => {
    const vercel = JSON.parse(read('vercel.json')) as { crons: { path: string }[] }
    const paths = vercel.crons.map((c) => c.path)

    // Hobby ignores everything past the second entry, so exceeding 2 means jobs die silently.
    expect(vercel.crons.length).toBeLessThanOrEqual(2)
    expect(paths).toContain('/api/cron/daily-maintenance')

    // ...and that dispatcher must genuinely run the rollup.
    const dispatcher = read('app/api/cron/daily-maintenance/route.ts')
    expect(dispatcher).toContain('runImpactRollup')
    expect(read('app/api/cron/impact-rollup/route.ts')).toContain('export async function runImpactRollup')
  })

  it('the dispatcher isolates each job so one failure cannot swallow the others', () => {
    const dispatcher = read('app/api/cron/daily-maintenance/route.ts')
    // Every job goes through runJob(), which wraps the call in its own try/catch.
    expect(dispatcher).toContain('runJob(')
    expect(dispatcher).toContain('catch')
    // runNudgeFulfillments was removed with the fulfillment layer (0111).
    for (const job of ['runRefreshFtcRoster', 'runImpactRollup']) {
      expect(dispatcher).toContain(job)
    }
  })

  it('the dispatcher is auth-hardened with the same timing-safe check', () => {
    const authHelper = read('lib/cron/authorize.ts')
    expect(authHelper).toContain('crypto.timingSafeEqual')
    expect(authHelper).toContain('env.CRON_SECRET')
    expect(authHelper).toContain('token.length !== expectedToken.length')
    expect(read('app/api/cron/daily-maintenance/route.ts')).toContain('isAuthorizedCronRequest')
  })
})
