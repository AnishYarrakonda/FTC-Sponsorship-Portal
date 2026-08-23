import { SupabaseClient } from '@supabase/supabase-js'
import { Database } from './supabase/types'
import { createInAppNotification, sendFundingReceiptEmail } from '@/lib/notify'
import {
  formatReceiptNumber,
  RECEIPT_COPY_REVIEWED_AT,
  RECEIPT_COPY_VERSION,
  resolveReceiptVariant,
} from '@/lib/receipt-copy'
import { renderReceiptDocument, ReceiptDocumentContext } from '@/lib/receipt-document'

function mapReceiptError(err: string): string {
  switch (err) {
    case 'unauthorized':
      return 'You do not have permission to issue receipts.'
    case 'fulfillment_not_found':
      return 'Fulfillment not found.'
    case 'not_receiptable':
      return 'Fulfillment is not in a state that can be receipted.'
    case 'invalid_supersedes_receipt':
      return 'The receipt to supersede is invalid or not voided.'
    case 'document_hash_mismatch':
      return 'Document verification failed (hash mismatch).'
    case 'reason_required':
      return 'A reason of at least 10 characters is required.'
    default:
      return err
  }
}

export async function generateAndStoreReceipt(
  adminClient: SupabaseClient<Database>,
  fulfillmentId: string,
  actorProfileId: string | null,
  opts?: { supersedesReceiptId?: string }
): Promise<{ ok: true; receiptNumber: string; alreadyIssued: boolean } | { ok: false; error: string }> {
  // 1. Fetch fulfillment and related entities
  const { data: fulfillment, error: fErr } = await adminClient
    .from('funding_fulfillments')
    .select('*, teams(id, team_name, tax_status, owner_id), sponsors(id, company_name, contact_email)')
    .eq('id', fulfillmentId)
    .single()

  if (fErr || !fulfillment) {
    return { ok: false, error: 'Fulfillment not found.' }
  }

  const team = fulfillment.teams as { id: string; team_name: string; tax_status: '501c3' | 'School' | 'None' | null; owner_id: string } | null
  const sponsor = fulfillment.sponsors as { id: string; company_name: string; contact_email: string | null } | null

  if (!sponsor) {
    return { ok: false, error: 'Sponsor record not found for fulfillment.' }
  }

  // Fetch payout profile if team exists
  let payoutProfile: {
    legal_payee_name: string
    tax_classification: any
    ein_last4: string | null
    is_fiscally_sponsored: boolean
    fiscal_sponsor_name: string | null
    w9_verified_at: string | null
  } | null = null

  if (team?.id) {
    const { data: pop } = await adminClient
      .from('team_payout_profiles')
      .select('legal_payee_name, tax_classification, ein_last4, is_fiscally_sponsored, fiscal_sponsor_name, w9_verified_at')
      .eq('team_id', team.id)
      .maybeSingle()

    if (pop) {
      payoutProfile = pop as any
    }
  }

  // Fetch coach email for replyTo
  let coachEmail: string | null = null
  if (team?.owner_id) {
    const { data: coachProf } = await adminClient
      .from('profiles')
      .select('email')
      .eq('id', team.owner_id)
      .single()
    if (coachProf?.email) coachEmail = coachProf.email
  }

  // 2. Resolve variant
  let variant = resolveReceiptVariant({
    teamTaxStatus: team?.tax_status ?? null,
    taxClassification: payoutProfile?.tax_classification ?? null,
    w9VerifiedAt: payoutProfile?.w9_verified_at ?? null,
  })

  // 3. Payee legal name fallback & missing profile notification
  let payeeLegalName = payoutProfile?.legal_payee_name?.trim() || ''
  let whenNoVerifiedProfile = false

  if (!payeeLegalName) {
    payeeLegalName = team?.team_name || 'FTC Robotics Team'
    variant = 'non_charitable'
    whenNoVerifiedProfile = true

    if (team?.owner_id) {
      await createInAppNotification({
        recipientId: team.owner_id,
        type: 'general',
        title: 'Action recommended: Complete payout profile',
        body: 'A receipt was issued for a payment received by your team, but because your payout profile is incomplete, it was issued as a non-charitable payment record. Complete your payout profile to allow official tax-deductible acknowledgments.',
      })
    }
  }

  /**
   * 4. EIN — LAST FOUR ONLY. Never the full number.
   *
   * This used to decrypt the full EIN via get_payout_ein() and print it into the document.
   * That HTML is then persisted verbatim in funding_receipts.document_html and emailed
   * through Resend, so the plaintext EIN outlived the encryption boundary that
   * PAYOUT_ENCRYPTION_KEY exists to draw: any DB export, admin viewer, or intercepted
   * email exposed it, and rotating the key could not reach receipts already issued.
   *
   * Nothing is lost by dropping it. An IRS written acknowledgment under §170(f)(8) has to
   * name the donee, the amount, the date, and whether goods or services were exchanged —
   * the donee's EIN is not a required element.
   */
  const payeeEinLast4 = variant === 'non_charitable' ? null : payoutProfile?.ein_last4 || null

  // 5. Predict receipt number for Node render
  const currentYear = new Date().getUTCFullYear()
  const { data: counterRow } = await adminClient
    .from('funding_receipt_counters')
    .select('last_value')
    .eq('year', currentYear)
    .maybeSingle()

  const nextSeq = (counterRow?.last_value ? Number(counterRow.last_value) : 0) + 1
  const predictedReceiptNumber = formatReceiptNumber(currentYear, nextSeq)

  const contributionDate = fulfillment.payment_received_at
    ? new Date(fulfillment.payment_received_at).toISOString().split('T')[0]
    : new Date().toISOString().split('T')[0]

  const issuedAtDate = new Date().toISOString().split('T')[0]

  const docCtx: ReceiptDocumentContext = {
    receiptNumber: predictedReceiptNumber,
    issuedAt: issuedAtDate,
    contributionDate,
    amountCents: fulfillment.amount_cents,
    variant,
    payeeLegalName,
    payeeEinLast4: payeeEinLast4 || undefined,
    payeeTaxClassification: payoutProfile?.tax_classification || undefined,
    sponsorLegalName: sponsor.company_name,
    sponsorContactEmail: sponsor.contact_email || undefined,
    isFiscallySponsored: payoutProfile?.is_fiscally_sponsored || false,
    fiscalSponsorName: payoutProfile?.fiscal_sponsor_name || undefined,
    whenNoVerifiedProfile,
  }

  const { html, sha256 } = await renderReceiptDocument(docCtx)

  // 6. Call RPC to mint receipt atomically
  const { data: rpcRes, error: rpcErr } = await adminClient.rpc('issue_funding_receipt', {
    p_fulfillment_id: fulfillmentId,
    p_actor_profile_id: actorProfileId,
    p_variant: variant,
    p_payee_legal_name: payeeLegalName,
    p_payee_ein_last4: payeeEinLast4,
    p_payee_tax_classification: payoutProfile?.tax_classification || null,
    p_sponsor_legal_name: sponsor.company_name,
    p_sponsor_contact_email: sponsor.contact_email || null,
    p_goods_or_services: null,
    p_goods_or_services_fmv_cents: null,
    p_document_html: html,
    p_document_sha256: sha256,
    p_copy_version: RECEIPT_COPY_VERSION,
    p_copy_reviewed_at: RECEIPT_COPY_REVIEWED_AT,
    p_supersedes_receipt_id: opts?.supersedesReceiptId || null,
  })

  if (rpcErr) {
    return { ok: false, error: rpcErr.message }
  }

  const rpcData = rpcRes as { ok: boolean; error?: string; receipt_id?: string; receipt_number?: string; already_issued?: boolean }

  if (!rpcData.ok) {
    return { ok: false, error: mapReceiptError(rpcData.error || 'unknown_error') }
  }

  const receiptId = rpcData.receipt_id!
  const finalReceiptNumber = rpcData.receipt_number || predictedReceiptNumber
  const alreadyIssued = Boolean(rpcData.already_issued)

  if (alreadyIssued) {
    return { ok: true, receiptNumber: finalReceiptNumber, alreadyIssued: true }
  }

  // Race-condition correction: if a concurrent issuance ran between our counter peek
  // and the RPC's atomic increment, the DB row has the correct number but the stored
  // document_html shows the predicted (wrong) number. Re-render and patch before the
  // sponsor ever sees the document.
  if (finalReceiptNumber !== predictedReceiptNumber) {
    docCtx.receiptNumber = finalReceiptNumber
    const { html: correctedHtml, sha256: correctedHash } = await renderReceiptDocument(docCtx)
    await adminClient
      .from('funding_receipts')
      .update({ document_html: correctedHtml, document_sha256: correctedHash })
      .eq('id', receiptId)
  }

  // 7. Email and in-app notifications
  if (sponsor.contact_email) {
    const emailRes = await sendFundingReceiptEmail({
      receiptId,
      receiptNumber: finalReceiptNumber,
      to: sponsor.contact_email,
      replyTo: coachEmail || undefined,
      ctx: docCtx,
    })

    if (emailRes.success) {
      await adminClient
        .from('funding_receipts')
        .update({ emailed_at: new Date().toISOString() })
        .eq('id', receiptId)
    }
  }

  // Fan out in-app notification to sponsor profiles
  const { data: sponsorProfiles } = await adminClient
    .from('profiles')
    .select('id')
    .eq('role', 'sponsor')
    .eq('sponsor_id', sponsor.id)

  if (sponsorProfiles) {
    for (const spUser of sponsorProfiles) {
      await createInAppNotification({
        recipientId: spUser.id,
        type: 'general',
        title: `Receipt ${finalReceiptNumber} issued`,
        body: `An official tax receipt of $${(fulfillment.amount_cents / 100).toLocaleString()} has been issued for your contribution to ${payeeLegalName}.`,
        skipEmail: true, // sponsor received the dedicated receipt email above
      })
    }
  }

  // Notify coach
  if (team?.owner_id) {
    await createInAppNotification({
      recipientId: team.owner_id,
      type: 'general',
      title: `Receipt ${finalReceiptNumber} issued to ${sponsor.company_name}`,
      body: `An official contribution receipt of $${(fulfillment.amount_cents / 100).toLocaleString()} was issued to ${sponsor.company_name}.`,
      skipEmail: false,
    })
  }

  return { ok: true, receiptNumber: finalReceiptNumber, alreadyIssued: false }
}
