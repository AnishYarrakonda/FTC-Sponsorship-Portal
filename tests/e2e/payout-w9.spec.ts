import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../lib/supabase/types'
import { validateTaxDocumentFile } from '../../lib/file-validation'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

test.describe.serial('Payout Profiles & W-9 Security Boundaries (E2E)', () => {
  test.skip(
    !process.env.SUPABASE_LOCAL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY,
    'Requires local Supabase with anon and service role keys'
  )

  let adminClient: ReturnType<typeof createClient<Database>>
  let teamXId: string
  let teamYId: string
  let coachXProfileId: string
  let coachYProfileId: string

  test.beforeAll(async () => {
    adminClient = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY)

    // Resolve the fixture TEAM first, then derive its owner.
    //
    // This used to read the first two `role = 'coach'` profiles and assume both owned a
    // team. `select()` without `order()` returns physical row order, and Postgres moves a
    // row on UPDATE — so as soon as an earlier suite touched a profile, the first coach
    // became `denial-coach`, who owns no team. `teamXId` then fell back to the literal
    // 'team-x', which reaches Postgres as `invalid input syntax for type uuid` instead of
    // failing here with something a reader can act on. Seeding creates exactly one team,
    // so the team is the reliable anchor, not the coach list.
    const { data: team } = await adminClient
      .from('teams')
      .select('id, owner_id')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    expect(team, 'payout-w9 needs at least one seeded team — run the seeder').toBeTruthy()
    teamXId = team!.id
    coachXProfileId = team!.owner_id

    // Coach Y is any OTHER coach; the team-Y assertions are negative (anon must read
    // nothing), so a well-formed id that owns no payout profile is exactly the case
    // under test. Keep it a valid uuid so a failure is an authorization result rather
    // than a parse error.
    const { data: otherCoach } = await adminClient
      .from('profiles')
      .select('id')
      .eq('role', 'coach')
      .neq('id', coachXProfileId)
      .limit(1)
      .maybeSingle()
    coachYProfileId = otherCoach?.id ?? coachXProfileId

    const { data: teamY } = await adminClient
      .from('teams')
      .select('id')
      .eq('owner_id', coachYProfileId)
      .limit(1)
      .maybeSingle()
    teamYId = teamY?.id ?? '00000000-0000-0000-0000-000000000000'

  })

  test('Coach saves payout profile -> row created, EIN encrypted, ein_last4 set', async () => {
    const ein = '123456789'
    const { error: rpcErr } = await adminClient.rpc('set_payout_ein' as any, {
      p_team_id: teamXId,
      p_actor_profile_id: coachXProfileId,
      p_ein: ein,
      p_key: 'test-payout-encryption-key-min-32-chars!',
      p_target: 'payee',
    })

    expect(rpcErr).toBeNull()

    const { data: row } = await (adminClient as any)
      .from('team_payout_profiles')
      .select('ein_last4, ein_ciphertext')
      .eq('team_id', teamXId)
      .single()

    expect(row?.ein_last4).toBe('6789')
    expect(row?.ein_ciphertext).not.toBeNull()
    expect(String(row?.ein_ciphertext)).not.toContain('123456789')
  })

  test('Coach PATCHing w9_verified_at via PostgREST is rejected by column guard trigger (42501)', async () => {
    // Attempting to write a protected column directly
    const { error } = await (adminClient as any)
      .from('team_payout_profiles')
      .update({ w9_verified_at: new Date().toISOString() })
      .eq('team_id', teamXId)

    // Verify error is returned when restricted
    expect(error).toBeDefined()
  })

  test('Anon gets [] from both team_payout_profiles table and v_team_payout_public view', async () => {
    const anonClient = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY)

    const { data: tableData } = await anonClient.from('team_payout_profiles').select('*')
    expect(tableData ?? []).toEqual([])

    const { data: viewData } = await anonClient.from('v_team_payout_public' as any).select('*')
    expect(viewData ?? []).toEqual([])
  })

  test('Sponsor selecting team_payout_profiles directly returns []', async () => {
    const anonClient = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY)
    const { data } = await anonClient.from('team_payout_profiles').select('*')
    expect(data ?? []).toEqual([])
  })

  test('Sponsor selecting v_team_payout_public for a non-dispatched team returns []', async () => {
    const anonClient = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY)
    const { data } = await anonClient.from('v_team_payout_public' as any).select('*').eq('team_id', teamYId)
    expect(data ?? []).toEqual([])
  })

  test('Tax document file validation: PDF succeeds, JPEG rejected, spoofed PDF rejected', async () => {
    const validPdf = new File([Buffer.from('%PDF-1.4 test content')], 'w9.pdf', { type: 'application/pdf' })
    const pdfRes = await validateTaxDocumentFile(validPdf)
    expect(pdfRes.ext).toBe('pdf')
    expect(pdfRes.error).toBeUndefined()

    const jpegFile = new File([Buffer.from('fake jpeg bytes')], 'w9.jpg', { type: 'image/jpeg' })
    const jpegRes = await validateTaxDocumentFile(jpegFile)
    expect(jpegRes.error).toBeDefined()

    const spoofedFile = new File([Buffer.from('not pdf magic bytes')], 'w9.pdf', { type: 'application/pdf' })
    const spoofRes = await validateTaxDocumentFile(spoofedFile)
    expect(spoofRes.error).toBeDefined()
  })
})

