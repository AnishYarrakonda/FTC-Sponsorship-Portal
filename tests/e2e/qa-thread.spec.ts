import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { Database } from '../../lib/supabase/types'
import { FIXTURE_PREFIX, createOwnedTeam, deleteOwnedTeam } from '../helpers/fixtures'

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
 *
 * ── Why this suite seeds its own submission ──────────────────────────────────────────
 * It used to open by hunting for any live (dispatched/delivered/opened) submission and
 * skipping when it found none. On a freshly seeded database `submissions` is empty, so all
 * eight tests skipped — and 0085's database enforcement, the whole point of the file, had
 * never once executed. The fixture below provisions the thread's world instead:
 *
 *   - a throwaway coach and the one team it owns (`createOwnedTeam`), because
 *     `guard_submission_message_insert` checks that a coach author owns the submission's
 *     team *before* it checks who may open a thread. Borrowing the shared seeded coach
 *     raises "only the owning coach may write on this thread", so the coach-cannot-open-a-
 *     thread test would fail on the wrong message — and the shared coach's team is also
 *     what golden-path and sponsor-approvals contend over.
 *   - a throwaway sponsor profile, so the sponsor side is a known id rather than whichever
 *     row an unordered `limit(1)` happened to return.
 *   - a live submission AND a terminal one. The terminal case carried its own skip guard
 *     for the same reason, so it is seeded here too.
 *
 * `reserved_amount_cents` is 0 on both submissions. `release_reservation_before_submission_delete`
 * refunds a *live* reservation on DELETE, so a non-zero fixture reservation would hand the
 * sponsor back capacity it never spent and surface as global drift in the two suites that
 * assert `detect_capacity_drift()` returns no rows.
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

  // Fixture ids, all resolved in beforeAll and all torn down in afterAll.
  let sponsorCompanyId: string
  let sponsorProfileId: string
  let coachProfileId: string
  let teamId: string
  let submissionId: string
  let terminalSubmissionId: string
  let tokenId: string

  // Message ids created by the tests themselves.
  let sponsorMessageId: string

  test.beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY)
    anon = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY)

    const tag = `${FIXTURE_PREFIX}-qa-thread-${Date.now()}`

    const { data: sponsor, error: sponsorErr } = await admin
      .from('sponsors')
      .select('id')
      .eq('company_name', 'dev testing')
      .single()
    if (sponsorErr) throw new Error(`fixture sponsor lookup failed: ${sponsorErr.message}`)
    sponsorCompanyId = sponsor!.id

    // No Clerk user backs this profile; nothing signs in as it. It exists so the sponsor
    // half of the thread has a stable author_profile_id that satisfies the FK and the
    // author_role = 'sponsor' check constraint.
    const { data: sponsorProfile, error: spErr } = await admin
      .from('profiles')
      .insert({
        clerk_user_id: `user_${tag}`,
        email: `${tag}@example.com`,
        full_name: 'Fixture Sponsor qa-thread',
        role: 'sponsor',
        sponsor_id: sponsorCompanyId,
      } as never)
      .select('id')
      .single()
    if (spErr) throw new Error(`fixture sponsor profile insert failed: ${spErr.message}`)
    sponsorProfileId = sponsorProfile!.id

    const owned = await createOwnedTeam(admin, { label: 'qa-thread', ftcTeamNumber: 88805 })
    coachProfileId = owned.coachProfileId
    teamId = owned.teamId

    // The live thread. `guard_submission_writable_columns` refuses a non-draft INSERT for
    // ordinary callers, but returns early under `is_trusted_server_context()` — which the
    // service-role key satisfies — so the fixture can land a dispatched row directly.
    const { data: live, error: liveErr } = await admin
      .from('submissions')
      .insert({
        team_id: teamId,
        sponsor_id: sponsorCompanyId,
        status: 'dispatched',
        requested_amount_cents: 50_000,
        reserved_amount_cents: 0,
        sent_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      } as never)
      .select('id')
      .single()
    if (liveErr) throw new Error(`fixture live submission insert failed: ${liveErr.message}`)
    submissionId = live!.id

    // The terminal counterpart. 'expired' is excluded from
    // idx_single_active_submission_per_sponsor, so it coexists with the live row on the
    // same (team_id, sponsor_id) pair without tripping the one-active-submission rule.
    const { data: terminal, error: termErr } = await admin
      .from('submissions')
      .insert({
        team_id: teamId,
        sponsor_id: sponsorCompanyId,
        status: 'expired',
        requested_amount_cents: 50_000,
        reserved_amount_cents: 0,
        sent_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        expires_at: new Date(Date.now() - 16 * 24 * 60 * 60 * 1000).toISOString(),
      } as never)
      .select('id')
      .single()
    if (termErr) throw new Error(`fixture terminal submission insert failed: ${termErr.message}`)
    terminalSubmissionId = terminal!.id

    // A magic-link token for the live submission, so the token-attribution cases have a
    // real row to point at. The hash is a fixture marker, not a hash of anything — nothing
    // ever redeems this token.
    const { data: token, error: tokenErr } = await admin
      .from('submission_access_tokens')
      .insert({
        submission_id: submissionId,
        token_hash: tag,
        expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      } as never)
      .select('id')
      .single()
    if (tokenErr) throw new Error(`fixture access token insert failed: ${tokenErr.message}`)
    tokenId = token!.id
  })

  test('a coach cannot open a thread — the first message must be the sponsor’s', async () => {
    // Clear the thread so this test controls the ordering.
    await admin.from('submission_messages').delete().eq('submission_id', submissionId)

    const { error } = await admin.from('submission_messages').insert({
      submission_id: submissionId,
      author_profile_id: coachProfileId,
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
        author_profile_id: sponsorProfileId,
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
      author_profile_id: coachProfileId,
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
      author_profile_id: coachProfileId,
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
      author_profile_id: sponsorProfileId,
      author_token_id: tokenId,
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
      author_token_id: tokenId,
      author_role: 'coach',
      author_label: 'Test Coach',
      body: 'A coach wearing a token.',
      status: 'pending',
    })
    expect(error?.message).toMatch(/token attribution is sponsor-only/i)
  })

  test('a terminal submission refuses new messages even as service_role', async () => {
    const { error } = await admin.from('submission_messages').insert({
      submission_id: terminalSubmissionId,
      author_profile_id: sponsorProfileId,
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
    const { count } = await admin
      .from('submission_messages')
      .select('id', { count: 'exact', head: true })
      .eq('submission_id', submissionId)

    const toAdd = 50 - (count ?? 0)
    for (let i = 0; i < toAdd; i++) {
      const { error } = await admin.from('submission_messages').insert({
        submission_id: submissionId,
        author_profile_id: sponsorProfileId,
        author_role: 'sponsor',
        author_label: 'Test Sponsor',
        body: `Filler message ${i}.`,
        status: 'released',
      })
      expect(error).toBeNull()
    }

    const { error } = await admin.from('submission_messages').insert({
      submission_id: submissionId,
      author_profile_id: sponsorProfileId,
      author_role: 'sponsor',
      author_label: 'Test Sponsor',
      body: 'One message too many.',
      status: 'released',
    })
    expect(error?.message).toMatch(/message limit/i)
  })

  test.afterAll(async () => {
    if (!admin) return
    // submission_messages and submission_access_tokens both cascade from submissions, but
    // delete them explicitly so a partially-built fixture (a beforeAll that threw halfway)
    // still leaves nothing behind.
    for (const id of [submissionId, terminalSubmissionId]) {
      if (id) await admin.from('submission_messages').delete().eq('submission_id', id)
    }
    if (submissionId) await admin.from('submission_access_tokens').delete().eq('submission_id', submissionId)
    for (const id of [submissionId, terminalSubmissionId]) {
      if (id) await admin.from('submissions').delete().eq('id', id)
    }
    await deleteOwnedTeam(admin, { coachProfileId, teamId })
    if (sponsorProfileId) await admin.from('profiles').delete().eq('id', sponsorProfileId)
  })
})
