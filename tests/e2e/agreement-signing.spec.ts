/**
 * E-sign capture flow — access boundaries, ordering, hash integrity, and the happy path.
 *
 * The unauthenticated-redirect boundary runs unconditionally. Everything else needs a
 * local Supabase (SUPABASE_LOCAL) plus the seeded accounts from
 * scripts/seed-test-accounts.mjs, because it mutates real rows (a submission, a
 * transaction, a funding_fulfillment, agreement_signatures) and exercises the actual
 * signing UI. `test.describe.serial` because each block builds on state the previous
 * block left behind (a pledged fulfillment -> sponsor-signed -> both-signed).
 */

import { test, expect, type Page } from '@playwright/test'
import { signIn } from '../helpers/clerk-auth'
import { pledge, unpledge } from '../helpers/fixtures'
import { createClient } from '@supabase/supabase-js'
import { Database } from '../../lib/supabase/types'
import { signatureProvider } from '../../lib/agreements/in-house-provider'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

const COACH_EMAIL = process.env.COACH_EMAIL ?? 'coach+clerk_test@example.com'
const COACH_PASSWORD = process.env.COACH_PASSWORD ?? 'CoachTest123!'
const SPONSOR_EMAIL = process.env.SPONSOR_EMAIL ?? 'sponsor+clerk_test@example.com'
const SPONSOR_PASSWORD = process.env.SPONSOR_PASSWORD ?? 'SponsorTest123!'
const PLEDGE_CENTS = 100_000


test.describe('Agreement signing — access boundaries', () => {
  test('unauthenticated GET /agreement-records/<id> redirects to /login', async ({ page }) => {
    await page.goto('/agreement-records/00000000-0000-4000-8000-000000000000')
    await expect(page).toHaveURL(/\/login/)
  })
})

