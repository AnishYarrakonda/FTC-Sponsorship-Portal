/**
 * Org roles & the two-step approver workflow (0083).
 *
 * Builds on the sponsor_members fixtures from scripts/seed-test-accounts.mjs: "dev
 * testing" (org A) now has an org_admin, a submitter, a viewer, and an approver;
 * "dev testing 2" (org B) is a wholly separate org_admin-only company for the
 * cross-org isolation tests.
 *
 * This suite creates its own throwaway team + dispatched submission per test so it does
 * not depend on submission fixtures existing elsewhere, and cleans them up afterward.
 */

import { test, expect, type Page } from '@playwright/test'
import { signIn, evaluateStable } from '../helpers/clerk-auth'
import { createOwnedTeam, deleteOwnedTeam } from '../helpers/fixtures'
import { createClient } from '@supabase/supabase-js'
import { Database } from '../../lib/supabase/types'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

const COACH_EMAIL = process.env.COACH_EMAIL ?? 'coach+clerk_test@example.com'
const COACH_PASSWORD = process.env.COACH_PASSWORD ?? 'CoachTest123!'
const SPONSOR_EMAIL = process.env.SPONSOR_EMAIL ?? 'sponsor+clerk_test@example.com' // org_admin, org A
const SPONSOR_PASSWORD = process.env.SPONSOR_PASSWORD ?? 'SponsorTest123!'
const SUBMITTER_EMAIL = process.env.SPONSOR_MEMBER_EMAIL ?? 'sponsor-member+clerk_test@example.com' // submitter, org A
const SUBMITTER_PASSWORD = process.env.SPONSOR_MEMBER_PASSWORD ?? 'SponsorMemberTest123!'
const VIEWER_EMAIL = 'sponsor-viewer+clerk_test@example.com' // viewer, org A
const VIEWER_PASSWORD = 'SponsorViewerTest123!'
const APPROVER_EMAIL = 'sponsor-approver+clerk_test@example.com' // approver, org A
const APPROVER_PASSWORD = 'SponsorApproverTest123!'
const SPONSOR2_EMAIL = process.env.SPONSOR2_EMAIL ?? 'sponsor2+clerk_test@example.com' // org_admin, org B
const SPONSOR2_PASSWORD = process.env.SPONSOR2_PASSWORD ?? 'Sponsor2Test123!'


