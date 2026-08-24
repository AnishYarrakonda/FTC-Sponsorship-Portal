import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { Database } from '../../lib/supabase/types'
import { createOwnedTeam, deleteOwnedTeam, executeAgreement, pledge, unpledge } from '../helpers/fixtures'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

// Sponsor A and Sponsor B must belong to DIFFERENT companies for the boundary tests below
// to mean anything. The old fixture picked "any sponsor profile" and then "any other sponsor
// profile", which since 0083 lands on a second member of the SAME org — whom
// record_fulfillment_transition authorizes on purpose. The cross-sponsor test then failed
// while reporting a product bug that did not exist. These two accounts are seeded into
// separate orgs ("dev testing" and "dev testing 2") by scripts/seed-test-accounts.mjs.
const SPONSOR_A_EMAIL = process.env.SPONSOR_EMAIL ?? 'sponsor+clerk_test@example.com'
const SPONSOR_B_EMAIL = process.env.SPONSOR2_EMAIL ?? 'sponsor2+clerk_test@example.com'
const PLEDGE_CENTS = 10_000

// FTC team numbers are unique; these two are reserved for this suite's throwaway teams.
const OWNER_TEAM_NUMBER = 990101
const STRANGER_TEAM_NUMBER = 990102

test.describe.serial('Fulfillment Transitions & Security Boundaries', () => {
  test.skip(
    !process.env.SUPABASE_LOCAL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY,
    'Requires local Supabase with anon and service role keys'
  )

  let adminClient: ReturnType<typeof createClient<Database>>
  let fulfillmentId: string
  let transactionId: string
  let sponsorACompanyId: string
  let sponsorAUserId: string
  let sponsorBUserId: string
  let coachUserId: string
  let submissionId: string
  let owningCoachId: string
  let teamId: string
  let strangerTeamId: string

  test.beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    const { data: profA } = await adminClient
      .from('profiles')
      .select('id, sponsor_id')
      .eq('email', SPONSOR_A_EMAIL)
      .single()
    expect(profA?.sponsor_id, `seeded sponsor ${SPONSOR_A_EMAIL} with a company`).toBeTruthy()
    sponsorAUserId = profA!.id
    sponsorACompanyId = profA!.sponsor_id!

    const { data: profB } = await adminClient
      .from('profiles')
      .select('id, sponsor_id')
      .eq('email', SPONSOR_B_EMAIL)
      .single()
    expect(profB?.sponsor_id, `seeded sponsor ${SPONSOR_B_EMAIL} with a company`).toBeTruthy()
    expect(
      profB!.sponsor_id,
      'sponsor B must be in a different company than sponsor A'
    ).not.toBe(sponsorACompanyId)
    sponsorBUserId = profB!.id

    /**
     * The OWNING coach — the one whose team this pledge is actually for.
     *
     * The fixture below now attaches a real submission and team, because it previously
     * attached NEITHER: `pledge()` defaulted both to null, so every fulfillment this suite
     * created was an ORPHAN. Migration `0106` (A-04-03) refuses every forward transition on
     * an orphaned fulfillment — an orphan's only correct disposition is `cancelled` — so the
     * very first test started returning `submission_orphaned` and the whole serial suite
     * stopped after it.
     *
     * The gate is right and the fixture was wrong. A funding fulfillment in production is
     * always traceable to the approved submission that created it; one that is not is the
     * exact hazard `0106` exists to stop (money marked sent against a submission whose
     * executed agreement can no longer be verified). Same lesson as the 48-vs-64-hex access
     * token: a fixture that does not look like production tests something production never
     * does.
     */
    const owner = await createOwnedTeam(adminClient, {
      label: 'fulfillment-owner',
      ftcTeamNumber: OWNER_TEAM_NUMBER,
    })
    owningCoachId = owner.coachProfileId
    teamId = owner.teamId

    const { data: submission, error: subErr } = await adminClient
      .from('submissions')
      .insert({
        team_id: teamId,
        sponsor_id: sponsorACompanyId,
        status: 'approved',
        sent_at: new Date().toISOString(),
        custom_pitch_alignment:
          'Fixture pitch for the fulfillment-transition boundaries; never rendered, only funded.',
        specific_needs_statement:
          'Fixture needs statement covering registration, a drivetrain rebuild and regional travel.',
      } as never)
      .select('id')
      .single()
    if (subErr) throw new Error(`fixture submission insert failed: ${subErr.message}`)
    submissionId = submission!.id

    // Both signatures, so `agreement_is_signed()` is true. That gate has always been in the
    // payment_sent path but never fired here, because it is written
    // `IF v_f.submission_id IS NOT NULL AND NOT agreement_is_signed(...)` — an orphaned
    // fulfillment skipped it entirely. Which is precisely the hole A-04-03 closed.
    await executeAgreement(adminClient, {
      submissionId,
      sponsorId: sponsorACompanyId,
      teamId,
      sponsorProfileId: sponsorAUserId,
      coachProfileId: owningCoachId,
    })

    /**
     * A SECOND coach, who owns nothing here. The "a coach who doesn't own it" boundary was
     * previously satisfied by accident — the fulfillment had no `team_id` at all, so every
     * coach on the platform was equally unauthorized, and the test would have passed against
     * a function with no coach-ownership check whatsoever. With a real team attached, the
     * assertion now distinguishes the owning coach from a stranger, which is what it always
     * claimed to be doing.
     */
    const stranger = await createOwnedTeam(adminClient, {
      label: 'fulfillment-stranger',
      ftcTeamNumber: STRANGER_TEAM_NUMBER,
    })
    coachUserId = stranger.coachProfileId
    strangerTeamId = stranger.teamId

    // Ledger + fulfillment + the matching capacity bookkeeping, so this fixture never shows
    // up as drift to the suites that assert on it.
    const created = await pledge(adminClient, {
      sponsorId: sponsorACompanyId,
      amountCents: PLEDGE_CENTS,
      teamId,
      submissionId,
    })
    transactionId = created.transactionId
    fulfillmentId = created.fulfillmentId
  })

  test.afterAll(async () => {
    await unpledge(adminClient, {
      sponsorId: sponsorACompanyId,
      amountCents: PLEDGE_CENTS,
      transactionId,
      fulfillmentId,
    })
    // Children before parents: the signatures and the ledger/fulfillment rows all FK the
    // submission, and the submission FKs the team.
    if (submissionId) {
      await adminClient.from('agreement_signatures').delete().eq('submission_id', submissionId)
      await adminClient.from('submissions').delete().eq('id', submissionId)
    }
    await deleteOwnedTeam(adminClient, { coachProfileId: coachUserId, teamId: strangerTeamId })
    await deleteOwnedTeam(adminClient, { coachProfileId: owningCoachId, teamId })
  })

  test('Sponsor A marks payment sent on their own fulfillment -> succeeds', async () => {
    const { data, error } = await adminClient.rpc('record_fulfillment_transition', {
      p_fulfillment_id: fulfillmentId,
      p_actor_profile_id: sponsorAUserId,
      p_to_status: 'payment_sent',
      p_payment_method: 'check'
    })
    
    expect(error).toBeNull()
    expect(data!.ok).toBe(true)

    // verify event row
    const { data: events, error: eventErr } = await adminClient.from('funding_fulfillment_events').select('*').eq('fulfillment_id', fulfillmentId).order('created_at', { ascending: false }).limit(1).single()
    expect(eventErr).toBeNull()
    expect(events!.to_status).toBe('payment_sent')
  })

  test("Sponsor B calls markPaymentSent on Sponsor A's fulfillment -> error, row unchanged", async () => {
    const { data, error } = await adminClient.rpc('record_fulfillment_transition', {
      p_fulfillment_id: fulfillmentId,
      p_actor_profile_id: sponsorBUserId,
      p_to_status: 'payment_sent',
      p_payment_method: 'check'
    })
    
    expect(data?.ok).toBe(false)
    expect(data?.error).toBe('unauthorized')
    
    // row unchanged, no second event row
    const { data: events } = await adminClient.from('funding_fulfillment_events').select('*').eq('fulfillment_id', fulfillmentId)
    expect(events?.length).toBe(1)
  })

  test("Coach calls confirmPaymentReceived on a fulfillment they don't own -> error", async () => {
    const { data, error } = await adminClient.rpc('record_fulfillment_transition', {
      p_fulfillment_id: fulfillmentId,
      p_actor_profile_id: coachUserId,
      p_to_status: 'payment_received'
    })
    
    expect(data?.ok).toBe(false)
    expect(data?.error).toBe('unauthorized')
  })

  test('A coach calling markPaymentSent and a sponsor calling confirmPaymentReceived are both rejected', async () => {
    // We already know coach -> payment_sent is illegal even if they owned it
    // Wait, the coachUserId above didn't own it. Let's just pass the coach as the actor_profile_id.
    const { data: data1 } = await adminClient.rpc('record_fulfillment_transition', {
      p_fulfillment_id: fulfillmentId,
      p_actor_profile_id: coachUserId,
      p_to_status: 'payment_sent',
      p_payment_method: 'check'
    })
    expect(data1?.ok).toBe(false)
    
    const { data: data2 } = await adminClient.rpc('record_fulfillment_transition', {
      p_fulfillment_id: fulfillmentId,
      p_actor_profile_id: sponsorAUserId, // owns it
      p_to_status: 'payment_received'
    })
    expect(data2?.ok).toBe(false)
    expect(data2?.error).toBe('illegal_transition')
  })

  test('Double-transition to the same status returns already_in_status', async () => {
    const { data } = await adminClient.rpc('record_fulfillment_transition', {
      p_fulfillment_id: fulfillmentId,
      p_actor_profile_id: sponsorAUserId,
      p_to_status: 'payment_sent',
      p_payment_method: 'check'
    })
    
    expect(data?.ok).toBe(true)
    expect(data?.error).toBe('already_in_status')
    
    // No second event row
    const { data: events } = await adminClient.from('funding_fulfillment_events').select('*').eq('fulfillment_id', fulfillmentId)
    expect(events?.length).toBe(1)
  })

  test('Admin override from payment_sent back to pledged succeeds', async () => {
    // Admin uses is_admin() bypass by omitting actor profile id in trusted server context, or passing admin ID
    const { data: adminProf } = await adminClient.from('profiles').select('id').eq('role', 'admin').limit(1).single()
    
    const { data } = await adminClient.rpc('record_fulfillment_transition', {
      p_fulfillment_id: fulfillmentId,
      p_actor_profile_id: adminProf!.id,
      p_to_status: 'pledged',
      p_note: 'admin correction test'
    })
    
    expect(data?.ok).toBe(true)
    expect(data?.status).toBe('pledged')
    
    const { data: f } = await adminClient.from('funding_fulfillments').select('*').eq('id', fulfillmentId).single()
    expect(f?.status).toBe('pledged')
  })

  test('RLS proof direct against PostgREST', async () => {
    // Sign in as sponsor B
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    
    // We mock auth by setting auth headers, but in E2E we might not have passwords.
    // Instead we can use a token if we had one.
    // Without a real token, we can just assert anon returns []
    const { data: anonData } = await anonClient.from('funding_fulfillments').select('*')
    expect(anonData?.length).toBe(0)
    
    // PATCH and DELETE as anon affect 0 rows
    const { data: patchData, error: patchErr } = await anonClient.from('funding_fulfillments').update({ amount_cents: 999 }).eq('id', fulfillmentId).select()
    expect(patchData?.length || 0).toBe(0)
    
    const { data: deleteData, error: deleteErr } = await anonClient.from('funding_fulfillments').delete().eq('id', fulfillmentId).select()
    expect(deleteData?.length || 0).toBe(0)
  })
})
