'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  requireAdmin,
  requireSponsor,
  requireSponsorRole,
  requireVerifiedCoach,
} from '@/lib/actions-utils'
import { createInAppNotification } from '@/lib/notify'
import { validateUploadedFile, IMAGE_MIMES } from '@/lib/file-validation'
import { recognitionBenefitLabel, isRecognitionBenefitType } from '@/lib/recognition'
import {
  markBenefitSchema,
  waiveBenefitSchema,
  adminSetBenefitStatusSchema,
  adminVoidProofSchema,
  uploadBenefitProofSchema,
  upsertTierSchema,
  archiveTierSchema,
  type RecognitionActionResult,
} from '@/lib/schemas/recognition'

/**
 * Recognition benefit fulfillment.
 *
 * Every write goes through a SECURITY DEFINER RPC on the admin client — the three
 * recognition tables have SELECT policies only. The pre-checks in this file are the
 * friendly path (so a coach gets "Benefit not found" instead of a raw error code); the
 * RPC re-checks everything and is the actual authority.
 *
 * Two rules this file must never break:
 *  - No proof URL in an audit_log payload, a notification body, or an email. The URL is
 *    public and permanent; audit_log has no expiry.
 *  - No Resend import and no new send site. dispatchApprovedSubmission stays the only
 *    path that emails a pitch to a sponsor. Asserted by an invariant test.
 */

const PROOF_MAX_BYTES = 5 * 1024 * 1024

/** Reads inside a sentence, unlike the raw enum value. Admin override copy only. */
const BENEFIT_STATUS_WORDS: Record<string, string> = {
  promised: 'promised',
  in_progress: 'in progress',
  delivered: 'delivered',
  waived: 'waived',
  not_applicable: 'not applicable',
}

function mapRecognitionError(code: string | undefined): string {
  const messages: Record<string, string> = {
    unauthorized: 'You do not have permission to do that.',
    delivery_not_found: 'Benefit not found.',
    role_not_permitted: 'Your role cannot set that status on this benefit.',
    already_waived: 'The sponsor waived this benefit. An administrator can reopen it.',
    already_in_status: 'This benefit is already in that state.',
    no_minors_affirmation_required:
      'You must confirm the photo contains no students before uploading.',
    invalid_proof_url: 'That proof file could not be verified. Please try uploading again.',
    reason_required: 'Give a reason of at least 10 characters.',
    tier_not_found: 'Recognition tier not found.',
    invalid_range: 'The upper bound must be greater than the lower bound.',
    multiple_open_tiers: 'Another tier is already open-ended. Give that one an upper bound first.',
    last_live_tier: 'This is the only live tier. Add another before archiving this one.',
  }
  return messages[code ?? ''] ?? 'Unable to update recognition.'
}

type RpcResult = { ok?: boolean; error?: string; conflict?: string } | null

function rpcFailure(result: RpcResult, rpcError: { message: string } | null): string | null {
  if (rpcError) return rpcError.message
  if (!result || result.ok !== true) {
    if (result?.error === 'overlapping_tier') {
      return result.conflict
        ? `That range overlaps the “${result.conflict}” tier.`
        : 'That range overlaps another tier.'
    }
    return mapRecognitionError(result?.error)
  }
  return null
}

type AdminClient = ReturnType<typeof createAdminClient>

interface DeliveryContext {
  id: string
  benefit_type: string
  status: string
  award_id: string
  sponsor_id: string
  team_id: string | null
}

/** Loads the delivery plus the award columns every caller needs to authorise and notify. */
async function loadDelivery(
  adminClient: AdminClient,
  deliveryId: string
): Promise<DeliveryContext | null> {
  const { data } = await adminClient
    .from('recognition_benefit_deliveries')
    .select('id, benefit_type, status, award_id, sponsor_recognition_awards!inner(sponsor_id, team_id)')
    .eq('id', deliveryId)
    .maybeSingle()

  if (!data) return null
  const award = (data as { sponsor_recognition_awards?: { sponsor_id: string; team_id: string | null } })
    .sponsor_recognition_awards
  if (!award) return null

  return {
    id: data.id as string,
    benefit_type: data.benefit_type as string,
    status: data.status as string,
    award_id: data.award_id as string,
    sponsor_id: award.sponsor_id,
    team_id: award.team_id,
  }
}

