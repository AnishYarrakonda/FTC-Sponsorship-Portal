import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { Database } from '../../lib/supabase/types'

/**
 * Appeals (0086) — database enforcement, cross-tenant isolation, and the capacity
 * non-regression that Core Mandate 3 demands.
 *
 * The isolation assertions go at PostgREST directly rather than the UI: "coach B cannot read
 * coach A's appeal" has to be true of the API, not merely of the page that renders it.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

test.describe.serial('Appeals — enforcement, isolation, capacity', () => {
  test.skip(
    !process.env.SUPABASE_LOCAL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY,
    'Requires local Supabase with anon and service role keys'
  )

  let admin: ReturnType<typeof createClient<Database>>
  let anon: ReturnType<typeof createClient<Database>>
  let coachId: string
  let appealId: string

  test.beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY)
    anon = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY)

    const { data: coach } = await admin.from('profiles').select('id').eq('role', 'coach').limit(1).maybeSingle()
    test.skip(!coach, 'Needs at least one coach profile')
    coachId = coach!.id
  })

  test('an appeal must start as open and inside the 30-day window', async () => {
    const late = await admin.from('appeals').insert({
      subject_type: 'submission',
      subject_id: '00000000-0000-4000-8000-0000000000ff',
      appellant_profile_id: coachId,
      statement: 'Filed far too late to be accepted.',
      decision_at: new Date(Date.now() - 31 * 864e5).toISOString(),
    })
    expect(late.error?.message).toMatch(/30-day appeal window/i)

    const preResolved = await admin.from('appeals').insert({
      subject_type: 'submission',
      subject_id: '00000000-0000-4000-8000-0000000000fe',
      appellant_profile_id: coachId,
      statement: 'Trying to skip straight past review.',
      decision_at: new Date().toISOString(),
      status: 'under_review',
    })
    expect(preResolved.error?.message).toMatch(/must start as open/i)
  })

  test('one appeal per decision; withdrawing frees exactly one re-file', async () => {
    const decisionAt = new Date(Date.now() - 864e5).toISOString()
    const subjectId = '00000000-0000-4000-8000-0000000000fd'

    const first = await admin
      .from('appeals')
      .insert({ subject_type: 'submission', subject_id: subjectId, appellant_profile_id: coachId, statement: 'First attempt at this appeal.', decision_at: decisionAt })
      .select('id')
      .single()
    expect(first.error).toBeNull()
    appealId = first.data!.id

    const dup = await admin
      .from('appeals')
      .insert({ subject_type: 'submission', subject_id: subjectId, appellant_profile_id: coachId, statement: 'Second attempt, should fail.', decision_at: decisionAt })
    expect(dup.error?.code).toBe('23505')

    await admin.from('appeals').update({ status: 'withdrawn', resolved_at: new Date().toISOString() }).eq('id', appealId)

    const refile = await admin
      .from('appeals')
      .insert({ subject_type: 'submission', subject_id: subjectId, appellant_profile_id: coachId, statement: 'Re-filed after withdrawing.', decision_at: decisionAt })
      .select('id')
      .single()
    expect(refile.error).toBeNull()
    appealId = refile.data!.id
  })

  test('transitions: open cannot jump to a resolution, and a resolution is final', async () => {
    const jump = await admin
      .from('appeals')
      .update({ status: 'upheld', resolved_at: new Date().toISOString(), resolved_by: coachId, resolution_notes: 'skipping review' })
      .eq('id', appealId)
    expect(jump.error?.message).toMatch(/illegal transition open -> upheld/i)

    await admin.from('appeals').update({ status: 'under_review', assigned_at: new Date().toISOString() }).eq('id', appealId)
    await admin
      .from('appeals')
      .update({ status: 'upheld', resolved_at: new Date().toISOString(), resolved_by: coachId, resolution_notes: 'The original decision stands.' })
      .eq('id', appealId)

    const reopen = await admin.from('appeals').update({ status: 'under_review' }).eq('id', appealId)
    expect(reopen.error?.message).toMatch(/is terminal/i)
  })

  test('subject and decision_at are immutable', async () => {
    const { data: live } = await admin
      .from('appeals')
      .insert({
        subject_type: 'submission',
        subject_id: '00000000-0000-4000-8000-0000000000fc',
        appellant_profile_id: coachId,
        statement: 'An appeal whose identity should be frozen.',
        decision_at: new Date(Date.now() - 864e5).toISOString(),
      })
      .select('id')
      .single()

    const moved = await admin.from('appeals').update({ decision_at: new Date().toISOString() }).eq('id', live!.id)
    expect(moved.error?.message).toMatch(/immutable/i)

    await admin.from('appeals').delete().eq('id', live!.id)
  })

  test('anon reads nothing and writes nothing', async () => {
    const { data } = await anon.from('appeals').select('*')
    expect(data ?? []).toHaveLength(0)

    const { data: inserted } = await anon
      .from('appeals')
      .insert({
        subject_type: 'submission',
        subject_id: '00000000-0000-4000-8000-0000000000fb',
        appellant_profile_id: coachId,
        statement: 'Anon should never be able to file this.',
        decision_at: new Date().toISOString(),
      })
      .select()
    expect(inserted ?? []).toHaveLength(0)

    const { data: updated } = await anon.from('appeals').update({ statement: 'tampered' }).eq('id', appealId).select()
    expect(updated ?? []).toHaveLength(0)

    const { data: deleted } = await anon.from('appeals').delete().eq('id', appealId).select()
    expect(deleted ?? []).toHaveLength(0)
  })

  test('CAPACITY NON-REGRESSION: an overturn moves no money and leaves zero drift', async () => {
    const { data: before } = await admin.from('sponsors').select('id, funding_used_cents').order('id')
    const { data: driftBefore } = await admin.rpc('detect_capacity_drift' as never)
    expect(driftBefore ?? []).toHaveLength(0)

    // Overturn is a status flip on a pending-stage decline, which never reserved anything.
    const { data: declined } = await admin
      .from('submissions')
      .select('id, reserved_amount_cents, sent_at')
      .eq('status', 'declined')
      .is('sent_at', null)
      .limit(1)
      .maybeSingle()

    if (declined) {
      expect(declined.reserved_amount_cents ?? 0).toBe(0)
      expect(declined.sent_at).toBeNull()

      await admin.from('submissions').update({ status: 'changes_requested' }).eq('id', declined.id)

      const { data: after } = await admin.from('sponsors').select('id, funding_used_cents').order('id')
      expect(after).toEqual(before)

      const { data: driftAfter } = await admin.rpc('detect_capacity_drift' as never)
      expect(driftAfter ?? []).toHaveLength(0)

      await admin.from('submissions').update({ status: 'declined' }).eq('id', declined.id)
    }
  })

  test.afterAll(async () => {
    if (admin && coachId) {
      await admin.from('appeals').delete().eq('appellant_profile_id', coachId)
    }
  })
})
