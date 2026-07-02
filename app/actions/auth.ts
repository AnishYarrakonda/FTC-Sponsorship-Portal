'use server'

import { auth, clerkClient } from '@clerk/nextjs/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  signupSchema,
  coachProfileDataSchema,
  type CoachProfileDataInput,
} from '@/lib/schemas/auth'
import { sponsorSignupSchema, type SponsorSignupInput } from '@/lib/schemas/sponsor-signup'
import { getClientIp } from '@/lib/actions-utils'
import { mapDbError } from '@/lib/errors'
import * as Sentry from '@sentry/nextjs'
import {
  sendCredentialUploadAlert,
  sendCoachSignupWelcomeEmail,
  sendWelcomeInAppNotification,
  sendSponsorApplicationConfirmation,
  sendSponsorApplicationAlert,
  createInAppNotification,
} from '@/lib/notify'

// ---------------------------------------------------------------------------
// Shared credential-file validation (also used by app/actions/credentials.ts)
// ---------------------------------------------------------------------------

const MAX_CREDENTIAL_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_CREDENTIAL_MIMES = ['application/pdf', 'image/jpeg', 'image/png'] as const
const EXT_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
}

/**
 * Validates size, MIME allowlist, and magic bytes; returns the canonical
 * extension derived from the (verified) MIME type — never trusts the client
 * filename. Returns `{ error }` on any failure.
 */
export async function validateCredentialFile(
  file: File
): Promise<{ ext: string; error?: never } | { ext?: never; error: string }> {
  if (file.size > MAX_CREDENTIAL_FILE_SIZE) {
    return { error: 'File too large. Maximum size is 5MB.' }
  }
  if (!ALLOWED_CREDENTIAL_MIMES.includes(file.type as (typeof ALLOWED_CREDENTIAL_MIMES)[number])) {
    return { error: 'Invalid file type. Only PDF, JPG, and PNG are allowed.' }
  }

  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer).subarray(0, 4)
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  let isValid = false
  if (file.type === 'application/pdf' && hex.startsWith('25504446')) isValid = true
  if (file.type === 'image/jpeg' && hex.startsWith('ffd8ff')) isValid = true
  if (file.type === 'image/png' && hex === '89504e47') isValid = true

  if (!isValid) {
    return { error: 'The file contents do not match its type. Please upload a valid PDF, JPG, or PNG.' }
  }

  const ext = EXT_BY_MIME[file.type]
  if (!ext) return { error: 'Invalid file type.' }
  return { ext }
}

// ---------------------------------------------------------------------------
// Coach profile provisioning (shared by signup wizard + /complete-profile)
// ---------------------------------------------------------------------------

async function provisionCoachProfile(
  clerkUserId: string,
  payload: CoachProfileDataInput,
  file: File
): Promise<{ error?: string } | void> {
  const validation = await validateCredentialFile(file)
  if (validation.error) return { error: `Photo ID: ${validation.error}` }

  const adminClient = createAdminClient()

  // RLS partitions coach-credentials storage by Clerk id. Timestamped name so
  // retries / re-uploads never collide or get stuck behind a stale extension.
  const filePath = `${clerkUserId}/credentials_${Date.now()}.${validation.ext}`

  const { error: uploadError } = await adminClient.storage
    .from('coach-credentials')
    .upload(filePath, file, { upsert: true })

  if (uploadError) {
    console.error('Failed to upload credentials:', uploadError)
    // Continue despite error; admin can request a re-upload later.
  }

  // Provision the coach profile keyed by the Clerk id. Upsert on clerk_user_id
  // makes this idempotent: a retry after a partial failure (e.g. flaky network
  // after the Clerk session activated) simply overwrites the same row.
  const { data: profileRow, error: upsertError } = await adminClient
    .from('profiles')
    .upsert(
      {
        clerk_user_id: clerkUserId,
        role: 'coach',
        email: payload.email,
        full_name: payload.fullName,
        date_of_birth: payload.dateOfBirth,
        phone_number: payload.phoneNumber,
        address_line1: payload.addressLine1,
        city: payload.city,
        state: payload.state,
        zip_code: payload.zipCode,
        referral_source: payload.referralSource || null,
        coppa_acknowledged: payload.coppaAcknowledged,
        tos_accepted: payload.tosAccepted,
        age_confirmed_at: new Date().toISOString(),
        coach_credentials_url: uploadError ? null : filePath,
        pending_team_data: payload.teamData,
      } as never,
      { onConflict: 'clerk_user_id' }
    )
    .select('id')
    .single()

  if (upsertError || !profileRow) {
    console.error('Failed to upsert coach profile:', upsertError)
    return { error: mapDbError(upsertError, 'createCoachProfile.upsert') }
  }

  // Mirror the role into Clerk publicMetadata for client UX gating (not security).
  try {
    const clerk = await clerkClient()
    await clerk.users.updateUserMetadata(clerkUserId, {
      publicMetadata: { role: 'coach' },
    })
  } catch (e) {
    console.error('Failed to mirror coach role into Clerk metadata:', e)
  }

  // Notify admins
  await sendCredentialUploadAlert(clerkUserId, payload.fullName, payload.email)

  // Welcome user (in-app notifications key off the profile uuid, not the Clerk id)
  await Promise.all([
    sendCoachSignupWelcomeEmail(payload.email, payload.fullName),
    sendWelcomeInAppNotification(profileRow.id, payload.fullName),
  ])
}

