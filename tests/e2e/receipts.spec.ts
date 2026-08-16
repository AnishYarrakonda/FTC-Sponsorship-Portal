import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { Database } from '../../lib/supabase/types'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

test.describe.serial('Donation Receipts & Security Boundaries', () => {
  test.skip(
    !process.env.SUPABASE_LOCAL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY,
    'Requires local Supabase with anon and service role keys'
  )

  let adminClient: ReturnType<typeof createClient<Database>>
  let anonClient: ReturnType<typeof createClient<Database>>

  test.beforeAll(async () => {
    adminClient = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY)
    anonClient = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY)
  })

  test('RPC EXECUTE REVOKE: anon or normal users cannot execute issue_funding_receipt or void_funding_receipt', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000001'
    const { error: issueErr } = await anonClient.rpc('issue_funding_receipt' as any, {
      p_fulfillment_id: fakeId,
      p_actor_profile_id: null,
      p_variant: 'non_charitable',
      p_payee_legal_name: 'Test',
      p_payee_ein_last4: null,
      p_payee_tax_classification: null,
      p_sponsor_legal_name: 'Sponsor',
      p_sponsor_contact_email: null,
      p_goods_or_services: null,
      p_goods_or_services_fmv_cents: null,
      p_document_html: '<div>test</div>',
      p_document_sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
      p_copy_version: '2026-08-v1',
      p_copy_reviewed_at: null,
    })

    /**
     * Both codes mean "anon cannot call this", and which one comes back depends on how
     * PostgREST resolved the name, not on how well the function is protected:
     *   42501 undefined_privilege — the function resolved and EXECUTE is revoked
     *   42883 undefined_function  — the overload was not visible to this role at all
     * Pinning to 42883 alone fails a correctly-locked-down database, so accept either and
     * assert the thing that actually matters: the call was refused.
     */
    const REFUSED = ['42501', '42883']
    expect(issueErr).not.toBeNull()
    expect(REFUSED).toContain(issueErr?.code)

    const { error: voidErr } = await anonClient.rpc('void_funding_receipt' as any, {
      p_receipt_id: fakeId,
      p_actor_profile_id: null,
      p_reason: 'Test void reason long enough',
    })

    expect(voidErr).not.toBeNull()
    expect(REFUSED).toContain(voidErr?.code)
  })

  test('Deny-all RLS on funding_receipt_counters: SELECT and PATCH are denied for anon', async () => {
    const { data } = await anonClient.from('funding_receipt_counters').select('*')
    expect(data?.length ?? 0).toBe(0)

    /**
     * A denied write under RLS is not an error — the UPDATE runs against a row set the
     * policy has already made empty, so PostgREST answers "0 rows changed, no error".
     * Asserting `error !== null` therefore fails on a correctly locked-down table. What
     * has to be true is that nothing changed, which is what is checked here: request the
     * updated rows back and assert none came.
     */
    const { data: updated } = await anonClient
      .from('funding_receipt_counters')
      .update({ last_value: 999 } as any)
      .eq('year', 2026)
      .select()

    expect(updated ?? []).toHaveLength(0)

    const { data: after } = await adminClient
      .from('funding_receipt_counters')
      .select('last_value')
      .eq('year', 2026)
      .maybeSingle()
    expect(after?.last_value ?? 0).not.toBe(999)
  })

  test('Deny-all write RLS on funding_receipts: UPDATE and DELETE policies do not exist for non-service roles', async () => {
    const { data: receipts } = await adminClient.from('funding_receipts').select('*').limit(1)
    if (receipts && receipts.length > 0) {
      const targetId = receipts[0].id
      // Same reasoning as the counters test above: a policy-denied write is a no-op, not
      // an error. Assert that no row was affected and the document survives untouched.
      const { data: updated } = await anonClient
        .from('funding_receipts')
        .update({ document_html: 'hacked' })
        .eq('id', targetId)
        .select()

      expect(updated ?? []).toHaveLength(0)

      const { data: deleted } = await anonClient
        .from('funding_receipts')
        .delete()
        .eq('id', targetId)
        .select()

      expect(deleted ?? []).toHaveLength(0)

      const { data: survivor } = await adminClient
        .from('funding_receipts')
        .select('id, document_html')
        .eq('id', targetId)
        .maybeSingle()
      expect(survivor?.id).toBe(targetId)
      expect(survivor?.document_html).not.toBe('hacked')
    }
  })
})
