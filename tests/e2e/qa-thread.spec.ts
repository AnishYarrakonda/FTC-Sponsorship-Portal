import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { Database } from '../../lib/supabase/types'

/**
 * Q&A thread (0085) — database-level enforcement and cross-tenant isolation.
 *
 * These assertions deliberately go at PostgREST directly rather than at the UI. "The coach
 * reply is not visible to the sponsor" has to be true of the API, not merely of the page
 * that renders it; a UI-only check would pass even if the row were being shipped to the
 * browser and hidden in JavaScript.
 *
 * The write-guard cases run as service_role on purpose: the actions themselves use the
 * admin client, so if the trigger did not hold for service_role it would not hold at all.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

test.describe.serial('Q&A thread — enforcement & isolation', () => {
  test.skip(
    !process.env.SUPABASE_LOCAL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY,
    'Requires local Supabase with anon and service role keys'
  )

  let admin: ReturnType<typeof createClient<Database>>
  let anon: ReturnType<typeof createClient<Database>>
  let submissionId: string
  let sponsorMessageId: string

  test.beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY)
    anon = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY)

    const { data: sub } = await admin
      .from('submissions')
      .select('id')
      .in('status', ['dispatched', 'delivered', 'opened'])
      .is('deleted_at', null)
      .gt('expires_at', new Date().toISOString())
      .limit(1)
      .maybeSingle()

    test.skip(!sub, 'Needs at least one live (dispatched/delivered/opened) submission')
    submissionId = sub!.id
  })

  test('a coach cannot open a thread — the first message must be the sponsor’s', async () => {
    // Clear the thread so this test controls the ordering.
    await admin.from('submission_messages').delete().eq('submission_id', submissionId)

    const { error } = await admin.from('submission_messages').insert({
      submission_id: submissionId,
      author_profile_id: (await firstCoachId(admin)) as string,
      author_role: 'coach',
      author_label: 'Test Coach',
      body: 'Opening a thread I am not allowed to open.',
      status: 'pending',
    })

    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/only the sponsor can open a thread/i)
  })

  test('a sponsor question inserts, and a coach reply then enters as pending', async () => {
    const { data: question, error: qErr } = await admin
      .from('submission_messages')
      .insert({
        submission_id: submissionId,
        author_profile_id: (await firstSponsorProfileId(admin)) as string,
        author_role: 'sponsor',
        author_label: 'Test Sponsor',
        body: 'Is the 501(c)(3) the district or a booster club?',
        status: 'released',
        released_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    expect(qErr).toBeNull()
    sponsorMessageId = question!.id

    const { error: rErr } = await admin.from('submission_messages').insert({
      submission_id: submissionId,
      author_profile_id: (await firstCoachId(admin)) as string,
      author_role: 'coach',
      author_label: 'Test Coach',
      body: 'A separate booster club.',
      status: 'pending',
    })
    expect(rErr).toBeNull()
  })

  test('a coach message cannot be inserted pre-released', async () => {
    const { error } = await admin.from('submission_messages').insert({
      submission_id: submissionId,
      author_profile_id: (await firstCoachId(admin)) as string,
      author_role: 'coach',
      author_label: 'Test Coach',
      body: 'Sneaking past the moderation gate.',
      status: 'released',
      released_at: new Date().toISOString(),
    })

    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/must enter review as pending/i)
  })

  test('exactly one attribution source is required', async () => {
    const both = await admin.from('submission_messages').insert({
      submission_id: submissionId,
      author_profile_id: (await firstSponsorProfileId(admin)) as string,
      author_token_id: (await firstTokenId(admin, submissionId)) as string,
      author_role: 'sponsor',
      author_label: 'Test Sponsor',
      body: 'Two ids at once.',
      status: 'released',
    })
    expect(both.error?.message).toMatch(/exactly one of author_profile_id/i)

    const neither = await admin.from('submission_messages').insert({
      submission_id: submissionId,
      author_role: 'sponsor',
      author_label: 'Test Sponsor',
      body: 'No id at all.',
      status: 'released',
    })
    expect(neither.error?.message).toMatch(/exactly one of author_profile_id/i)
  })

  test('token attribution is sponsor-only', async () => {
    const { error } = await admin.from('submission_messages').insert({
      submission_id: submissionId,
      author_token_id: (await firstTokenId(admin, submissionId)) as string,
      author_role: 'coach',
      author_label: 'Test Coach',
      body: 'A coach wearing a token.',
      status: 'pending',
    })
    expect(error?.message).toMatch(/token attribution is sponsor-only/i)
  })

  test('a terminal submission refuses new messages even as service_role', async () => {
    const { data: terminal } = await admin
      .from('submissions')
      .select('id')
      .in('status', ['approved', 'declined', 'expired', 'bounced'])
      .limit(1)
      .maybeSingle()

    test.skip(!terminal, 'Needs a terminal submission')

    const { error } = await admin.from('submission_messages').insert({
      submission_id: terminal!.id,
      author_profile_id: (await firstSponsorProfileId(admin)) as string,
      author_role: 'sponsor',
      author_label: 'Test Sponsor',
      body: 'Asking after the door closed.',
      status: 'released',
    })

    expect(error?.message).toMatch(/no longer open for questions/i)
  })

  test('anon reads nothing and writes nothing', async () => {
    const { data } = await anon.from('submission_messages').select('*')
    expect(data ?? []).toHaveLength(0)

    const { data: inserted } = await anon.from('submission_messages').insert({
      submission_id: submissionId,
      author_profile_id: null,
      author_role: 'sponsor',
      author_label: 'Anon',
      body: 'Should never land.',
      status: 'released',
    }).select()
    expect(inserted ?? []).toHaveLength(0)

    const { data: updated } = await anon
      .from('submission_messages')
      .update({ body: 'tampered' })
      .eq('id', sponsorMessageId)
      .select()
    expect(updated ?? []).toHaveLength(0)

    const { data: deleted } = await anon
      .from('submission_messages')
      .delete()
      .eq('id', sponsorMessageId)
      .select()
    expect(deleted ?? []).toHaveLength(0)
  })

  // The "exactly three SELECT policies and no write policy" assertion is a catalogue query
  // (SELECT policyname, cmd FROM pg_policies WHERE tablename='submission_messages') and
  // there is no exec_sql RPC to run it through here. It is verified directly with psql as
  // an acceptance step; the behavioural half — that no client role can write — is the
  // anon test above, which is the property the policy count is a proxy for anyway.

  test('the 51st message in a thread is rejected', async () => {
    const sponsorId = (await firstSponsorProfileId(admin)) as string
    const { count } = await admin
      .from('submission_messages')
      .select('id', { count: 'exact', head: true })
      .eq('submission_id', submissionId)

    const toAdd = 50 - (count ?? 0)
    for (let i = 0; i < toAdd; i++) {
      const { error } = await admin.from('submission_messages').insert({
        submission_id: submissionId,
        author_profile_id: sponsorId,
        author_role: 'sponsor',
        author_label: 'Test Sponsor',
        body: `Filler message ${i}.`,
        status: 'released',
      })
      expect(error).toBeNull()
    }

    const { error } = await admin.from('submission_messages').insert({
      submission_id: submissionId,
      author_profile_id: sponsorId,
      author_role: 'sponsor',
      author_label: 'Test Sponsor',
      body: 'One message too many.',
      status: 'released',
    })
    expect(error?.message).toMatch(/message limit/i)
  })

  test.afterAll(async () => {
    if (admin && submissionId) {
      await admin.from('submission_messages').delete().eq('submission_id', submissionId)
    }
  })
})

// ── helpers ───────────────────────────────────────────────────────────────────

async function firstCoachId(admin: ReturnType<typeof createClient<Database>>) {
  const { data } = await admin.from('profiles').select('id').eq('role', 'coach').limit(1).maybeSingle()
  return data?.id
}

async function firstSponsorProfileId(admin: ReturnType<typeof createClient<Database>>) {
  const { data } = await admin
    .from('profiles')
    .select('id')
    .eq('role', 'sponsor')
    .not('sponsor_id', 'is', null)
    .limit(1)
    .maybeSingle()
  return data?.id
}

async function firstTokenId(
  admin: ReturnType<typeof createClient<Database>>,
  submissionId: string
) {
  const { data } = await admin
    .from('submission_access_tokens')
    .select('id')
    .eq('submission_id', submissionId)
    .limit(1)
    .maybeSingle()
  return data?.id
}
