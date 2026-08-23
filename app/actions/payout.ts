'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { env } from '@/lib/env'
export type ActionResponse<T = void> = { ok?: boolean, error?: string, data?: T, message?: string }

const actionError = (error: string): ActionResponse<any> => ({ error })
const actionSuccess = <T>(data?: T, message?: string): ActionResponse<T> => ({ ok: true, data, message })
import { payoutProfileSchema, PayoutProfileInput } from '@/lib/schemas/payout'
import { requireAdmin, requireVerifiedCoach } from '@/lib/actions-utils'
import { enqueueStorageDeletion } from '@/lib/credentials-retention'

async function requireCoachOwner(teamId: string) {
  const { user, supabase } = await requireVerifiedCoach()
  const { data: team } = await supabase
    .from('teams')
    .select('*')
    .eq('id', teamId)
    .eq('owner_id', user.id)
    .single()
  if (!team) throw new Error('Forbidden')
  return { profile: user, team, supabase }
}
import { validateTaxDocumentFile } from '@/app/actions/auth'
import { sendW9UploadAlert, createInAppNotification } from '@/lib/notify'
import * as Sentry from '@sentry/nextjs'
import { auth } from '@clerk/nextjs/server'
import { clerkClient } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'
import { writeAudit } from '@/lib/audit'

// --- COACH ACTIONS ---

export async function savePayoutProfile(
  teamId: string,
  payload: PayoutProfileInput
): Promise<ActionResponse<void>> {
  // 1. Validate
  const parsed = payoutProfileSchema.safeParse(payload)
  if (!parsed.success) {
    return actionError('Invalid payout profile data.')
  }
  const data = parsed.data

  // 2. Auth
  const { profile } = await requireCoachOwner(teamId)
  if (!profile) return actionError('Unauthorized')

  const supabase = await createClient()
  
  // Fetch existing to see if critical fields changed
  const { data: existing } = await (supabase as any)
    .from('team_payout_profiles')
    .select('legal_payee_name, tax_classification, ein_last4, fiscal_sponsor_ein_last4')
    .eq('team_id', teamId)
    .single()

  const einLast4 = data.ein ? data.ein.slice(-4) : undefined
  const fiscalEinLast4 = data.fiscalSponsorEin ? data.fiscalSponsorEin.slice(-4) : undefined

  let requiresReverification = false
  if (existing) {
    if (existing.legal_payee_name !== data.legalPayeeName ||
        existing.tax_classification !== data.taxClassification ||
        (einLast4 !== undefined && existing.ein_last4 !== einLast4) ||
        (fiscalEinLast4 !== undefined && existing.fiscal_sponsor_ein_last4 !== fiscalEinLast4)
    ) {
      requiresReverification = true
    }
  }

  // Upsert the plaintext fields
  const { error: upsertError } = await (supabase as any)
    .from('team_payout_profiles')
    .upsert({
      team_id: teamId,
      legal_payee_name: data.legalPayeeName,
      tax_classification: data.taxClassification,
      is_fiscally_sponsored: data.isFiscallySponsored,
      fiscal_sponsor_name: data.isFiscallySponsored ? data.fiscalSponsorName : null,
      mailing_address_line1: data.mailingAddressLine1 || null,
      mailing_address_line2: data.mailingAddressLine2 || null,
      mailing_city: data.mailingCity || null,
      mailing_state: data.mailingState || null,
      mailing_postal_code: data.mailingPostalCode || null,
      remittance_email: data.remittanceEmail || null,
    }, { onConflict: 'team_id' })
    
  if (upsertError) {
    console.error('[payout] save error', upsertError)
    Sentry.captureException(upsertError)
    return actionError('Failed to save payout profile.')
  }

  const admin = await createAdminClient()

  if (requiresReverification) {
    await (admin as any)
      .from('team_payout_profiles')
      .update({
        w9_verified_by: null,
        w9_verified_at: null,
      })
      .eq('team_id', teamId)
  }

  if (data.ein) {
    const { error: einError } = await admin.rpc('set_payout_ein' as any, {
      p_team_id: teamId,
      p_actor_profile_id: profile.id,
      p_ein: data.ein,
      p_key: env.PAYOUT_ENCRYPTION_KEY,
      p_target: 'payee'
    })
    if (einError) {
      console.error('[payout] set EIN error', einError)
      Sentry.captureException(einError)
      return actionError('Failed to save EIN securely.')
    }
  }

  if (data.isFiscallySponsored && data.fiscalSponsorEin) {
    const { error: fiscalEinError } = await admin.rpc('set_payout_ein' as any, {
      p_team_id: teamId,
      p_actor_profile_id: profile.id,
      p_ein: data.fiscalSponsorEin,
      p_key: env.PAYOUT_ENCRYPTION_KEY,
      p_target: 'fiscal_sponsor'
    })
    if (fiscalEinError) {
      console.error('[payout] set fiscal EIN error', fiscalEinError)
      Sentry.captureException(fiscalEinError)
      return actionError('Failed to save fiscal sponsor EIN securely.')
    }
  }

  // 5. Audit
  const { error: auditError } = await (admin as any).from('audit_log').insert({
    actor_id: profile.id,
    action: 'save_team_payout_profile',
    entity_type: 'teams',
    entity_id: teamId,
    metadata: {
      team_id: teamId,
      tax_classification: data.taxClassification,
      has_ein: !!data.ein,
      has_address: !!(data.mailingAddressLine1 || data.mailingCity)
    }
  })
  if (auditError) {
    console.error('[payout] audit log failed', auditError)
    Sentry.captureException(auditError)
  }

  return actionSuccess(undefined, 'Payout profile saved.')
}

