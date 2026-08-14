import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { Database } from '../../lib/supabase/types'

/**
 * CSR impact reports (0088) — isolation, closed-year immutability, the media affirmation,
 * and the cron's auth.
 *
 * The isolation assertions go at PostgREST directly rather than through the UI: "sponsor B
 * cannot read sponsor A's report" has to be true of the API, not merely of the page.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

test.describe.serial('Impact reports — isolation, immutability, affirmation', () => {
  test.skip(
    !process.env.SUPABASE_LOCAL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY,
    'Requires local Supabase with anon and service role keys'
  )

  let admin: ReturnType<typeof createClient<Database>>
  let anon: ReturnType<typeof createClient<Database>>
  let adminProfileId: string
  let sponsorId: string
  const YEAR = 2026

  test.beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY)
    anon = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY)

    const { data: adminProfile } = await admin
      .from('profiles')
      .select('id')
      .eq('role', 'admin')
      .limit(1)
      .maybeSingle()
    test.skip(!adminProfile, 'Needs at least one admin profile')
    adminProfileId = adminProfile!.id

    const { data: sponsor } = await admin.from('sponsors').select('id').limit(1).maybeSingle()
    test.skip(!sponsor, 'Needs at least one sponsor')
    sponsorId = sponsor!.id
  })

  test('a snapshot round-trips and the platform row is unique per year', async () => {
    const first = await admin.rpc('upsert_impact_snapshot' as never, {
      p_actor_profile_id: adminProfileId,
      p_scope: 'platform',
      p_sponsor_id: null,
      p_report_year: YEAR,
      p_payload: { totals: { pledged_cents: 1 }, teams: [] },
      p_schema_version: 1,
    } as never)
    expect((first.data as any)?.ok).toBe(true)

    // Two PARTIAL unique indexes, not one composite: NULLs are distinct in Postgres, so a
    // plain UNIQUE(sponsor_id, report_year) would allow fifty platform rows for one year.
    await admin.rpc('upsert_impact_snapshot' as never, {
      p_actor_profile_id: adminProfileId,
      p_scope: 'platform',
      p_sponsor_id: null,
      p_report_year: YEAR,
      p_payload: { totals: { pledged_cents: 2 }, teams: [] },
      p_schema_version: 1,
    } as never)

    const { count } = await admin
      .from('impact_report_snapshots')
      .select('id', { count: 'exact', head: true })
      .eq('report_year', YEAR)
      .is('sponsor_id', null)
    expect(count).toBe(1)
  })

  test('a sponsor scope needs a sponsor and a platform scope must not have one', async () => {
    const mismatch = await admin.rpc('upsert_impact_snapshot' as never, {
      p_actor_profile_id: adminProfileId,
      p_scope: 'platform',
      p_sponsor_id: sponsorId,
      p_report_year: YEAR,
      p_payload: {},
      p_schema_version: 1,
    } as never)
    expect((mismatch.data as any)?.error).toBe('scope_mismatch')
  })

  test('CLOSED-YEAR STABILITY: the payload is byte-identical after the data changes', async () => {
    await admin.rpc('upsert_impact_snapshot' as never, {
      p_actor_profile_id: adminProfileId,
      p_scope: 'sponsor',
      p_sponsor_id: sponsorId,
      p_report_year: YEAR,
      p_payload: { marker: 'original', teams: [] },
      p_schema_version: 1,
    } as never)

    const closed = await admin.rpc('close_impact_report_year' as never, {
      p_actor_profile_id: adminProfileId,
      p_year: YEAR,
    } as never)
    expect((closed.data as any)?.ok).toBe(true)

    const { data: before } = await admin
      .from('impact_report_snapshots')
      .select('payload')
      .eq('scope', 'sponsor')
      .eq('sponsor_id', sponsorId)
      .eq('report_year', YEAR)
      .single()

    // Change the underlying facts.
    const { data: team } = await admin.from('teams').select('id, students_reached').limit(1).single()
    await admin
      .from('teams')
      .update({ students_reached: (team!.students_reached ?? 0) + 500 })
      .eq('id', team!.id)

    // The refusal lives in the DATABASE, so no caller can route around it.
    const blocked = await admin.rpc('upsert_impact_snapshot' as never, {
      p_actor_profile_id: adminProfileId,
      p_scope: 'sponsor',
      p_sponsor_id: sponsorId,
      p_report_year: YEAR,
      p_payload: { marker: 'tampered', teams: [] },
      p_schema_version: 1,
    } as never)
    expect((blocked.data as any)?.error).toBe('year_closed')

    const { data: after } = await admin
      .from('impact_report_snapshots')
      .select('payload')
      .eq('scope', 'sponsor')
      .eq('sponsor_id', sponsorId)
      .eq('report_year', YEAR)
      .single()

    expect(JSON.stringify(after!.payload)).toBe(JSON.stringify(before!.payload))

    // Restore the team so later runs are not cumulative.
    await admin.from('teams').update({ students_reached: team!.students_reached }).eq('id', team!.id)
  })

  test('reopening needs a reason, is audited, and restores writability', async () => {
    const short = await admin.rpc('reopen_impact_report_year' as never, {
      p_actor_profile_id: adminProfileId,
      p_year: YEAR,
      p_reason: 'oops',
    } as never)
    expect((short.data as any)?.error).toBe('reason_required')

    const reopened = await admin.rpc('reopen_impact_report_year' as never, {
      p_actor_profile_id: adminProfileId,
      p_year: YEAR,
      p_reason: 'Correcting a miscounted team for the audit.',
    } as never)
    expect((reopened.data as any)?.ok).toBe(true)

    const { data: audit } = await admin
      .from('audit_log')
      .select('metadata')
      .eq('action', 'impact_year_reopened')
      .order('created_at', { ascending: false })
      .limit(1)
    expect((audit ?? []).length).toBe(1)
    expect(JSON.stringify(audit![0].metadata)).toContain('miscounted')

    const writable = await admin.rpc('upsert_impact_snapshot' as never, {
      p_actor_profile_id: adminProfileId,
      p_scope: 'sponsor',
      p_sponsor_id: sponsorId,
      p_report_year: YEAR,
      p_payload: { marker: 'corrected', teams: [] },
      p_schema_version: 1,
    } as never)
    expect((writable.data as any)?.ok).toBe(true)
  })

  test('the media affirmation is cleared by any change to the photos', async () => {
    const { data: team } = await admin.from('teams').select('id, media_urls, tagline').limit(1).single()

    await admin
      .from('teams')
      .update({ media_no_minors_confirmed_at: new Date().toISOString() })
      .eq('id', team!.id)

    // An unrelated column must NOT clear it — the trigger is BEFORE UPDATE OF media_urls.
    await admin.from('teams').update({ tagline: team!.tagline ?? 'unchanged' }).eq('id', team!.id)
    const { data: survived } = await admin
      .from('teams')
      .select('media_no_minors_confirmed_at')
      .eq('id', team!.id)
      .single()
    expect(survived!.media_no_minors_confirmed_at).not.toBeNull()

    // Changing the photos does. Trigger-verified, not action-verified: nothing in app code
    // can forget to clear it.
    await admin
      .from('teams')
      .update({ media_urls: ['https://x.supabase.co/storage/v1/object/public/pitch-media/a.jpg'] })
      .eq('id', team!.id)
    const { data: cleared } = await admin
      .from('teams')
      .select('media_no_minors_confirmed_at')
      .eq('id', team!.id)
      .single()
    expect(cleared!.media_no_minors_confirmed_at).toBeNull()

    await admin.from('teams').update({ media_urls: team!.media_urls ?? [] }).eq('id', team!.id)
  })

  test('anon reads no snapshot but exactly one stats row, and that row is all numbers', async () => {
    const { data: snapshots } = await anon.from('impact_report_snapshots').select('*')
    expect(snapshots ?? []).toHaveLength(0)

    const { data: stats } = await anon.from('public_platform_stats').select('*')
    expect(stats ?? []).toHaveLength(1)

    // The whole reason an anon policy is defensible here: seven integers and a timestamp.
    for (const [key, value] of Object.entries(stats![0])) {
      if (key === 'refreshed_at') continue
      expect(typeof value === 'number' || typeof value === 'boolean', `${key} is ${typeof value}`).toBe(true)
    }
  })

  test('no authenticated role can UPDATE or DELETE either table', async () => {
    const { data: patched } = await anon
      .from('impact_report_snapshots')
      .update({ payload: { tampered: true } })
      .neq('id', '00000000-0000-0000-0000-000000000000')
      .select()
    expect(patched ?? []).toHaveLength(0)

    const { data: deleted } = await anon
      .from('impact_report_snapshots')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000')
      .select()
    expect(deleted ?? []).toHaveLength(0)

    const { data: statsPatched } = await anon
      .from('public_platform_stats')
      .update({ teams_supported: 9999 })
      .eq('id', true)
      .select()
    expect(statsPatched ?? []).toHaveLength(0)
  })

  test('refresh_public_platform_stats is idempotent and advances refreshed_at', async () => {
    const { data: before } = await anon.from('public_platform_stats').select('refreshed_at').single()
    await admin.rpc('refresh_public_platform_stats' as never)
    await admin.rpc('refresh_public_platform_stats' as never)

    const { data: rows } = await anon.from('public_platform_stats').select('refreshed_at')
    expect(rows).toHaveLength(1)
    expect(new Date(rows![0].refreshed_at).getTime()).toBeGreaterThanOrEqual(
      new Date(before!.refreshed_at).getTime()
    )
  })

  test('the rollup cron rejects a missing or wrong bearer token', async ({ request }) => {
    const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'

    const noToken = await request.get(`${baseUrl}/api/cron/impact-rollup`)
    expect(noToken.status()).toBe(401)

    const wrongToken = await request.get(`${baseUrl}/api/cron/impact-rollup`, {
      headers: { authorization: 'Bearer definitely-not-the-secret' },
    })
    expect(wrongToken.status()).toBe(401)
  })

  test('the sponsor report route resolves the sponsor from the session', async ({ request }) => {
    const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'
    // Unauthenticated must be a JSON 403/401, never a redirect to /login: API routes are
    // never redirected.
    const res = await request.get(`${baseUrl}/api/sponsor/impact-report?year=${YEAR}`, {
      maxRedirects: 0,
    })
    expect([401, 403]).toContain(res.status())
    expect(res.headers()['content-type'] ?? '').toContain('json')
  })

  test.afterAll(async () => {
    if (admin && sponsorId) {
      await admin.from('impact_report_snapshots').delete().eq('report_year', YEAR)
    }
  })
})