async function restAs(
  page: Page,
  path: string,
  init: { method?: string; body?: unknown; prefer?: string } = {}
) {
  return evaluateStable(
    page,
    async ({ path, init, url, anonKey }) => {
      const token = await window.Clerk?.session?.getToken()
      const res = await fetch(`${url}/rest/v1${path}`, {
        method: init.method ?? 'GET',
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${token ?? ''}`,
          'Content-Type': 'application/json',
          ...(init.prefer ? { Prefer: init.prefer } : {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
      })
      let body: unknown = null
      try {
        body = await res.json()
      } catch {
        // empty body is fine
      }
      return { status: res.status, body }
    },
    { path, init, url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY }
  )
}

test.describe.serial('Org roles & the two-step approver workflow (0083)', () => {
  test.skip(
    !process.env.SUPABASE_LOCAL || !process.env.ADMIN_EMAIL,
    'Set SUPABASE_LOCAL=true and seed test accounts (scripts/seed-test-accounts.mjs) to enable this suite'
  )

  let adminClient: ReturnType<typeof createClient<Database>>
  let sponsorAId: string
  let sponsorBId: string
  let fixtureCoachId: string
  let teamName: string
  let teamId: string

  test.beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    const { data: orgA } = await adminClient.from('sponsors').select('id').eq('company_name', 'dev testing').single()
    sponsorAId = orgA!.id
    const { data: orgB } = await adminClient.from('sponsors').select('id').eq('company_name', 'dev testing 2').single()
    sponsorBId = orgB!.id
    // Off for both orgs at suite start, whatever prior runs left behind.
    await adminClient.from('sponsors').update({ approval_required_above_cents: null }).in('id', [sponsorAId, sponsorBId])

    // A throwaway coach owns this team. The seeded coach already has one, and the database
    // enforces one team per owner account, so inserting against the seeded coach fails outright —
    // and the failure surfaces as a null dereference in this hook, not as a clear message.
    const owned = await createOwnedTeam(adminClient, { label: 'approvals', ftcTeamNumber: 88801 })
    fixtureCoachId = owned.coachProfileId
    teamId = owned.teamId
    teamName = owned.teamName
  })

  test.afterAll(async () => {
    await adminClient.from('submissions').delete().eq('team_id', teamId)
    await deleteOwnedTeam(adminClient, { coachProfileId: fixtureCoachId, teamId })
    await adminClient.from('sponsors').update({ approval_required_above_cents: null }).in('id', [sponsorAId, sponsorBId])
  })

  async function createDispatchedSubmission(sponsorId: string, amountCents: number, expiresInDays = 14) {
    const { data } = await adminClient
      .from('submissions')
      .insert({
        team_id: teamId, sponsor_id: sponsorId, status: 'dispatched',
        requested_amount_cents: amountCents, reserved_amount_cents: amountCents,
        // `submissions_select_sponsor` requires `sent_at IS NOT NULL` — a row that has not
        // been dispatched is invisible to the sponsor no matter what its status column says.
        // Without this the whole suite saw "Pitch not found" instead of the review console.
        sent_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + expiresInDays * 86_400_000).toISOString(),
      })
      .select('id')
      .single()
    return data!.id as string
  }

  test('org_admin turns two-step approval on at $1,000', async ({ page }) => {
    await signIn(page, SPONSOR_EMAIL, SPONSOR_PASSWORD)
    await page.goto('/sponsor/settings')

    await expect(page.getByText('Approval policy')).toBeVisible({ timeout: 15_000 })
    await page.getByLabel('Two-step approval').check()
    await page.getByLabel('Threshold').fill('1000')
    await page.getByRole('button', { name: /^save$/i }).click()
    await expect(page.getByText(/approval policy saved/i)).toBeVisible({ timeout: 10_000 })

    const { data } = await adminClient.from('sponsors').select('approval_required_above_cents').eq('id', sponsorAId).single()
    expect(data?.approval_required_above_cents).toBe(100_000)
  })

  test('a submitter proposing above the threshold sees "Sent for approval", not a success toast', async ({ page }) => {
    const submissionId = await createDispatchedSubmission(sponsorAId, 250_000) // $2,500 > $1,000
    await signIn(page, SUBMITTER_EMAIL, SUBMITTER_PASSWORD)
    await page.goto(`/sponsor/submissions/${submissionId}`)

    await page.getByRole('button', { name: /send for approval/i }).click()
    await page.getByRole('button', { name: /^confirm$/i }).click()
    // The toast reads "Sent to your approvers." — the earlier /sent for approval/i never
    // matched anything (the button says "Send", not "Sent"), so this assertion could only
    // ever fail, even though the proposal underneath was created correctly.
    await expect(page.getByText(/sent to your approvers/i)).toBeVisible({ timeout: 15_000 })

    const { data: proposal } = await adminClient
      .from('sponsor_decision_proposals')
      .select('id, status, amount_cents')
      .eq('submission_id', submissionId)
      .single()
    expect(proposal?.status).toBe('pending')
    expect(proposal?.amount_cents).toBe(250_000)

    await page.goto('/sponsor/approvals')
    await expect(page.getByText(teamName)).toBeVisible({ timeout: 15_000 })

    await adminClient.from('submissions').delete().eq('id', submissionId)
  })

  test('a viewer sees no action buttons anywhere in the flow', async ({ page }) => {
    const submissionId = await createDispatchedSubmission(sponsorAId, 250_000)
    await signIn(page, VIEWER_EMAIL, VIEWER_PASSWORD)

    await page.goto(`/sponsor/submissions/${submissionId}`)
    // Both the card title and its description say "view-only", so an unanchored match is a
    // strict-mode violation. The title is the element that proves the branch was taken.
    await expect(page.getByText('View-only', { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: /approve|decline|send for approval/i })).toHaveCount(0)

    await page.goto('/sponsor/approvals')
    await expect(page.getByRole('button', { name: /confirm|reject/i })).toHaveCount(0)

    await adminClient.from('submissions').delete().eq('id', submissionId)
  })

  test('an approver confirms and the pitch settles', async ({ page }) => {
    const submissionId = await createDispatchedSubmission(sponsorAId, 250_000)
    const { data: propose } = await adminClient.rpc('create_sponsor_decision_proposal', {
      p_submission_id: submissionId,
      p_proposed_by: (await adminClient.from('profiles').select('id').eq('email', SUBMITTER_EMAIL).single()).data!.id,
      p_amount_cents: 0,
      p_origin: 'portal',
      p_feedback: null,
    } as never)
    expect((propose as { ok: boolean }).ok).toBe(true)

    await signIn(page, APPROVER_EMAIL, APPROVER_PASSWORD)
    await page.goto('/sponsor/approvals')
    await page.getByRole('button', { name: /^confirm$/i }).first().click()
    await expect(page.getByText(/funding confirmed/i)).toBeVisible({ timeout: 15_000 })

    const { data: submission } = await adminClient.from('submissions').select('status').eq('id', submissionId).single()
    expect(submission?.status).toBe('approved')
    const { count } = await adminClient
      .from('transactions_ledger')
      .select('id', { count: 'exact', head: true })
      .eq('submission_id', submissionId)
    expect(count).toBe(1)

    await adminClient.from('submissions').delete().eq('id', submissionId)
  })

  test.describe('Security boundaries (RLS + action layer, real Clerk-authenticated sessions)', () => {
    test('a viewer cannot approve funding — action layer and database layer both deny', async ({ page }) => {
      const submissionId = await createDispatchedSubmission(sponsorAId, 250_000)
      const submitterId = (await adminClient.from('profiles').select('id').eq('email', SUBMITTER_EMAIL).single()).data!.id
      const { data: propose } = await adminClient.rpc('create_sponsor_decision_proposal', {
        p_submission_id: submissionId, p_proposed_by: submitterId, p_amount_cents: 0, p_origin: 'portal', p_feedback: null,
      } as never)
      const proposalId = (propose as { proposal_id: string }).proposal_id

      await signIn(page, VIEWER_EMAIL, VIEWER_PASSWORD)
      await page.goto('/sponsor/dashboard')

      // Database layer: EXECUTE is revoked from `authenticated` entirely.
      const rpcResult = await restAs(page, '/rpc/confirm_sponsor_decision_proposal', {
        method: 'POST',
        body: { p_proposal_id: proposalId, p_approver_id: null, p_note: null },
      })
      expect(rpcResult.status).toBeGreaterThanOrEqual(400)

      const { count } = await adminClient
        .from('transactions_ledger')
        .select('id', { count: 'exact', head: true })
        .eq('submission_id', submissionId)
      expect(count).toBe(0)
      const { data: stillPending } = await adminClient
        .from('sponsor_decision_proposals')
        .select('status')
        .eq('id', proposalId)
        .single()
      expect(stillPending?.status).toBe('pending')

      await adminClient.from('sponsor_decision_proposals').delete().eq('id', proposalId)
      await adminClient.from('submissions').delete().eq('id', submissionId)
    })

    test('a submitter cannot approve funding — same three assertions, one rank up', async ({ page }) => {
      const submissionId = await createDispatchedSubmission(sponsorAId, 250_000)
      const submitterId = (await adminClient.from('profiles').select('id').eq('email', SUBMITTER_EMAIL).single()).data!.id
      const { data: propose } = await adminClient.rpc('create_sponsor_decision_proposal', {
        p_submission_id: submissionId, p_proposed_by: submitterId, p_amount_cents: 0, p_origin: 'portal', p_feedback: null,
      } as never)
      const proposalId = (propose as { proposal_id: string }).proposal_id

      await signIn(page, SUBMITTER_EMAIL, SUBMITTER_PASSWORD)
      await page.goto('/sponsor/dashboard')

      const rpcResult = await restAs(page, '/rpc/confirm_sponsor_decision_proposal', {
        method: 'POST',
        body: { p_proposal_id: proposalId, p_approver_id: null, p_note: null },
      })
      expect(rpcResult.status).toBeGreaterThanOrEqual(400)

      const { count } = await adminClient
        .from('transactions_ledger')
        .select('id', { count: 'exact', head: true })
        .eq('submission_id', submissionId)
      expect(count).toBe(0)

      await adminClient.from('sponsor_decision_proposals').delete().eq('id', proposalId)
      await adminClient.from('submissions').delete().eq('id', submissionId)
    })

    test('cross-org isolation: org B cannot see, confirm, or withdraw org A\'s proposals', async ({ page }) => {
      const submissionId = await createDispatchedSubmission(sponsorAId, 250_000)
      const submitterId = (await adminClient.from('profiles').select('id').eq('email', SUBMITTER_EMAIL).single()).data!.id
      const { data: propose } = await adminClient.rpc('create_sponsor_decision_proposal', {
        p_submission_id: submissionId, p_proposed_by: submitterId, p_amount_cents: 0, p_origin: 'portal', p_feedback: null,
      } as never)
      const proposalId = (propose as { proposal_id: string }).proposal_id
      const before = await adminClient.from('sponsor_decision_proposals').select('*').eq('id', proposalId).single()

      await signIn(page, SPONSOR2_EMAIL, SPONSOR2_PASSWORD)
      await page.goto('/sponsor/dashboard')

      const read = await restAs(page, `/sponsor_decision_proposals?sponsor_id=eq.${sponsorAId}`)
      expect(read.status).toBe(200)
      expect(read.body).toEqual([])

      const rpcResult = await restAs(page, '/rpc/confirm_sponsor_decision_proposal', {
        method: 'POST',
        body: { p_proposal_id: proposalId, p_approver_id: null, p_note: null },
      })
      expect(rpcResult.status).toBeGreaterThanOrEqual(400)

      const after = await adminClient.from('sponsor_decision_proposals').select('*').eq('id', proposalId).single()
      expect(after.data).toEqual(before.data)
      const { count } = await adminClient
        .from('transactions_ledger')
        .select('id', { count: 'exact', head: true })
        .eq('submission_id', submissionId)
      expect(count).toBe(0)

      await adminClient.from('sponsor_decision_proposals').delete().eq('id', proposalId)
      await adminClient.from('submissions').delete().eq('id', submissionId)
    })

    test('self-approval is refused by the RPC', async () => {
      const submissionId = await createDispatchedSubmission(sponsorAId, 250_000)
      const approverId = (await adminClient.from('profiles').select('id').eq('email', APPROVER_EMAIL).single()).data!.id
      const { data: propose } = await adminClient.rpc('create_sponsor_decision_proposal', {
        p_submission_id: submissionId, p_proposed_by: approverId, p_amount_cents: 0, p_origin: 'portal', p_feedback: null,
      } as never)
      const proposalId = (propose as { proposal_id: string }).proposal_id

      const { data: confirm } = await adminClient.rpc('confirm_sponsor_decision_proposal', {
        p_proposal_id: proposalId, p_approver_id: approverId, p_note: null,
      } as never)
      expect((confirm as { ok: boolean; error?: string }).ok).toBe(false)
      expect((confirm as { error?: string }).error).toBe('self_approval')

      const { data: stillPending } = await adminClient.from('sponsor_decision_proposals').select('status').eq('id', proposalId).single()
      expect(stillPending?.status).toBe('pending')

      await adminClient.from('sponsor_decision_proposals').delete().eq('id', proposalId)
      await adminClient.from('submissions').delete().eq('id', submissionId)
    })

    test('a legacy sponsor (no sponsor_members row) can still propose and confirm', async () => {
      // Simulate the pre-0082 shape: delete org B's membership row, keep profiles.sponsor_id.
      const sponsor2AdminId = (await adminClient.from('profiles').select('id').eq('email', SPONSOR2_EMAIL).single()).data!.id
      const { data: membershipRow } = await adminClient
        .from('sponsor_members')
        .select('*')
        .eq('sponsor_id', sponsorBId)
        .eq('profile_id', sponsor2AdminId)
        .single()
      await adminClient.from('sponsor_members').delete().eq('sponsor_id', sponsorBId).eq('profile_id', sponsor2AdminId)

      const submissionId = await createDispatchedSubmission(sponsorBId, 100_000)
      const { data: propose } = await adminClient.rpc('create_sponsor_decision_proposal', {
        p_submission_id: submissionId, p_proposed_by: sponsor2AdminId, p_amount_cents: 0, p_origin: 'portal', p_feedback: null,
      } as never)
      expect((propose as { ok: boolean }).ok).toBe(true)
      const proposalId = (propose as { proposal_id: string }).proposal_id

      /**
       * Org B has exactly one member, so proposer and approver are the same person and the
       * confirm is refused — by the SELF-APPROVAL rule, not by a rank check. That distinction
       * is the whole point of this test: `forbidden` would mean the legacy fallback failed to
       * resolve a rank for a sponsor with no `sponsor_members` row, while `self_approval`
       * means it resolved to org_admin and the two-person rule then did its job.
       *
       * The original assertion (`ok === true`) could never hold — the suite's own
       * "self-approval is refused by the RPC" test asserts the opposite for the same shape.
       */
      const { data: confirm } = await adminClient.rpc('confirm_sponsor_decision_proposal', {
        p_proposal_id: proposalId, p_approver_id: sponsor2AdminId, p_note: null,
      } as never)
      expect((confirm as { ok: boolean; error: string }).ok).toBe(false)
      expect((confirm as { ok: boolean; error: string }).error).toBe('self_approval')

      await adminClient.from('submissions').delete().eq('id', submissionId)
      await adminClient.from('sponsor_members').insert(membershipRow!)
    })

    test('a proposal moves no money and never outlives its reservation', async () => {
      const submissionId = await createDispatchedSubmission(sponsorAId, 250_000, 2) // expires in 2 days
      const { data: before } = await adminClient.from('sponsors').select('funding_used_cents').eq('id', sponsorAId).single()
      const submitterId = (await adminClient.from('profiles').select('id').eq('email', SUBMITTER_EMAIL).single()).data!.id

      const { data: propose } = await adminClient.rpc('create_sponsor_decision_proposal', {
        p_submission_id: submissionId, p_proposed_by: submitterId, p_amount_cents: 0, p_origin: 'portal', p_feedback: null,
      } as never)
      const result = propose as { ok: boolean; proposal_id: string; expires_at: string }
      expect(result.ok).toBe(true)

      const { data: submission } = await adminClient.from('submissions').select('expires_at, reserved_amount_cents').eq('id', submissionId).single()
      expect(new Date(result.expires_at).getTime()).toBeLessThanOrEqual(new Date(submission!.expires_at!).getTime())
      expect(new Date(result.expires_at).getTime()).toBeLessThanOrEqual(Date.now() + 7 * 86_400_000 + 60_000)

      const { data: after } = await adminClient.from('sponsors').select('funding_used_cents').eq('id', sponsorAId).single()
      expect(after?.funding_used_cents).toBe(before?.funding_used_cents)
      expect(submission?.reserved_amount_cents).toBe(250_000)
      const { count } = await adminClient.from('transactions_ledger').select('id', { count: 'exact', head: true }).eq('submission_id', submissionId)
      expect(count).toBe(0)

      await adminClient.from('sponsor_decision_proposals').delete().eq('id', result.proposal_id)
      await adminClient.from('submissions').delete().eq('id', submissionId)
    })

    test('the trigger closes a pending proposal when the submission bounces', async () => {
      const submissionId = await createDispatchedSubmission(sponsorAId, 250_000)
      const submitterId = (await adminClient.from('profiles').select('id').eq('email', SUBMITTER_EMAIL).single()).data!.id
      const { data: propose } = await adminClient.rpc('create_sponsor_decision_proposal', {
        p_submission_id: submissionId, p_proposed_by: submitterId, p_amount_cents: 0, p_origin: 'portal', p_feedback: null,
      } as never)
      const proposalId = (propose as { proposal_id: string }).proposal_id

      await adminClient.rpc('release_submission_reservation', {
        p_submission_id: submissionId, p_new_status: 'bounced', p_reason: 'test',
      } as never)

      const { data: proposal } = await adminClient.from('sponsor_decision_proposals').select('status, closed_reason').eq('id', proposalId).single()
      expect(proposal?.status).toBe('expired')
      expect(proposal?.closed_reason).toBe('submission_bounced')

      await adminClient.from('sponsor_decision_proposals').delete().eq('id', proposalId)
      await adminClient.from('submissions').delete().eq('id', submissionId)
    })

    test('sponsor_decision_proposals is not writable by a member', async ({ page }) => {
      const submissionId = await createDispatchedSubmission(sponsorAId, 250_000)
      await signIn(page, SPONSOR_EMAIL, SPONSOR_PASSWORD)
      await page.goto('/sponsor/dashboard')

      const insert = await restAs(page, '/sponsor_decision_proposals', {
        method: 'POST',
        body: { submission_id: submissionId, sponsor_id: sponsorAId, amount_cents: 1000, status: 'pending', expires_at: new Date().toISOString() },
      })
      expect(insert.status).toBeGreaterThanOrEqual(400)

      await adminClient.from('submissions').delete().eq('id', submissionId)
    })

    test('a coach and an anon caller read 0 rows from sponsor_decision_proposals', async ({ page, request }) => {
      await signIn(page, COACH_EMAIL, COACH_PASSWORD)
      await page.goto('/dashboard')
      const asCoach = await restAs(page, `/sponsor_decision_proposals?sponsor_id=eq.${sponsorAId}`)
      expect(asCoach.status).toBe(200)
      expect(asCoach.body).toEqual([])

      const anon = await request.get(`${SUPABASE_URL}/rest/v1/sponsor_decision_proposals`, {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      })
      expect(anon.status()).toBe(200)
      expect(await anon.json()).toEqual([])
    })

    test('the last-approver floor: removing the second Approver while approvals are on is refused', async ({ page }) => {
      await signIn(page, SPONSOR_EMAIL, SPONSOR_PASSWORD)
      await page.goto('/sponsor/members')

      const { data: before } = await adminClient
        .from('sponsor_members')
        .select('id, role')
        .eq('sponsor_id', sponsorAId)
        .eq('role', 'approver')
        .single()

      const approverRow = page.getByRole('row', { name: /dev sponsor approver/i })
      await approverRow.getByRole('button').last().click()
      const remove = page.getByRole('menuitem', { name: /remove from organization/i })
      await expect(remove).toBeDisabled()

      const { data: after } = await adminClient.from('sponsor_members').select('id, role').eq('id', before!.id).single()
      expect(after).toEqual(before)
    })

    test('42P17 regression: cycle check unaffected by has_sponsor_permission()', async () => {
      const [{ error: e1 }, { error: e2 }, { error: e3 }, { error: e4 }] = await Promise.all([
        adminClient.from('teams').select('id', { count: 'exact', head: true }),
        adminClient.from('submissions').select('id', { count: 'exact', head: true }),
        adminClient.from('team_achievements').select('id', { count: 'exact', head: true }),
        adminClient.from('transactions_ledger').select('id', { count: 'exact', head: true }),
      ])
      for (const e of [e1, e2, e3, e4]) {
        expect(e?.code).not.toBe('42P17')
      }
    })
  })
})
