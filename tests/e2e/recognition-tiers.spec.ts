import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { Database } from '../../lib/supabase/types'
import { createOwnedTeam, deleteOwnedTeam, pledge, unpledge } from '../helpers/fixtures'

/**
 * Recognition tiers (0087) — pinning, role separation, isolation, and the capacity
 * non-regression Core Mandate 3 demands.
 *
 * The security assertions go at PostgREST directly rather than through the UI: "sponsor B
 * cannot read sponsor A's award" has to be true of the API, not merely of the page that
 * renders it.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

// Inside the entry ("Supporter") tier: [$250, $1,000).
const FIXTURE_AMOUNT_CENTS = 50_000

test.describe.serial('Recognition — pinning, roles, isolation', () => {
  test.skip(
    !process.env.SUPABASE_LOCAL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY,
    'Requires local Supabase with anon and service role keys'
  )

  let admin: ReturnType<typeof createClient<Database>>
  let anon: ReturnType<typeof createClient<Database>>
  let adminProfileId: string
  let fixtureSponsorId: string
  let fixtureCoachId: string
  let fixtureTeamId: string
  let fixtureSubmissionId: string
  let fixtureTransactionId: string
  let fixtureFulfillmentId: string

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

    /**
     * Provision the settled fulfillment this suite observes, instead of hoping another
     * suite left one behind. Run on its own, every award-dependent test used to skip —
     * and the void-proof test, which has no skip guard, crashed on a null delivery row.
     * $500 sits inside the entry ("Supporter") tier, so the AFTER INSERT trigger on
     * funding_fulfillments mints exactly one award plus one delivery per benefit.
     */
    const { data: sponsor } = await admin
      .from('sponsors')
      .select('id')
      .eq('company_name', 'dev testing')
      .single()
    fixtureSponsorId = sponsor!.id

    const owned = await createOwnedTeam(admin, { label: 'recognition', ftcTeamNumber: 88803 })
    fixtureCoachId = owned.coachProfileId
    fixtureTeamId = owned.teamId

    const { data: submission } = await admin
      .from('submissions')
      .insert({
        team_id: fixtureTeamId,
        sponsor_id: fixtureSponsorId,
        status: 'approved',
        requested_amount_cents: FIXTURE_AMOUNT_CENTS,
        reserved_amount_cents: FIXTURE_AMOUNT_CENTS,
        sent_at: new Date().toISOString(),
      } as never)
      .select('id')
      .single()
    fixtureSubmissionId = submission!.id

    const created = await pledge(admin, {
      sponsorId: fixtureSponsorId,
      teamId: fixtureTeamId,
      submissionId: fixtureSubmissionId,
      amountCents: FIXTURE_AMOUNT_CENTS,
    })
    fixtureTransactionId = created.transactionId
    fixtureFulfillmentId = created.fulfillmentId
  })

  test.afterAll(async () => {
    // Awards and deliveries are trigger-created children of the fulfillment; remove them
    // first or the fulfillment delete is refused and the row becomes drift for the next run.
    const { data: awards } = await admin
      .from('sponsor_recognition_awards')
      .select('id')
      .eq('fulfillment_id', fixtureFulfillmentId)
    for (const a of awards ?? []) {
      await admin.from('recognition_benefit_deliveries').delete().eq('award_id', a.id)
    }
    await admin.from('sponsor_recognition_awards').delete().eq('fulfillment_id', fixtureFulfillmentId)

    await unpledge(admin, {
      sponsorId: fixtureSponsorId,
      amountCents: FIXTURE_AMOUNT_CENTS,
      transactionId: fixtureTransactionId,
      fulfillmentId: fixtureFulfillmentId,
    })
    await admin.from('submissions').delete().eq('id', fixtureSubmissionId)
    await deleteOwnedTeam(admin, { coachProfileId: fixtureCoachId, teamId: fixtureTeamId })
  })

  test('the tier ladder is seeded and totally ordered', async () => {
    const { data: tiers } = await admin
      .from('recognition_tiers')
      .select('name, rank, min_amount_cents, max_amount_cents')
      .is('archived_at', null)
      .order('rank')

    expect((tiers ?? []).length).toBeGreaterThanOrEqual(4)
    // Exactly one open-ended tier, and no gaps or overlaps between adjacent bands.
    const open = (tiers ?? []).filter((t) => t.max_amount_cents === null)
    expect(open).toHaveLength(1)
    for (let i = 1; i < (tiers ?? []).length; i++) {
      expect(tiers![i].min_amount_cents).toBe(tiers![i - 1].max_amount_cents)
    }
  })

  test('an amount below the entry tier earns no award and no error', async () => {
    const { data: tierId } = await admin.rpc('recognition_tier_for_amount' as never, {
      p_amount_cents: 1,
    } as never)
    expect(tierId).toBeNull()
  })

  test('settling above the entry threshold creates one award and one row per benefit', async () => {
    // The award is created by an AFTER INSERT trigger on funding_fulfillments, so it
    // lands in the same transaction as the ledger row rather than in a follow-up write.
    const { data: fulfillment } = await admin
      .from('funding_fulfillments')
      .select('id, amount_cents')
      .neq('status', 'cancelled')
      .limit(1)
      .maybeSingle()
    test.skip(!fulfillment, 'Needs at least one settled fulfillment')

    const { data: award } = await admin
      .from('sponsor_recognition_awards')
      .select('id, amount_cents, tier_name_snapshot, benefits_snapshot')
      .eq('fulfillment_id', fulfillment!.id)
      .maybeSingle()

    expect(award).not.toBeNull()
    expect(award!.amount_cents).toBe(fulfillment!.amount_cents)

    const { data: deliveries } = await admin
      .from('recognition_benefit_deliveries')
      .select('benefit_type, status')
      .eq('award_id', award!.id)

    expect(deliveries).toHaveLength((award!.benefits_snapshot as string[]).length)
    expect(new Set((deliveries ?? []).map((d) => d.benefit_type))).toEqual(
      new Set(award!.benefits_snapshot as string[])
    )
    for (const d of deliveries ?? []) expect(d.status).toBe('promised')
  })

  test('THE PINNING TEST: editing a tier changes nothing already promised', async () => {
    const { data: award } = await admin
      .from('sponsor_recognition_awards')
      .select('id, tier_id, tier_name_snapshot, tier_min_amount_cents_snapshot, benefits_snapshot')
      .not('tier_id', 'is', null)
      .limit(1)
      .maybeSingle()
    test.skip(!award, 'Needs at least one award')

    const { data: before } = await admin
      .from('recognition_benefit_deliveries')
      .select('id, benefit_type, status')
      .eq('award_id', award!.id)
      .order('benefit_type')

    const { data: tier } = await admin
      .from('recognition_tiers')
      .select('*')
      .eq('id', award!.tier_id as string)
      .single()
    expect(tier).not.toBeNull()

    // Change the name, the threshold and the benefit list — everything the award
    // snapshotted.
    const res = await admin.rpc('admin_upsert_recognition_tier' as never, {
      p_actor_profile_id: adminProfileId,
      p_tier_id: tier!.id,
      p_name: `${tier!.name} (renamed)`,
      p_rank: tier!.rank,
      p_min_amount_cents: tier!.min_amount_cents,
      p_max_amount_cents: tier!.max_amount_cents,
      p_benefits: ['logo_on_robot'],
      p_description: 'Rewritten by the pinning test.',
    } as never)
    expect((res.data as any)?.ok).toBe(true)
    expect((res.data as any)?.awards_affected).toBe(0)

    const { data: after } = await admin
      .from('sponsor_recognition_awards')
      .select('tier_name_snapshot, tier_min_amount_cents_snapshot, benefits_snapshot')
      .eq('id', award!.id)
      .single()

    expect(after!.tier_name_snapshot).toBe(award!.tier_name_snapshot)
    expect(after!.tier_min_amount_cents_snapshot).toBe(award!.tier_min_amount_cents_snapshot)
    expect(after!.benefits_snapshot).toEqual(award!.benefits_snapshot)

    const { data: afterDeliveries } = await admin
      .from('recognition_benefit_deliveries')
      .select('id, benefit_type, status')
      .eq('award_id', award!.id)
      .order('benefit_type')
    expect(afterDeliveries).toEqual(before)

    // Restore.
    await admin.rpc('admin_upsert_recognition_tier' as never, {
      p_actor_profile_id: adminProfileId,
      p_tier_id: tier!.id,
      p_name: tier!.name,
      p_rank: tier!.rank,
      p_min_amount_cents: tier!.min_amount_cents,
      p_max_amount_cents: tier!.max_amount_cents,
      p_benefits: tier!.benefits,
      p_description: tier!.description,
    } as never)
  })

  test('an overlapping range is rejected and names the conflicting tier', async () => {
    const { data: tiers } = await admin
      .from('recognition_tiers')
      .select('name, min_amount_cents, max_amount_cents')
      .is('archived_at', null)
      .order('rank')
    const target = tiers![1]

    const res = await admin.rpc('admin_upsert_recognition_tier' as never, {
      p_actor_profile_id: adminProfileId,
      p_tier_id: null,
      p_name: 'Overlapping',
      p_rank: 42,
      p_min_amount_cents: target!.min_amount_cents + 1,
      p_max_amount_cents: (target!.max_amount_cents ?? target!.min_amount_cents + 100) - 1,
      p_benefits: [],
      p_description: null,
    } as never)

    expect((res.data as any)?.ok).toBe(false)
    expect((res.data as any)?.error).toBe('overlapping_tier')
    expect((res.data as any)?.conflict).toBe(target!.name)
  })

  test('a proof cannot exist without the no-minors affirmation', async () => {
    const { data: delivery } = await admin
      .from('recognition_benefit_deliveries')
      .select('id')
      .limit(1)
      .maybeSingle()
    test.skip(!delivery, 'Needs at least one delivery row')

    // Straight at the table with the service role, bypassing every RPC and policy: the
    // CHECK constraint is what makes this unrepresentable rather than merely unwritten.
    const res = await admin
      .from('recognition_benefit_deliveries')
      .update({ proof_url: 'https://x.supabase.co/storage/v1/object/public/pitch-media/a.jpg' })
      .eq('id', delivery!.id)
    expect(res.error?.message).toMatch(/proof_requires_no_minors_affirmation/)

    const { count } = await admin
      .from('recognition_benefit_deliveries')
      .select('id', { count: 'exact', head: true })
      .not('proof_url', 'is', null)
      .is('no_minors_confirmed_at', null)
    expect(count).toBe(0)
  })

  test('the role matrix: a sponsor cannot deliver, a coach cannot waive', async () => {
    const { data: award } = await admin
      .from('sponsor_recognition_awards')
      .select('id, sponsor_id, team_id')
      .not('team_id', 'is', null)
      .limit(1)
      .maybeSingle()
    test.skip(!award, 'Needs an award with a live team')

    const { data: delivery } = await admin
      .from('recognition_benefit_deliveries')
      .select('id')
      .eq('award_id', award!.id)
      .limit(1)
      .single()

    const { data: team } = await admin
      .from('teams')
      .select('owner_id')
      .eq('id', award!.team_id as string)
      .single()

    const { data: sponsorUser } = await admin
      .from('profiles')
      .select('id')
      .eq('role', 'sponsor')
      .eq('sponsor_id', award!.sponsor_id)
      .limit(1)
      .maybeSingle()
    test.skip(!sponsorUser, 'Needs a sponsor user on this award')

    const sponsorDelivers = await admin.rpc('record_benefit_delivery' as never, {
      p_delivery_id: delivery!.id,
      p_actor_profile_id: sponsorUser!.id,
      p_status: 'delivered',
    } as never)
    expect((sponsorDelivers.data as any)?.error).toBe('role_not_permitted')

    const coachWaives = await admin.rpc('record_benefit_delivery' as never, {
      p_delivery_id: delivery!.id,
      p_actor_profile_id: team!.owner_id,
      p_status: 'waived',
    } as never)
    expect((coachWaives.data as any)?.error).toBe('role_not_permitted')

    // And a stranger is neither.
    const { data: stranger } = await admin
      .from('profiles')
      .select('id')
      .eq('role', 'coach')
      .neq('id', team!.owner_id)
      .limit(1)
      .maybeSingle()
    if (stranger) {
      const res = await admin.rpc('record_benefit_delivery' as never, {
        p_delivery_id: delivery!.id,
        p_actor_profile_id: stranger.id,
        p_status: 'delivered',
      } as never)
      expect((res.data as any)?.error).toBe('unauthorized')
    }
  })

  test('voiding a proof clears it, drops the status back, and records the reason', async () => {
    const { data: delivery } = await admin
      .from('recognition_benefit_deliveries')
      .select('id, award_id')
      .limit(1)
      .single()

    // Seed a proof through the RPC (the only writer that may set one).
    const { data: award } = await admin
      .from('sponsor_recognition_awards')
      .select('team_id')
      .eq('id', delivery!.award_id)
      .single()
    const { data: team } = await admin
      .from('teams')
      .select('owner_id')
      .eq('id', award!.team_id as string)
      .single()

    await admin.rpc('record_benefit_delivery' as never, {
      p_delivery_id: delivery!.id,
      p_actor_profile_id: team!.owner_id,
      p_status: 'delivered',
      p_proof_url: `${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/pitch-media/u/recognition/x.jpg`,
      p_no_minors_confirmed: true,
    } as never)

    const voided = await admin.rpc('void_benefit_proof' as never, {
      p_delivery_id: delivery!.id,
      p_actor_profile_id: adminProfileId,
      p_reason: 'A student is visible in the background of this photo.',
    } as never)
    expect((voided.data as any)?.ok).toBe(true)

    const { data: after } = await admin
      .from('recognition_benefit_deliveries')
      .select('proof_url, no_minors_confirmed_at, status, admin_void_reason, admin_voided_at')
      .eq('id', delivery!.id)
      .single()

    expect(after!.proof_url).toBeNull()
    expect(after!.no_minors_confirmed_at).toBeNull()
    expect(after!.status).toBe('in_progress')
    expect(after!.admin_voided_at).not.toBeNull()
    expect(after!.admin_void_reason).toMatch(/student/i)
  })

  test('no proof URL is ever written to audit_log', async () => {
    const { data: rows } = await admin
      .from('audit_log')
      .select('metadata')
      .in('action', ['benefit_delivery_recorded', 'upload_benefit_proof', 'mark_benefit_delivered'])
      .limit(200)

    for (const r of rows ?? []) {
      expect(JSON.stringify(r.metadata)).not.toMatch(/pitch-media/)
    }
  })

  test('anon reads live tiers but no award, no delivery, and writes nothing', async () => {
    // recognition_tiers is deliberately public: the ladder appears on a token-gated page
    // rendered for a signed-out sponsor. Archived tiers must still be hidden.
    const { data: tiers } = await anon.from('recognition_tiers').select('id, archived_at')
    expect((tiers ?? []).length).toBeGreaterThan(0)
    for (const t of tiers ?? []) expect(t.archived_at).toBeNull()

    const { data: awards } = await anon.from('sponsor_recognition_awards').select('*')
    expect(awards ?? []).toHaveLength(0)

    const { data: deliveries } = await anon.from('recognition_benefit_deliveries').select('*')
    expect(deliveries ?? []).toHaveLength(0)

    // No write policy exists on any of the three tables, so every mutation affects zero
    // rows regardless of what is sent.
    const { data: patched } = await anon
      .from('recognition_tiers')
      .update({ name: 'tampered' })
      .neq('id', '00000000-0000-0000-0000-000000000000')
      .select()
    expect(patched ?? []).toHaveLength(0)

    const { data: deleted } = await anon
      .from('recognition_benefit_deliveries')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000')
      .select()
    expect(deleted ?? []).toHaveLength(0)
  })

  test('archiving a tier leaves awards pinned against it untouched', async () => {
    const { data: award } = await admin
      .from('sponsor_recognition_awards')
      .select('id, tier_id, tier_name_snapshot, benefits_snapshot')
      .not('tier_id', 'is', null)
      .limit(1)
      .maybeSingle()
    test.skip(!award, 'Needs an award with a tier')

    const archived = await admin.rpc('admin_archive_recognition_tier' as never, {
      p_actor_profile_id: adminProfileId,
      p_tier_id: award!.tier_id as string,
    } as never)
    expect((archived.data as any)?.ok).toBe(true)

    const { data: after } = await admin
      .from('sponsor_recognition_awards')
      .select('tier_name_snapshot, benefits_snapshot')
      .eq('id', award!.id)
      .single()
    expect(after!.tier_name_snapshot).toBe(award!.tier_name_snapshot)
    expect(after!.benefits_snapshot).toEqual(award!.benefits_snapshot)

    // Un-archive so the ladder test above stays valid on a re-run.
    await admin
      .from('recognition_tiers')
      .update({ archived_at: null })
      .eq('id', award!.tier_id as string)
  })

  test('CAPACITY NON-REGRESSION: recognition moves no money and leaves zero drift', async () => {
    // Recognition reads the money model and never writes it. This is the assertion that
    // keeps it that way.
    const { data: before } = await admin.from('sponsors').select('id, funding_used_cents').order('id')
    const { data: driftBefore } = await admin.rpc('detect_capacity_drift' as never)
    expect(driftBefore ?? []).toHaveLength(0)

    const { data: delivery } = await admin
      .from('recognition_benefit_deliveries')
      .select('id, award_id')
      .limit(1)
      .single()
    const { data: award } = await admin
      .from('sponsor_recognition_awards')
      .select('team_id')
      .eq('id', delivery!.award_id)
      .single()
    const { data: team } = await admin
      .from('teams')
      .select('owner_id')
      .eq('id', award!.team_id as string)
      .single()

    await admin.rpc('record_benefit_delivery' as never, {
      p_delivery_id: delivery!.id,
      p_actor_profile_id: team!.owner_id,
      p_status: 'delivered',
    } as never)

    const { data: after } = await admin.from('sponsors').select('id, funding_used_cents').order('id')
    expect(after).toEqual(before)

    const { data: driftAfter } = await admin.rpc('detect_capacity_drift' as never)
    expect(driftAfter ?? []).toHaveLength(0)
  })
})