function benefitLabel(benefitType: string): string {
  return isRecognitionBenefitType(benefitType) ? recognitionBenefitLabel(benefitType) : 'A benefit'
}

/**
 * Every profile that can act for a sponsor company: the legacy profiles.sponsor_id holders
 * AND sponsor_members rows (0082). The single-column version that predates sponsor orgs
 * silently notifies nobody for a multi-user sponsor.
 */
async function sponsorRecipients(adminClient: AdminClient, sponsorId: string): Promise<string[]> {
  const [legacy, members] = await Promise.all([
    adminClient.from('profiles').select('id').eq('role', 'sponsor').eq('sponsor_id', sponsorId),
    adminClient.from('sponsor_members').select('profile_id').eq('sponsor_id', sponsorId),
  ])
  const ids = new Set<string>()
  for (const r of legacy.data ?? []) ids.add(r.id as string)
  for (const r of members.data ?? []) ids.add(r.profile_id as string)
  return Array.from(ids)
}

async function teamOwnerId(adminClient: AdminClient, teamId: string | null): Promise<string | null> {
  if (!teamId) return null
  const { data } = await adminClient.from('teams').select('owner_id').eq('id', teamId).maybeSingle()
  return (data?.owner_id as string | undefined) ?? null
}

async function teamName(adminClient: AdminClient, teamId: string | null): Promise<string> {
  if (!teamId) return 'A team'
  const { data } = await adminClient.from('teams').select('team_name').eq('id', teamId).maybeSingle()
  return (data?.team_name as string | undefined) ?? 'A team'
}

function revalidateRecognition() {
  revalidatePath('/dashboard')
  revalidatePath('/sponsor/recognition')
  revalidatePath('/recognition')
}

// ─────────────────────────────────────────────────────────────────────────────
// Coach
// ─────────────────────────────────────────────────────────────────────────────

export async function markBenefitDelivered(input: {
  deliveryId: string
  status: 'promised' | 'in_progress' | 'delivered'
  note?: string
}): Promise<RecognitionActionResult> {
  const parsed = markBenefitSchema.safeParse(input)
  if (!parsed.success) {
    return { error: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', ') }
  }

  let user, adminClient
  try {
    ;({ user } = await requireVerifiedCoach())
    adminClient = createAdminClient()
  } catch (e: any) {
    return { error: e.message }
  }

  const delivery = await loadDelivery(adminClient, parsed.data.deliveryId)
  // Never leak that a benefit exists for a team the caller does not own.
  if (!delivery) return { error: 'Benefit not found.' }
  const ownerId = await teamOwnerId(adminClient, delivery.team_id)
  if (!ownerId || ownerId !== user.id) return { error: 'Benefit not found.' }

  const { data: result, error: rpcError } = await (adminClient as any).rpc('record_benefit_delivery', {
    p_delivery_id: parsed.data.deliveryId,
    p_actor_profile_id: user.id,
    p_status: parsed.data.status,
    p_note: parsed.data.note ?? null,
  })

  const failure = rpcFailure(result as RpcResult, rpcError)
  // already_in_status is a soft error: the coach clicked the state it is already in.
  if (failure && (result as RpcResult)?.error !== 'already_in_status') return { error: failure }

  await adminClient.from('audit_log').insert({
    actor_id: user.id,
    action: 'mark_benefit_delivered',
    entity_type: 'recognition_benefit_deliveries',
    entity_id: parsed.data.deliveryId,
    metadata: {
      delivery_id: parsed.data.deliveryId,
      benefit_type: delivery.benefit_type,
      status: parsed.data.status,
    },
  })

  if (parsed.data.status === 'delivered') {
    const name = await teamName(adminClient, delivery.team_id)
    const label = benefitLabel(delivery.benefit_type)
    for (const recipientId of await sponsorRecipients(adminClient, delivery.sponsor_id)) {
      await createInAppNotification({
        recipientId,
        type: 'general',
        title: `${name} delivered a sponsorship benefit`,
        body: `${label} is now marked delivered. You can review it under Recognition in your portal.`,
      })
    }
  }

  revalidateRecognition()
  return { success: true }
}