export async function uploadW9(
  teamId: string,
  formData: FormData
): Promise<ActionResponse<void>> {
  // 1. Validate
  const file = formData.get('file') as File | null
  if (!file) return actionError('No file provided.')
  
  const validateResult = await validateTaxDocumentFile(file)
  if (validateResult.error) return actionError(validateResult.error)

  // 2. Auth
  const { profile, team } = await requireCoachOwner(teamId)
  if (!profile || !team) return actionError('Unauthorized')
  
  const clerkAuth = await auth()
  const clerkUserId = clerkAuth.userId
  if (!clerkUserId) return actionError('Unauthorized')

  const clerkUser = await (await clerkClient()).users.getUser(clerkUserId)

  const supabase = await createClient()

  // Verify profile exists
  const { data: currentProfile, error: profileErr } = await (supabase as any)
    .from('team_payout_profiles')
    .select('w9_document_path')
    .eq('team_id', teamId)
    .single()
    
  if (profileErr || !currentProfile) {
    return actionError('Please fill out the payout profile details before uploading a W-9.')
  }

  // 3. Mutate (Storage)
  const path = `${clerkUserId}/w9_${Date.now()}.${validateResult.ext}`
  const { error: uploadErr } = await (supabase as any).storage
    .from('tax-documents')
    .upload(path, file)
    
  if (uploadErr) {
    console.error('[payout] W-9 upload failed', uploadErr)
    Sentry.captureException(uploadErr)
    return actionError('Failed to upload W-9.')
  }

  const admin = await createAdminClient()
  const threeYearsFromNow = new Date()
  threeYearsFromNow.setFullYear(threeYearsFromNow.getFullYear() + 3)
  
  const { error: dbErr } = await (admin as any)
    .from('team_payout_profiles')
    .update({
      w9_document_path: path,
      w9_uploaded_at: new Date().toISOString(),
      w9_expires_at: threeYearsFromNow.toISOString(),
      w9_verified_by: null,
      w9_verified_at: null,
      w9_rejected_reason: null,
      w9_rejected_at: null,
      w9_renewal_notified_at: null,
      w9_purged_at: null
    })
    .eq('team_id', teamId)

  if (dbErr) {
    console.error('[payout] W-9 pointer update failed', dbErr)
    Sentry.captureException(dbErr)
    // Cleanup storage on error
    await (supabase as any).storage.from('tax-documents').remove([path])
    return actionError('Failed to save W-9 record.')
  }

  // A-06-02. Was a fire-and-forget remove() with a .catch(console.error) — not even
  // awaited, so a failure was invisible even in the logs of a serverless invocation that
  // had already returned. The W-9 pointer has already moved by this point, so a lost
  // delete orphans a tax document permanently. Queued and retried instead.
  if (currentProfile.w9_document_path && currentProfile.w9_document_path !== path) {
    await enqueueStorageDeletion(admin, 'tax-documents', currentProfile.w9_document_path, 'superseded_w9')
  }

  // 4. Audit
  const { error: auditError } = await (admin as any).from('audit_log').insert({
    actor_id: profile.id,
    action: 'upload_w9',
    entity_type: 'teams',
    entity_id: teamId,
    metadata: { team_id: teamId, file_path: path, replaced: !!currentProfile.w9_document_path }
  })
  if (auditError) {
    console.error('[payout] audit log failed', auditError)
    Sentry.captureException(auditError)
  }

  // 5. Notify
  await sendW9UploadAlert(
    team.team_name,
    `${clerkUser.firstName ?? ''} ${clerkUser.lastName ?? ''}`.trim() || 'Coach',
    clerkUser.emailAddresses[0]?.emailAddress ?? 'unknown'
  )

  return actionSuccess(undefined, 'W-9 uploaded successfully.')
}