/**
 * Finalize a coach signup AFTER the Clerk session is active. The client wizard
 * creates + verifies the Clerk user first; this action then provisions the
 * `profiles` row, stores the credential file, mirrors the role into Clerk, and
 * fires the welcome / admin-alert notifications. It does NOT redirect — the
 * client owns navigation. Safe to retry: the profile upsert is idempotent on
 * clerk_user_id.
 */
export async function createCoachProfile(
  formData: FormData
): Promise<{ error?: string } | void> {
  const { userId: clerkUserId } = await auth()
  if (!clerkUserId) return { error: 'Not authenticated' }

  // Parse JSON data
  const dataString = formData.get('data') as string
  if (!dataString) return { error: 'No data provided' }

  let rawData
  try {
    rawData = JSON.parse(dataString)
  } catch {
    return { error: 'Invalid JSON data' }
  }

  // Parse file
  const file = formData.get('photoIdFile') as File | null
  if (!file) return { error: 'Photo ID upload is required' }

  // Validate data
  const result = signupSchema.safeParse(rawData)
  if (!result.success) {
    return { error: 'Validation failed: ' + result.error.issues.map((i) => i.message).join(', ') }
  }

  return provisionCoachProfile(clerkUserId, result.data, file)
}

/**
 * Orphan recovery: an authenticated Clerk user exists but the `profiles` row
 * was never created (signup crashed after the session activated, or the
 * profile action failed and the user closed the tab). Re-collects the same
 * data minus account credentials — the email is taken from the verified Clerk
 * account, never from the client.
 */
export async function completeCoachProfile(
  formData: FormData
): Promise<{ error?: string } | void> {
  const { userId: clerkUserId } = await auth()
  if (!clerkUserId) return { error: 'Not authenticated' }

  const dataString = formData.get('data') as string
  if (!dataString) return { error: 'No data provided' }

  let rawData: Record<string, unknown>
  try {
    rawData = JSON.parse(dataString)
  } catch {
    return { error: 'Invalid JSON data' }
  }

  const file = formData.get('photoIdFile') as File | null
  if (!file) return { error: 'Photo ID upload is required' }

  // The email is authoritative from Clerk (the account is already verified).
  let email: string | undefined
  try {
    const clerk = await clerkClient()
    const clerkUser = await clerk.users.getUser(clerkUserId)
    email =
      clerkUser.primaryEmailAddress?.emailAddress ??
      clerkUser.emailAddresses[0]?.emailAddress
  } catch (e) {
    console.error('completeCoachProfile: failed to resolve Clerk user', e)
  }
  if (!email) return { error: 'Could not resolve your account email. Please sign out and back in.' }

  const result = coachProfileDataSchema.safeParse({ ...rawData, email })
  if (!result.success) {
    return { error: 'Validation failed: ' + result.error.issues.map((i) => i.message).join(', ') }
  }

  // Guard: if a profile row already exists, don't clobber it from this flow.
  const adminClient = createAdminClient()
  const { data: existing } = await adminClient
    .from('profiles')
    .select('id')
    .eq('clerk_user_id', clerkUserId)
    .maybeSingle()
  if (existing) return { error: 'Your profile already exists. Head to your dashboard.' }

  return provisionCoachProfile(clerkUserId, result.data, file)
}

/**
 * Finalize a sponsor application AFTER the Clerk session is active. Mirrors
 * `createCoachProfile`: provisions the `profiles` row (role='sponsor',
 * `sponsor_id` stays null until an admin links the company), mirrors the role
 * into Clerk, records the `sponsor_applications` row, and notifies. No redirect.
 * Safe to retry: the profile upsert is idempotent and the application insert
 * is skipped when a pending application for the same email already exists.
 */