export async function uploadBenefitProof(
  deliveryId: string,
  formData: FormData
): Promise<RecognitionActionResult> {
  // The id is a raw client argument and it decides a Storage object key below, so it is
  // parsed before anything else runs — a uuid cannot carry a path separator.
  const parsed = uploadBenefitProofSchema.safeParse({ deliveryId })
  if (!parsed.success) {
    return { error: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', ') }
  }

  let user, clerkUserId, supabase, adminClient
  try {
    ;({ user, clerkUserId, supabase } = await requireVerifiedCoach())
    adminClient = createAdminClient()
  } catch (e: any) {
    return { error: e.message }
  }

  // The affirmation is checked BEFORE the file is touched, so a refused upload writes
  // nothing to storage — the acceptance criterion asserts the object does not exist, not
  // merely that the action errored.
  if (formData.get('noMinorsConfirmed') !== 'true') {
    return { error: 'You must confirm the photo contains no students before uploading.' }
  }

  const file = formData.get('file') as File | null
  if (!file || file.size === 0) return { error: 'No file provided.' }

  // Ownership is proven BEFORE anything is written — the exact bug uploadTeamLogo fixed:
  // a zero-row UPDATE is not an error, so a caller-supplied id once wrote a file to
  // storage and still returned success.
  const delivery = await loadDelivery(adminClient, parsed.data.deliveryId)
  if (!delivery) return { error: 'Benefit not found.' }
  const ownerId = await teamOwnerId(adminClient, delivery.team_id)
  if (!ownerId || ownerId !== user.id) return { error: 'Benefit not found.' }

  // Checked BEFORE the upload, from the row just loaded: pitch-media has no DELETE policy
  // and 0087 deliberately declined to have the service role delete from it, so anything
  // written here is permanent and public. A waived benefit is the one RPC rejection a coach
  // can actually hit, and rejecting it now is the difference between an error and an
  // orphaned photo nothing references and nobody can remove. A rejection that only the RPC
  // can see (a concurrent waive, a delete mid-upload) still leaves the object behind; that
  // is a narrow race, not the ordinary path.
  if (delivery.status === 'waived') {
    return { error: mapRecognitionError('already_waived') }
  }

  const validation = await validateUploadedFile(file, {
    allowedMimes: IMAGE_MIMES,
    maxBytes: PROOF_MAX_BYTES,
    label: 'Proof photo',
  })
  if (validation.error) return { error: validation.error }
  const { ext, mime } = validation

  // The Clerk id MUST be the first path segment or the pitch-media storage policy rejects
  // the insert. upsert:false because the bucket has no UPDATE policy — the timestamp
  // suffix makes every attempt a fresh key.
  const filePath = `${clerkUserId}/recognition/${parsed.data.deliveryId}-${Date.now()}.${ext}`
  const { error: uploadError } = await supabase.storage
    .from('pitch-media')
    .upload(filePath, file, { upsert: false, contentType: mime })
  if (uploadError) return { error: uploadError.message }

  const { data: urlData } = supabase.storage.from('pitch-media').getPublicUrl(filePath)

  const { data: result, error: rpcError } = await (adminClient as any).rpc('record_benefit_delivery', {
    p_delivery_id: parsed.data.deliveryId,
    p_actor_profile_id: user.id,
    // Attaching proof does not by itself change the state — the coach ticks "delivered"
    // separately. Passing the current status keeps this a proof-only write.
    p_status: delivery.status,
    p_proof_url: urlData.publicUrl,
    p_no_minors_confirmed: true,
  })

  const failure = rpcFailure(result as RpcResult, rpcError)
  if (failure) return { error: failure }

  // The URL is deliberately absent from this metadata.
  await adminClient.from('audit_log').insert({
    actor_id: user.id,
    action: 'upload_benefit_proof',
    entity_type: 'recognition_benefit_deliveries',
    entity_id: parsed.data.deliveryId,
    metadata: { delivery_id: parsed.data.deliveryId, benefit_type: delivery.benefit_type },
  })

  // NO STEP 5, DELIBERATELY. Attaching proof does not change the benefit's state — the RPC
  // is passed the CURRENT status — and markBenefitDelivered is what tells the sponsor the
  // benefit landed. Notifying here would mean two messages for one coach action.
  revalidateRecognition()
  return { success: true, url: urlData.publicUrl }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sponsor
