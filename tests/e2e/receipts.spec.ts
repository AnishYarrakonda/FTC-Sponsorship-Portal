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

    expect(issueErr).not.toBeNull()
    expect(issueErr?.code).toBe('42883') // function does not exist or permission denied for anon

    const { error: voidErr } = await anonClient.rpc('void_funding_receipt' as any, {
      p_receipt_id: fakeId,
      p_actor_profile_id: null,
      p_reason: 'Test void reason long enough',
    })

    expect(voidErr).not.toBeNull()
    expect(voidErr?.code).toBe('42883')
  })

  test('Deny-all RLS on funding_receipt_counters: SELECT and PATCH are denied for anon', async () => {
    const { data, error } = await anonClient.from('funding_receipt_counters').select('*')
    expect(data?.length ?? 0).toBe(0)

    const { error: updateErr } = await anonClient
      .from('funding_receipt_counters')
      .update({ last_value: 999 } as any)
      .eq('year', 2026)

    expect(updateErr).not.toBeNull()
  })

  test('Deny-all write RLS on funding_receipts: UPDATE and DELETE policies do not exist for non-service roles', async () => {
    const { data: receipts } = await adminClient.from('funding_receipts').select('*').limit(1)
    if (receipts && receipts.length > 0) {
      const targetId = receipts[0].id
      const { error: updateErr } = await anonClient
        .from('funding_receipts')
        .update({ document_html: 'hacked' })
        .eq('id', targetId)

      expect(updateErr).not.toBeNull()

      const { error: deleteErr } = await anonClient
        .from('funding_receipts')
        .delete()
        .eq('id', targetId)

      expect(deleteErr).not.toBeNull()
    }
  })
})