// --- ADMIN ACTIONS ---

export async function adminVerifyW9(teamId: string): Promise<ActionResponse<void>> {
  // 1. Auth
  const { user: profile } = await requireAdmin()
  if (!profile) return actionError('Unauthorized')

  const admin = await createAdminClient()

  // 2. Fetch team details for notification
  const { data: teamProfile } = await (admin as any)
    .from('teams')
    .select('owner_id, team_name')
    .eq('id', teamId)
    .single()

  const threeYearsFromNow = new Date()
  threeYearsFromNow.setFullYear(threeYearsFromNow.getFullYear() + 3)
  
  const { error } = await (admin as any)
    .from('team_payout_profiles')
    .update({
      w9_verified_by: profile.id,
      w9_verified_at: new Date().toISOString(),
      w9_expires_at: threeYearsFromNow.toISOString(),
      w9_rejected_reason: null,
      w9_rejected_at: null,
    })
    .eq('team_id', teamId)

  if (error) {
    console.error('[payout] W-9 verification failed', error)
    Sentry.captureException(error)
    return actionError('Failed to verify W-9.')
  }

  // 3. Audit
  await writeAudit((admin as any), {
    actor_id: profile.id,
    action: 'verify_team_payout_profile',
    entity_type: 'teams',
    entity_id: teamId,
  })

  // 4. Notify team owner in-app
  if (teamProfile?.owner_id) {
    await createInAppNotification({
      recipientId: teamProfile.owner_id,
      type: 'general',
      title: 'Payout details verified',
      body: 'Your payout details are verified — sponsors can now see that your W-9 is on file.',
    }).catch(e => console.error('[payout] notify verification failed', e))
  }

  revalidatePath('/admin/payouts')
  revalidatePath('/dashboard')

  return actionSuccess(undefined, 'W-9 verified successfully.')
}

export async function adminRejectW9(
  teamId: string, 
  reason: string
): Promise<ActionResponse<void>> {
  const trimmedReason = reason?.trim() ?? ''
  if (trimmedReason.length < 10) {
    return actionError('Rejection reason must be at least 10 characters.')
  }

  // 1. Auth
  const { user: profile } = await requireAdmin()
  if (!profile) return actionError('Unauthorized')

  const admin = await createAdminClient()

  const { data: teamProfile } = await (admin as any)
    .from('teams')
    .select('owner_id, team_name')
    .eq('id', teamId)
    .single()

  // 2. Mutate (Database ONLY — rejection MUST NOT delete the document from storage)
  const { error } = await (admin as any)
    .from('team_payout_profiles')
    .update({
      w9_rejected_reason: trimmedReason,
      w9_rejected_at: new Date().toISOString(),
      w9_verified_by: null,
      w9_verified_at: null,
    })
    .eq('team_id', teamId)

  if (error) {
    console.error('[payout] W-9 rejection failed', error)
    Sentry.captureException(error)
    return actionError('Failed to reject W-9.')
  }

  // 3. Audit
  await writeAudit((admin as any), {
    actor_id: profile.id,
    action: 'reject_team_payout_profile',
    entity_type: 'teams',
    entity_id: teamId,
    metadata: { reason: trimmedReason }
  })

  // 4. Notify coach in-app
  if (teamProfile?.owner_id) {
    await createInAppNotification({
      recipientId: teamProfile.owner_id,
      type: 'general',
      title: 'W-9 document needs attention',
      body: `Your W-9 was not approved for the following reason: ${trimmedReason}`,
    }).catch(e => console.error('[payout] notify rejection failed', e))
  }

  revalidatePath('/admin/payouts')
  revalidatePath('/dashboard')

  return actionSuccess(undefined, 'W-9 rejected.')
}
