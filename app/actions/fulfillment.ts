'use server'

import { z } from 'zod'
import { requireAdmin, requireSponsorRole, requireSuperAdmin, requireVerifiedCoach } from '@/lib/actions-utils'
import { createAdminClient } from '@/lib/supabase/admin'
import { createInAppNotification } from '@/lib/notify'
import { sponsorRecipientIds } from '@/lib/sponsor-recipients'
import { generateAndStoreReceipt } from '@/lib/receipts'
import { revalidatePath } from 'next/cache'
import {
  markPaymentSentSchema,
  confirmPaymentReceivedSchema,
  adminOverrideFulfillmentStatusSchema,
} from '@/lib/schemas/fulfillment'

function mapFulfillmentError(error: string): string {
  switch (error) {
    case 'unauthorized': return 'You do not have permission to perform this action.'
    case 'fulfillment_not_found': return 'Fulfillment not found.'
    case 'already_in_status': return 'The fulfillment is already in this status.'
    case 'receipt_issued': return 'Cannot change status after a receipt has been issued.'
    case 'already_cancelled': return 'Cannot change status of a cancelled fulfillment.'
    case 'illegal_transition': return 'Invalid status transition.'
    case 'payment_details_required': return 'Payment method is required to mark as sent.'
    case 'future_date': return 'Cannot use a future date.'
    default: return error
  }
}

export async function markPaymentSent(data: z.input<typeof markPaymentSentSchema>) {
  const parsed = markPaymentSentSchema.safeParse(data)
  if (!parsed.success) {
    return { error: 'Validation failed: ' + parsed.error.issues.map(i => i.message).join(', ') }
  }

  let user, supabase, adminClient, sponsorId
  try {
    ({ user, supabase, adminClient, sponsorId } = await requireSponsorRole('approver'))
  } catch (e: any) {
    return { error: e.message }
  }

  const { data: fulfillment, error: fetchErr } = await adminClient
    .from('funding_fulfillments')
    .select('sponsor_id, team_id, teams(owner_id), sponsors(company_name)')
    .eq('id', parsed.data.fulfillmentId)
    .single()

  if (fetchErr || !fulfillment || fulfillment.sponsor_id !== sponsorId) {
    return { error: 'Fulfillment not found.' }
  }

  const { data: rpcData, error: rpcError } = await adminClient.rpc('record_fulfillment_transition', {
    p_fulfillment_id: parsed.data.fulfillmentId,
    p_actor_profile_id: user.id,
    p_to_status: 'payment_sent',
    p_payment_method: parsed.data.paymentMethod,
    p_payment_reference: parsed.data.paymentReference || undefined,
    p_occurred_on: parsed.data.sentOn || undefined,
    p_note: parsed.data.note || undefined,
  })

  if (rpcError) return { error: rpcError.message }
  if (rpcData && !rpcData.ok) return { error: mapFulfillmentError(rpcData.error || 'Unknown error') }

  await adminClient.from('audit_log').insert({
    actor_id: user.id,
    action: 'mark_payment_sent',
    entity_type: 'funding_fulfillments',
    entity_id: parsed.data.fulfillmentId,
    metadata: {
      fulfillment_id: parsed.data.fulfillmentId,
      payment_method: parsed.data.paymentMethod,
    }
  })

  const ownerId = (fulfillment.teams as any)?.owner_id
  const companyName = (fulfillment.sponsors as any)?.company_name || 'A sponsor'

  if (ownerId) {
    const methodStr = parsed.data.paymentMethod ? ` by ${parsed.data.paymentMethod}` : ''
    await createInAppNotification({
      recipientId: ownerId,
      type: 'general',
      title: `${companyName} marked your sponsorship payment as sent`,
      body: `The sponsor has indicated that the payment was sent${methodStr}. Please keep an eye out for it and confirm receipt once it arrives.`
    })
  }

  revalidatePath('/sponsor/funding')
  revalidatePath('/dashboard')
  return { success: true }
}