// ─────────────────────────────────────────────────────────────────────────────

export async function waiveBenefit(input: {
  deliveryId: string
  note?: string
}): Promise<RecognitionActionResult> {
  const parsed = waiveBenefitSchema.safeParse(input)
  if (!parsed.success) {
    return { error: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', ') }
  }

  // requireSponsor() admits ANY member regardless of rank, and record_benefit_delivery
  // classifies the actor only as sponsor/coach/admin — it never checks member rank — so
  // before this a `viewer` could waive a benefit. Waiving permanently discharges something
  // the team owes the sponsor, which is an act, and the ladder already puts acts at
  // `submitter` (messages.ts:125-128 makes the same argument for asking a question, which is
  // strictly less consequential). Legacy single-seat sponsors are unaffected:
  // LEGACY_MEMBER_ROLE is org_admin.
  let user, sponsorIds, adminClient
  try {
    ;({ user, sponsorIds, adminClient } = await requireSponsorRole('submitter'))
  } catch (e: any) {
    return { error: e.message }
  }

  const delivery = await loadDelivery(adminClient, parsed.data.deliveryId)
  if (!delivery || !sponsorIds.includes(delivery.sponsor_id)) return { error: 'Benefit not found.' }

  const { data: result, error: rpcError } = await (adminClient as any).rpc('record_benefit_delivery', {
    p_delivery_id: parsed.data.deliveryId,
    p_actor_profile_id: user.id,
    p_status: 'waived',
    p_note: parsed.data.note ?? null,
  })

  const failure = rpcFailure(result as RpcResult, rpcError)
  if (failure) return { error: failure }

  await adminClient.from('audit_log').insert({
    actor_id: user.id,
    action: 'waive_benefit',
    entity_type: 'recognition_benefit_deliveries',
    entity_id: parsed.data.deliveryId,
    metadata: { delivery_id: parsed.data.deliveryId, benefit_type: delivery.benefit_type },
  })

  const ownerId = await teamOwnerId(adminClient, delivery.team_id)
  if (ownerId) {
    await createInAppNotification({
      recipientId: ownerId,
      type: 'general',
      title: 'A sponsor waived a recognition benefit',
      body: `${benefitLabel(delivery.benefit_type)} is no longer required. Nothing further is owed for it.`,
    })
  }

  revalidateRecognition()
  return { success: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin
// ─────────────────────────────────────────────────────────────────────────────

export async function adminSetBenefitStatus(input: {
  deliveryId: string
  status: 'promised' | 'in_progress' | 'delivered' | 'waived' | 'not_applicable'
  reason: string
}): Promise<RecognitionActionResult> {
  const parsed = adminSetBenefitStatusSchema.safeParse(input)
  if (!parsed.success) {
    return { error: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', ') }
  }

  let user, adminClient
  try {
    ;({ user, adminClient } = await requireAdmin())
  } catch (e: any) {
    return { error: e.message }
  }

  const delivery = await loadDelivery(adminClient, parsed.data.deliveryId)
  if (!delivery) return { error: 'Benefit not found.' }

  const { data: result, error: rpcError } = await (adminClient as any).rpc('record_benefit_delivery', {
    p_delivery_id: parsed.data.deliveryId,
    p_actor_profile_id: user.id,
    p_status: parsed.data.status,
  })

  const failure = rpcFailure(result as RpcResult, rpcError)
  if (failure && (result as RpcResult)?.error !== 'already_in_status') return { error: failure }

  await adminClient.from('audit_log').insert({
    actor_id: user.id,
    action: 'admin_set_benefit_status',
    entity_type: 'recognition_benefit_deliveries',
    entity_id: parsed.data.deliveryId,
    metadata: {
      delivery_id: parsed.data.deliveryId,
      benefit_type: delivery.benefit_type,
      from_status: delivery.status,
      to_status: parsed.data.status,
      reason: parsed.data.reason,
    },
  })

  // Both counterparties are told, for the same reason adminVoidBenefitProof tells them:
  // this write changes what the team still owes AND what the sponsor believes was
  // delivered, and neither of them made it. The reason is admin moderation copy — the
  // coach sees it verbatim so the override is answerable, the sponsor does not, because
  // it may discuss the team's conduct.
  //
  // Skipped when the RPC reported `already_in_status`: nothing moved, so announcing a
  // change would be a lie. That branch is tolerated above, not a success.
  if (delivery.status !== parsed.data.status && (result as RpcResult)?.error !== 'already_in_status') {
    const label = benefitLabel(delivery.benefit_type)
    const name = await teamName(adminClient, delivery.team_id)
    const statusWord = BENEFIT_STATUS_WORDS[parsed.data.status]

    const ownerId = await teamOwnerId(adminClient, delivery.team_id)
    if (ownerId) {
      await createInAppNotification({
        recipientId: ownerId,
        type: 'general',
        title: 'An administrator changed a benefit status',
        body: `“${label}” is now ${statusWord}. An administrator set this: ${parsed.data.reason}`,
      })
    }
    for (const recipientId of await sponsorRecipients(adminClient, delivery.sponsor_id)) {
      await createInAppNotification({
        recipientId,
        type: 'general',
        title: 'An administrator changed a benefit status',
        body: `“${label}” for ${name} is now ${statusWord}. You can review it under Recognition in your portal.`,
      })
    }
  }

  revalidateRecognition()
  return { success: true }
}