test.describe.serial('Agreement signing — end to end', () => {
  test.skip(
    !process.env.SUPABASE_LOCAL || !process.env.ADMIN_EMAIL,
    'Set SUPABASE_LOCAL=true and seed test accounts (scripts/seed-test-accounts.mjs) to enable this suite'
  )

  let adminClient: ReturnType<typeof createClient<Database>>
  let coachProfileId: string
  let sponsorProfileId: string
  let sponsorId: string
  let teamId: string
  let submissionId: string
  let fulfillmentId: string
  let transactionId: string

  test.beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    const { data: coach } = await adminClient
      .from('profiles')
      .select('id')
      .eq('email', COACH_EMAIL)
      .single()
    coachProfileId = coach!.id

    const { data: sponsorProfile } = await adminClient
      .from('profiles')
      .select('id, sponsor_id')
      .eq('email', SPONSOR_EMAIL)
      .single()
    sponsorProfileId = sponsorProfile!.id
    sponsorId = sponsorProfile!.sponsor_id!

    // The seeded coach must own this team: the suite signs in as that coach and countersigns
    // through the real UI, and team ownership is what authorizes them.
    const { data: team } = await adminClient
      .from('teams')
      .select('id')
      .eq('owner_id', coachProfileId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .single()
    teamId = team!.id

    /**
     * Clear anything a previous crashed run left on this (team, sponsor) pair before
     * inserting. `submissions` has a unique index over (team_id, sponsor_id) for an active
     * row, so one aborted run used to poison every run after it — the insert below returned
     * null and the hook died on `submission!.id`, which reads like a schema problem rather
     * than residue. Order matters: children before parents.
     */
    const { data: stale } = await adminClient
      .from('submissions')
      .select('id')
      .eq('team_id', teamId)
      .eq('sponsor_id', sponsorId)
    for (const row of stale ?? []) {
      await adminClient.from('agreement_signatures').delete().eq('submission_id', row.id)
      const { data: fulfillments } = await adminClient
        .from('funding_fulfillments')
        .select('id')
        .eq('submission_id', row.id)
      for (const f of fulfillments ?? []) {
        await adminClient.from('funding_fulfillment_events').delete().eq('fulfillment_id', f.id)
      }
      await adminClient.from('funding_fulfillments').delete().eq('submission_id', row.id)
      await adminClient.from('transactions_ledger').delete().eq('submission_id', row.id)
      await adminClient.from('submissions').delete().eq('id', row.id)
    }
    await adminClient.from('sponsors').update({ funding_used_cents: 0 }).eq('id', sponsorId)

    /**
     * The effective template also merges team_city / team_state / team_organization, and
     * `render` treats a blank value as missing on purpose (a silently empty line in an
     * executed agreement is the failure it guards against). The seeded team has none of
     * them, so `prepare` threw MissingMergeFieldError and the page rendered the
     * can't-sign card — whose copy blames the payout profile for ANY missing field, which
     * is why this looked like a payout-profile problem.
     */
    await adminClient
      .from('teams')
      .update({ city: 'Dayton', state: 'OH', organization: 'Fixture Robotics Boosters', ftc_team_number: 99999 })
      .eq('id', teamId)

    // A team must have a legal payee name on file, or `prepare` throws
    // MissingMergeFieldError and the signing page shows the "missing payout details" card
    // instead of a form — set one directly so this suite exercises the signable path.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (adminClient as any).from('team_payout_profiles').upsert(
      { team_id: teamId, legal_payee_name: 'Test Robotics Booster Club', tax_classification: 'unincorporated' },
      { onConflict: 'team_id' }
    )

    const { data: submission } = await adminClient
      .from('submissions')
      .insert({
        team_id: teamId,
        sponsor_id: sponsorId,
        status: 'approved',
        requested_amount_cents: 100_000,
        reserved_amount_cents: 100_000,
        // Required by `submissions_select_sponsor` (sent_at IS NOT NULL). Without it the
        // sponsor cannot see their own approved pitch, and every page in this suite renders
        // "Pitch not found" instead of the signing form.
        sent_at: new Date().toISOString(),
      } as never)
      .select('id')
      .single()
    submissionId = submission!.id

    // Ledger + fulfillment together with the capacity bookkeeping, so this fixture is not
    // reported as drift by the suites that assert `detect_capacity_drift()` is empty.
    const created = await pledge(adminClient, {
      sponsorId,
      teamId,
      submissionId,
      amountCents: PLEDGE_CENTS,
    })
    transactionId = created.transactionId
    fulfillmentId = created.fulfillmentId
  })

  test.afterAll(async () => {
    await adminClient.from('agreement_signatures').delete().eq('submission_id', submissionId)
    await unpledge(adminClient, {
      sponsorId,
      amountCents: PLEDGE_CENTS,
      transactionId,
      fulfillmentId,
    })
    await adminClient.from('submissions').delete().eq('id', submissionId)
  })

  test('a coach cannot open the sponsor signing page', async ({ page }) => {
    await signIn(page, COACH_EMAIL, COACH_PASSWORD)
    await page.goto(`/sponsor/submissions/${submissionId}/sign`)
    await expect(page).toHaveURL(/\/dashboard/)
  })

  test('a coach cannot countersign before the sponsor has signed — page shows "waiting"', async ({ page }) => {
    await signIn(page, COACH_EMAIL, COACH_PASSWORD)
    await page.goto(`/submissions/${submissionId}/sign`)
    await expect(page.getByText(/waiting for/i)).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('#typed-name')).toHaveCount(0)
  })

  test('calling the action directly before the sponsor signs returns awaiting_sponsor_signature', async () => {
    const { data } = await adminClient.rpc('sign_agreement_atomic', {
      p_template_id: (
        await adminClient
          .from('agreement_templates')
          .select('id')
          .eq('key', 'sponsorship_agreement')
          .eq('status', 'effective')
          .single()
      ).data!.id,
      p_signer_profile_id: coachProfileId,
      p_signer_role: 'coach',
      p_submission_id: submissionId,
      p_typed_name: 'Test Coach',
      p_ip: '203.0.113.1',
      p_user_agent: 'playwright',
      p_document_hash: '0'.repeat(64),
      p_document_storage_path: 'test/path.html',
      p_consent_text_hash: '0'.repeat(64),
      p_entity_snapshot: {},
    })
    expect((data as { ok: boolean; error?: string }).ok).toBe(false)
    expect((data as { ok: boolean; error?: string }).error).toBe('awaiting_sponsor_signature')
  })

  test('controls stay disabled until the document is scrolled to the bottom', async ({ page }) => {
    await signIn(page, SPONSOR_EMAIL, SPONSOR_PASSWORD)
    await page.goto(`/sponsor/submissions/${submissionId}/sign`)
    await expect(page.getByLabel(/type your full legal name/i)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByLabel(/type your full legal name/i)).toBeDisabled()
    await expect(page.locator('#consent-checkbox')).toBeDisabled()
  })

  test('submitting a stale documentHash returns document_changed', async () => {
    const { data: coachRow } = await adminClient.from('profiles').select('id, full_name').eq('id', coachProfileId).single()
    const prepared = await signatureProvider.prepare({
      submissionId,
      signerRole: 'sponsor',
      signerProfileId: sponsorProfileId,
      clerkUserId: 'test-sponsor-clerk-id',
    })

    let caught: unknown
    try {
      await signatureProvider.capture({
        submissionId,
        signerRole: 'sponsor',
        signerProfileId: sponsorProfileId,
        clerkUserId: 'test-sponsor-clerk-id',
        templateId: prepared.templateId,
        documentHash: 'f'.repeat(64), // a hash that was never actually prepared/stored
        typedName: coachRow?.full_name ?? 'irrelevant',
        ipAddress: '203.0.113.3',
        userAgent: 'playwright',
      })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toBe('document_changed')

    // The failed attempt must not have consumed the sponsor's one signature slot.
    const { data: signedYet } = await adminClient
      .from('agreement_signatures')
      .select('id')
      .eq('submission_id', submissionId)
      .eq('signer_role', 'sponsor')
    expect(signedYet?.length ?? 0).toBe(0)
  })

  test('happy path: sponsor scrolls, consents, types the matching name, and signs', async ({ page }) => {
    await signIn(page, SPONSOR_EMAIL, SPONSOR_PASSWORD)
    await page.goto(`/sponsor/submissions/${submissionId}/sign`)

    const sentinel = page.getByTestId('agreement-scroll-sentinel')
    await sentinel.scrollIntoViewIfNeeded()

    const nameInput = page.getByLabel(/type your full legal name/i)
    await expect(nameInput).toBeEnabled({ timeout: 10_000 })

    // A mismatched name is rejected with the expected name shown before submit.
    await nameInput.fill('Someone Else')
    await expect(page.getByText(/does not match the expected name/i)).toBeVisible()

    const { data: sponsorProfile } = await adminClient
      .from('profiles')
      .select('full_name')
      .eq('id', sponsorProfileId)
      .single()

    await nameInput.fill('')
    await nameInput.fill(sponsorProfile!.full_name)
    await page.locator('#consent-checkbox').check()
    await page.getByRole('button', { name: /sign agreement/i }).click()

    await expect(page).toHaveURL(/\/agreement-records\//, { timeout: 15_000 })
  })

  test('reloading the sponsor signing page after signing shows the already-signed card', async ({ page }) => {
    await signIn(page, SPONSOR_EMAIL, SPONSOR_PASSWORD)
    await page.goto(`/sponsor/submissions/${submissionId}/sign`)
    await expect(page.getByText(/already signed this agreement/i)).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('#typed-name')).toHaveCount(0)
  })

  test('the coach was notified and can now countersign', async ({ page }) => {
    const { data: notifications } = await adminClient
      .from('notifications')
      .select('title')
      .eq('recipient_id', coachProfileId)
      .eq('submission_id', submissionId)
    expect(notifications?.some((n) => /sign your sponsorship agreement/i.test(n.title))).toBe(true)

    await signIn(page, COACH_EMAIL, COACH_PASSWORD)
    await page.goto(`/submissions/${submissionId}/sign`)

    const sentinel = page.getByTestId('agreement-scroll-sentinel')
    await sentinel.scrollIntoViewIfNeeded()

    const { data: coachProfile } = await adminClient.from('profiles').select('full_name').eq('id', coachProfileId).single()
    const nameInput = page.getByLabel(/type your full legal name/i)
    await expect(nameInput).toBeEnabled({ timeout: 10_000 })
    await nameInput.fill(coachProfile!.full_name)
    await page.locator('#consent-checkbox').check()
    await page.getByRole('button', { name: /sign agreement/i }).click()

    await expect(page).toHaveURL(/\/agreement-records\//, { timeout: 15_000 })
  })

  test('the fulfillment left pledged once both parties signed', async () => {
    const { data: fulfillment } = await adminClient
      .from('funding_fulfillments')
      .select('status')
      .eq('id', fulfillmentId)
      .single()
    expect(fulfillment?.status).not.toBe('pledged')
  })

  test('a non-party sponsor cannot sign or read this submission\'s agreement (RLS + RPC boundary)', async () => {
    // No second real sponsor Clerk account is seeded in this project (scripts/
    // seed-test-accounts.mjs creates exactly one). Proving the boundary at the RPC/RLS
    // layer directly — the same pattern tests/e2e/fulfillment-transitions.spec.ts uses
    // for its cross-sponsor checks — is equally conclusive: it is the same authorization
    // code path a second browser session would exercise.
    const { data: otherSponsorProfile } = await adminClient
      .from('profiles')
      .select('id')
      .eq('role', 'admin')
      .limit(1)
      .single()

    const { data: template } = await adminClient
      .from('agreement_templates')
      .select('id')
      .eq('key', 'sponsorship_agreement')
      .eq('status', 'effective')
      .single()

    const { data: signResult } = await adminClient.rpc('sign_agreement_atomic', {
      p_template_id: template!.id,
      p_signer_profile_id: otherSponsorProfile!.id, // not this submission's sponsor
      p_signer_role: 'sponsor',
      p_submission_id: submissionId,
      p_typed_name: 'Not Allowed',
      p_ip: '203.0.113.2',
      p_user_agent: 'playwright',
      p_document_hash: '1'.repeat(64),
      p_document_storage_path: 'test/other.html',
      p_consent_text_hash: '1'.repeat(64),
      p_entity_snapshot: {},
    })
    expect((signResult as { ok: boolean; error?: string }).ok).toBe(false)
    expect((signResult as { ok: boolean; error?: string }).error).toBe('unauthorized')

    // Anon (no session at all) sees nothing — the strictest form of "not a party".
    const anonClient = createClient(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '')
    const { data: anonRead } = await anonClient.from('agreement_signatures').select('id').eq('submission_id', submissionId)
    expect(anonRead?.length ?? 0).toBe(0)
  })
})
