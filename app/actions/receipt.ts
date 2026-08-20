'use server'

import { z } from 'zod'
import { requireAdmin } from '@/lib/actions-utils'
import { createInAppNotification, sendFundingReceiptEmail } from '@/lib/notify'
import { generateAndStoreReceipt } from '@/lib/receipts'
import { revalidatePath } from 'next/cache'
import { LIMITS } from '@/lib/schemas/limits'

const issueReceiptSchema = z.object({
  fulfillmentId: z.string().uuid(),
})

const voidReceiptSchema = z.object({
  receiptId: z.string().uuid(),
  reason: z.string().trim().min(10, 'Reason must be at least 10 characters').max(LIMITS.fulfillmentNote),
})

const reissueReceiptSchema = z.object({
  receiptId: z.string().uuid(),
  reason: z.string().trim().min(10, 'Reason must be at least 10 characters').max(LIMITS.fulfillmentNote),
})

const resendReceiptSchema = z.object({
  receiptId: z.string().uuid(),
})

export async function issueReceiptForFulfillment(data: z.input<typeof issueReceiptSchema>) {
  const parsed = issueReceiptSchema.safeParse(data)
  if (!parsed.success) {
    return { error: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', ') }
  }

  let user, adminClient
  try {
    ;({ user, adminClient } = await requireAdmin())
  } catch (e: any) {
    return { error: e.message }
  }

  const res = await generateAndStoreReceipt(adminClient, parsed.data.fulfillmentId, user.id)
  if (!res.ok) {
    return { error: res.error }
  }

  revalidatePath('/reconciliation')
  revalidatePath('/sponsor/funding')
  revalidatePath('/dashboard')

  return { success: true, receiptNumber: res.receiptNumber }
}

export async function voidReceipt(data: z.input<typeof voidReceiptSchema>) {
  const parsed = voidReceiptSchema.safeParse(data)
  if (!parsed.success) {
    return { error: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', ') }
  }

  let user, adminClient
  try {
    ;({ user, adminClient } = await requireAdmin())
  } catch (e: any) {
    return { error: e.message }
  }

  // Fetch receipt details for notification
  const { data: receipt } = await adminClient
    .from('funding_receipts')
    .select('*, sponsors(id, company_name), teams(owner_id)')
    .eq('id', parsed.data.receiptId)
    .single()

  if (!receipt) {
    return { error: 'Receipt not found.' }
  }

  const { data: rpcRes, error: rpcErr } = await adminClient.rpc('void_funding_receipt', {
    p_receipt_id: parsed.data.receiptId,
    p_actor_profile_id: user.id,
    p_reason: parsed.data.reason,
  })

  if (rpcErr) return { error: rpcErr.message }

  const rpcData = rpcRes as { ok: boolean; error?: string }
  if (!rpcData.ok) return { error: rpcData.error || 'Failed to void receipt.' }

  // Notify both counterparties
  const sponsorId = receipt.sponsor_id
  const teamOwnerId = (receipt.teams as any)?.owner_id

  if (sponsorId) {
    const { data: sponsorProfiles } = await adminClient
      .from('profiles')
      .select('id')
      .eq('role', 'sponsor')
      .eq('sponsor_id', sponsorId)

    if (sponsorProfiles) {
      for (const spUser of sponsorProfiles) {
        await createInAppNotification({
          recipientId: spUser.id,
          type: 'general',
          title: `Receipt ${receipt.receipt_number} voided`,
          body: `Receipt ${receipt.receipt_number} was voided by an administrator. Reason: ${parsed.data.reason}`,
        })
      }
    }
  }

  if (teamOwnerId) {
    await createInAppNotification({
      recipientId: teamOwnerId,
      type: 'general',
      title: `Receipt ${receipt.receipt_number} voided`,
      body: `Receipt ${receipt.receipt_number} was voided by an administrator. Reason: ${parsed.data.reason}`,
    })
  }

  revalidatePath('/reconciliation')
  revalidatePath('/sponsor/funding')
  revalidatePath('/dashboard')

  return { success: true }
}