export async function adminVoidBenefitProof(input: {
  deliveryId: string
  reason: string
}): Promise<RecognitionActionResult> {
  const parsed = adminVoidProofSchema.safeParse(input)
  if (!parsed.success) {
    return { error: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', ') }
  }

  let user, adminClient
  try {
    ;({ user, adminClient } = await requireAdmin())
  } catch (e: any) {
    return { error: e.message }
  }

  const delivery = await loadDelivery(adminClient, parsed.data.deliveryId)
  if (!delivery) return { error: 'Benefit not found.' }

  const { data: result, error: rpcError } = await (adminClient as any).rpc('void_benefit_proof', {
    p_delivery_id: parsed.data.deliveryId,
    p_actor_profile_id: user.id,
    p_reason: parsed.data.reason,
  })

  const failure = rpcFailure(result as RpcResult, rpcError)
  if (failure) return { error: failure }

  // Both counterparties are told: the coach needs to re-upload, and the sponsor should
  // not keep seeing the benefit as evidenced. The reason is moderation copy, not the URL.
  const label = benefitLabel(delivery.benefit_type)
  const ownerId = await teamOwnerId(adminClient, delivery.team_id)
  if (ownerId) {
    await createInAppNotification({
      recipientId: ownerId,
      type: 'general',
      title: 'A proof photo was removed',
      body: `The photo for “${label}” was removed by an administrator: ${parsed.data.reason} Please upload a replacement.`,
    })
  }
  for (const recipientId of await sponsorRecipients(adminClient, delivery.sponsor_id)) {
    await createInAppNotification({
      recipientId,
      type: 'general',
      title: 'A benefit proof was withdrawn',
      body: `The photo evidencing “${label}” was removed by an administrator. The team has been asked to supply a replacement.`,
    })
  }

  revalidateRecognition()
  return { success: true }
}