export async function confirmPaymentReceived(data: z.input<typeof confirmPaymentReceivedSchema>) {
  const parsed = confirmPaymentReceivedSchema.safeParse(data)
  if (!parsed.success) {
    return { error: 'Validation failed: ' + parsed.error.issues.map(i => i.message).join(', ') }
  }

  let user, supabase, clerkUserId
  try {
    ({ user, supabase, clerkUserId } = await requireVerifiedCoach())
  } catch (e: any) {
    return { error: e.message, code: e.code }
  }

  // Admin client needed for cross-row operations (audit log, fetching sponsor contacts).
  // requireVerifiedCoach intentionally does not return one; createAdminClient() is the
  // correct server-side path for a verified-coach action that needs service-role access.
  const localAdminClient = createAdminClient()

  const { data: fulfillment, error: fetchErr } = await localAdminClient
    .from('funding_fulfillments')
    .select('sponsor_id, team_id, teams(owner_id, team_name)')
    .eq('id', parsed.data.fulfillmentId)
    .single()

  if (fetchErr || !fulfillment) {
    return { error: 'Fulfillment not found.' }
  }
  
  if ((fulfillment.teams as any)?.owner_id !== user.id) {
    return { error: 'Fulfillment not found.' }
  }

  const { data: rpcData, error: rpcError } = await localAdminClient.rpc('record_fulfillment_transition', {
    p_fulfillment_id: parsed.data.fulfillmentId,
    p_actor_profile_id: user.id,
    p_to_status: 'payment_received',
    p_occurred_on: parsed.data.receivedOn || null,
    p_note: parsed.data.note || undefined,
  })

  if (rpcError) return { error: rpcError.message }
  if (rpcData && !rpcData.ok) return { error: mapFulfillmentError(rpcData.error || 'Unknown error') }

  await localAdminClient.from('audit_log').insert({
    actor_id: user.id,
    action: 'confirm_payment_received',
    entity_type: 'funding_fulfillments',
    entity_id: parsed.data.fulfillmentId,
    metadata: {
      fulfillment_id: parsed.data.fulfillmentId,
    }
  })

  // Legacy profiles.sponsor_id holders UNIONed with sponsor_members. A profiles-only read
  // reaches nobody for a sponsor whose seats were filled by invitation (0082/0094).
  const sponsorsToNotify = await sponsorRecipientIds(localAdminClient, fulfillment.sponsor_id)

  const teamName = (fulfillment.teams as any)?.team_name || 'A team'

  if (sponsorsToNotify) {
    for (const recipientId of sponsorsToNotify) {
      await createInAppNotification({
        recipientId,
        type: 'general',
        title: `${teamName} received your payment`,
        body: `The coach for ${teamName} has confirmed receipt of your sponsorship payment.`
      })
    }
  }

  revalidatePath('/dashboard')
  revalidatePath('/sponsor/funding')
  revalidatePath('/reconciliation')

  const receiptRes = await generateAndStoreReceipt(localAdminClient, parsed.data.fulfillmentId, user.id)
  if (!receiptRes.ok) {
    return {
      success: true,
      warning: `Payment confirmation recorded, but automatic receipt issuance failed: ${receiptRes.error}. An administrator can manually issue the receipt.`,
    }
  }

  return { success: true }
}

export async function adminOverrideFulfillmentStatus(data: z.input<typeof adminOverrideFulfillmentStatusSchema>) {
  const parsed = adminOverrideFulfillmentStatusSchema.safeParse(data)
  if (!parsed.success) {
    return { error: 'Validation failed: ' + parsed.error.issues.map(i => i.message).join(', ') }
  }

  // Cancelling is the one override that MOVES MONEY. Since 0095 the cancelled transition
  // decrements sponsors.funding_used_cents and writes a funding_capacity_releases row, which
  // puts it in the same class as editing a funding cap — and that is requireSuperAdmin
  // (sponsor.ts:18,64). requireSuperAdmin's own contract says it "gates the acts that move
  // money". Every other override here only relabels a state, so it stays on requireAdmin:
  // a reviewer is still an admin.
  let user, supabase, adminClient
  try {
    ({ user, supabase, adminClient } =
      parsed.data.toStatus === 'cancelled' ? await requireSuperAdmin() : await requireAdmin())
  } catch (e: any) {
    return { error: e.message }
  }

  const { data: rpcData, error: rpcError } = await adminClient.rpc('record_fulfillment_transition', {
    p_fulfillment_id: parsed.data.fulfillmentId,
    p_actor_profile_id: user.id,
    p_to_status: parsed.data.toStatus,
    p_note: parsed.data.reason || undefined,
    p_payment_method: parsed.data.paymentMethod || undefined,
    p_occurred_on: parsed.data.occurredOn || undefined,
  })

  if (rpcError) return { error: rpcError.message }
  if (rpcData && !rpcData.ok) return { error: mapFulfillmentError(rpcData.error || 'Unknown error') }

  await adminClient.from('audit_log').insert({
    actor_id: user.id,
    action: 'admin_override_fulfillment',
    entity_type: 'funding_fulfillments',
    entity_id: parsed.data.fulfillmentId,
    metadata: {
      fulfillment_id: parsed.data.fulfillmentId,
      to_status: parsed.data.toStatus,
      reason: parsed.data.reason,
    }
  })

  const { data: fulfillment } = await adminClient
    .from('funding_fulfillments')
    .select('sponsor_id, team_id, teams(owner_id)')
    .eq('id', parsed.data.fulfillmentId)
    .single()

  if (fulfillment) {
    // Notify coach
    const ownerId = (fulfillment.teams as any)?.owner_id
    if (ownerId) {
      await createInAppNotification({
        recipientId: ownerId,
        type: 'general',
        title: 'Status changed on sponsorship payment',
        body: `An administrator updated the payment status to ${parsed.data.toStatus.replace('_', ' ')}. Reason: ${parsed.data.reason}`
      })
    }
    
    // Legacy + sponsor_members, same reason as above.
    const sponsorsToNotify = await sponsorRecipientIds(adminClient, fulfillment.sponsor_id)

    if (sponsorsToNotify) {
      for (const recipientId of sponsorsToNotify) {
        await createInAppNotification({
          recipientId,
          type: 'general',
          title: 'Status changed on sponsorship payment',
          body: `An administrator updated the payment status to ${parsed.data.toStatus.replace('_', ' ')}. Reason: ${parsed.data.reason}`
        })
      }
    }
  }

  revalidatePath('/dashboard')
  revalidatePath('/sponsor/funding')
  return { success: true }
}