export async function reissueReceipt(data: z.input<typeof reissueReceiptSchema>) {
  const parsed = reissueReceiptSchema.safeParse(data)
  if (!parsed.success) {
    return { error: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', ') }
  }

  let user, adminClient
  try {
    ;({ user, adminClient } = await requireAdmin())
  } catch (e: any) {
    return { error: e.message }
  }

  const { data: receipt } = await adminClient
    .from('funding_receipts')
    .select('*')
    .eq('id', parsed.data.receiptId)
    .single()

  if (!receipt) {
    return { error: 'Receipt not found.' }
  }

  // 1. If not voided, void first
  if (receipt.status !== 'voided') {
    const voidRes = await adminClient.rpc('void_funding_receipt', {
      p_receipt_id: parsed.data.receiptId,
      p_actor_profile_id: user.id,
      p_reason: parsed.data.reason,
    })

    const voidData = voidRes.data as { ok: boolean; error?: string }
    if (voidRes.error || !voidData?.ok) {
      return { error: voidRes.error?.message || voidData?.error || 'Failed to void original receipt before reissue.' }
    }
  }

  // 2. Issue new replacement receipt
  const genRes = await generateAndStoreReceipt(adminClient, receipt.fulfillment_id, user.id, {
    supersedesReceiptId: parsed.data.receiptId,
  })

  if (!genRes.ok) {
    return {
      error: `Original receipt was voided, but issuing replacement receipt failed: ${genRes.error}. You can retry issuance from the reconciliation page.`,
    }
  }

  revalidatePath('/reconciliation')
  revalidatePath('/sponsor/funding')
  revalidatePath('/dashboard')

  return { success: true, receiptNumber: genRes.receiptNumber }
}

export async function resendReceiptEmail(data: z.input<typeof resendReceiptSchema>) {
  const parsed = resendReceiptSchema.safeParse(data)
  if (!parsed.success) {
    return { error: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', ') }
  }

  let user, adminClient
  try {
    ;({ user, adminClient } = await requireAdmin())
  } catch (e: any) {
    return { error: e.message }
  }

  const { data: receipt } = await adminClient
    .from('funding_receipts')
    .select('id, receipt_number, document_html, sponsor_contact_email, issued_at, sponsors(contact_email), teams(owner_id)')
    .eq('id', parsed.data.receiptId)
    .single()

  if (!receipt) {
    return { error: 'Receipt not found.' }
  }

  const sponsorEmail = receipt.sponsor_contact_email || (receipt.sponsors as any)?.contact_email

  if (!sponsorEmail) {
    return { error: 'Sponsor contact email is not available.' }
  }

  // Fetch coach email for replyTo
  let coachEmail: string | undefined
  const teamOwnerId = (receipt.teams as any)?.owner_id
  if (teamOwnerId) {
    const { data: coachProf } = await adminClient
      .from('profiles')
      .select('email')
      .eq('id', teamOwnerId)
      .single()
    if (coachProf?.email) coachEmail = coachProf.email
  }

  // Re-send the immutably stored document_html — NOT a fresh render.
  // A fresh render would silently pick up any template changes made since the original
  // issue, meaning a year-old receipt could reference law or language that didn't exist
  // when it was issued. The archived document is the legal record; the email must match it.
  const emailRes = await sendFundingReceiptEmail({
    receiptId: receipt.id,
    receiptNumber: receipt.receipt_number,
    to: sponsorEmail,
    replyTo: coachEmail,
    rawHtml: receipt.document_html,
    isResend: true,
  })

  if (!emailRes.success) {
    return { error: emailRes.error || 'Failed to resend email.' }
  }

  await adminClient
    .from('funding_receipts')
    .update({ emailed_at: new Date().toISOString() })
    .eq('id', receipt.id)

  await adminClient.from('audit_log').insert({
    actor_id: user.id,
    action: 'resend_funding_receipt',
    entity_type: 'funding_receipts',
    entity_id: receipt.id,
    metadata: {
      receipt_number: receipt.receipt_number,
      recipient: sponsorEmail,
    },
  })

  return { success: true }
}