export async function adminUpsertRecognitionTier(input: {
  tierId?: string
  name: string
  rank: number
  minAmountCents: number
  maxAmountCents?: number | null
  benefits: string[]
  description?: string
}): Promise<RecognitionActionResult> {
  const parsed = upsertTierSchema.safeParse(input)
  if (!parsed.success) {
    return { error: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', ') }
  }

  let user, adminClient
  try {
    ;({ user, adminClient } = await requireAdmin())
  } catch (e: any) {
    return { error: e.message }
  }

  const { data: result, error: rpcError } = await (adminClient as any).rpc(
    'admin_upsert_recognition_tier',
    {
      p_actor_profile_id: user.id,
      p_tier_id: parsed.data.tierId ?? null,
      p_name: parsed.data.name,
      p_rank: parsed.data.rank,
      p_min_amount_cents: parsed.data.minAmountCents,
      p_max_amount_cents: parsed.data.maxAmountCents ?? null,
      p_benefits: parsed.data.benefits,
      p_description: parsed.data.description ?? null,
    }
  )

  const failure = rpcFailure(result as RpcResult, rpcError)
  if (failure) return { error: failure }

  // The RPC writes its own recognition_tier_upserted row with the full before/after.
  revalidateRecognition()
  return { success: true }
}

export async function adminArchiveRecognitionTier(input: {
  tierId: string
}): Promise<RecognitionActionResult> {
  const parsed = archiveTierSchema.safeParse(input)
  if (!parsed.success) return { error: 'Validation failed.' }

  let user, adminClient
  try {
    ;({ user, adminClient } = await requireAdmin())
  } catch (e: any) {
    return { error: e.message }
  }

  const { data: result, error: rpcError } = await (adminClient as any).rpc(
    'admin_archive_recognition_tier',
    { p_actor_profile_id: user.id, p_tier_id: parsed.data.tierId }
  )

  const failure = rpcFailure(result as RpcResult, rpcError)
  if (failure) return { error: failure }

  revalidateRecognition()
  return { success: true }
}

/**
 * Sends the coach the "you now owe recognition" message for an award the trigger created.
 *
 * This lives here rather than in the trigger on purpose: a trigger must not perform side
 * effects the settle transaction can roll back. The audit row is the idempotency key, so
 * calling this repeatedly from the reconciliation screen notifies exactly once.
 */
export async function syncRecognitionForFulfillment(
  fulfillmentId: string
): Promise<RecognitionActionResult> {
  let user, adminClient
  try {
    ;({ user, adminClient } = await requireAdmin())
  } catch (e: any) {
    return { error: e.message }
  }

  const { data: award } = await adminClient
    .from('sponsor_recognition_awards')
    .select('id, team_id, tier_name_snapshot, benefits_snapshot')
    .eq('fulfillment_id', fulfillmentId)
    .maybeSingle()

  if (!award) return { error: 'No recognition award exists for that sponsorship.' }

  const { data: already } = await adminClient
    .from('audit_log')
    .select('id')
    .eq('action', 'recognition_award_notified')
    .eq('entity_id', award.id as string)
    .limit(1)

  if (already && already.length > 0) return { success: true }

  const ownerId = await teamOwnerId(adminClient, award.team_id as string | null)
  if (ownerId) {
    const benefits = ((award.benefits_snapshot as string[]) ?? [])
      .filter(isRecognitionBenefitType)
      .map(recognitionBenefitLabel)
    await createInAppNotification({
      recipientId: ownerId,
      type: 'general',
      title: `You have ${award.tier_name_snapshot} recognition to deliver`,
      body: benefits.length
        ? `A sponsorship settled at the ${award.tier_name_snapshot} level. You owe: ${benefits.join(', ')}. Track them under Recognition on your dashboard.`
        : `A sponsorship settled at the ${award.tier_name_snapshot} level. See Recognition on your dashboard.`,
    })
  }

  await adminClient.from('audit_log').insert({
    actor_id: user.id,
    action: 'recognition_award_notified',
    entity_type: 'sponsor_recognition_awards',
    entity_id: award.id as string,
    metadata: { fulfillment_id: fulfillmentId, notified: !!ownerId },
  })

  revalidateRecognition()
  return { success: true }
}