export async function createSponsorApplication(
  data: SponsorSignupInput
): Promise<{ error?: string } | void> {
  const result = sponsorSignupSchema.safeParse(data)
  if (!result.success) {
    return { error: 'Validation failed: ' + result.error.issues.map((i) => i.message).join(', ') }
  }

  const { userId: clerkUserId } = await auth()
  if (!clerkUserId) return { error: 'Not authenticated' }

  const payload = result.data

  const adminClient = createAdminClient()

  // Abuse throttle. This flow runs post-Clerk-signup (semi-authenticated), but
  // account creation is cheap, so cap applications per IP and per email. The
  // throttle FAILS OPEN: if the RPC itself errors we report to Sentry and let
  // the application through rather than blocking legitimate sponsors.
  try {
    const ip = await getClientIp()
    const [ipRes, emailRes] = await Promise.all([
      adminClient.rpc('check_throttle', {
        p_key: `sponsor-apply:${ip}`,
        p_limit: 3,
        p_window: '1 hour',
      }),
      adminClient.rpc('check_throttle', {
        p_key: `sponsor-apply-email:${payload.email}`,
        p_limit: 2,
        p_window: '1 day',
      }),
    ])
    if (ipRes.error || emailRes.error) {
      Sentry.captureException(
        new Error(
          `[createSponsorApplication] check_throttle RPC failed: ${ipRes.error?.message ?? ''} ${emailRes.error?.message ?? ''}`
        )
      )
    } else if (ipRes.data === false || emailRes.data === false) {
      return { error: 'Too many applications — please try again later.' }
    }
  } catch (e) {
    Sentry.captureException(e)
  }

  // Provision the sponsor profile keyed by the Clerk id. sponsor_id stays null
  // until an admin approves and links the company row.
  const { error: upsertError } = await adminClient
    .from('profiles')
    .upsert(
      {
        clerk_user_id: clerkUserId,
        role: 'sponsor',
        email: payload.email,
        full_name: payload.fullName,
        phone_number: payload.phoneNumber,
        address_line1: payload.companyAddress,
        coppa_acknowledged: payload.coppaAcknowledged,
        tos_accepted: payload.tosAccepted,
        age_confirmed_at: new Date().toISOString(),
      } as never,
      { onConflict: 'clerk_user_id' }
    )

  if (upsertError) {
    console.error('Failed to upsert sponsor profile:', upsertError)
    return { error: mapDbError(upsertError, 'createSponsorApplication.upsert') }
  }

  // Mirror the role into Clerk publicMetadata for client UX gating (not security).
  try {
    const clerk = await clerkClient()
    await clerk.users.updateUserMetadata(clerkUserId, {
      publicMetadata: { role: 'sponsor' },
    })
  } catch (e) {
    console.error('Failed to mirror sponsor role into Clerk metadata:', e)
  }

  // Create a Sponsor Application entry — but never a duplicate: a retry (or a
  // double-submit) with an existing pending application for this email is a
  // no-op, so admins only ever see one row per applicant.
  const { data: existingApp } = await adminClient
    .from('sponsor_applications')
    .select('id')
    .eq('contact_email', payload.email)
    .eq('status', 'pending')
    .maybeSingle()

  let isNewApplication = false
  if (!existingApp) {
    const { error: appError } = await adminClient.from('sponsor_applications').insert({
      company_name: payload.companyName,
      contact_name: payload.fullName,
      contact_email: payload.email,
      proposed_cap_cents: payload.proposedCapCents,
      message: payload.sponsorshipReason,
    })

    if (appError) {
      console.error('Failed to create sponsor application entry:', appError)
    } else {
      isNewApplication = true
    }
  }

  // Send notifications (only for a genuinely new application — retries stay quiet)
  if (!isNewApplication) return
  try {
    // Confirmation to sponsor
    await sendSponsorApplicationConfirmation(
      payload.companyName,
      payload.email,
      payload.fullName,
      payload.proposedCapCents
    )

    // Alert to admins (Email)
    await sendSponsorApplicationAlert(
      payload.companyName,
      payload.fullName,
      payload.email,
      payload.proposedCapCents
    )

    // Alert to admins (In-App)
    const { data: admins } = await adminClient.from('profiles').select('id').eq('role', 'admin')
    if (admins) {
      await Promise.all(
        admins.map((admin) =>
          createInAppNotification({
            skipEmail: true,
            recipientId: admin.id,
            type: 'general',
            title: 'New Sponsor Application',
            body: `${payload.companyName} (${payload.fullName}) has applied to become a sponsor.`,
          })
        )
      )
    }
  } catch (e) {
    console.error('Failed to send sponsor notifications:', e)
  }
}
