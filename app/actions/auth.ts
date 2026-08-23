'use server'

import { auth, clerkClient } from '@clerk/nextjs/server'
import { checkBotId } from 'botid/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkSponsorEmailDomain } from '@/lib/sponsor-domain-gate'
import { compareDomains, emailDomain, websiteDomain } from '@/lib/email-domain'
import {
  signupSchema,
  coachProfileDataSchema,
  type CoachProfileDataInput,
} from '@/lib/schemas/auth'
import { sponsorSignupSchema, type SponsorSignupInput } from '@/lib/schemas/sponsor-signup'
import { getClientIp } from '@/lib/actions-utils'
import { mapDbError } from '@/lib/errors'
import { validateUploadedFile } from '@/lib/file-validation'
import * as Sentry from '@sentry/nextjs'
import {
  sendCredentialUploadAlert,
  sendCoachSignupWelcomeEmail,
  sendWelcomeInAppNotification,
  sendSponsorApplicationConfirmation,
  sendSponsorApplicationAlert,
  createInAppNotification,
} from '@/lib/notify'

import { writeAudit } from '@/lib/audit'
// ---------------------------------------------------------------------------
// Vercel BotID (Basic mode)
// ---------------------------------------------------------------------------

const BOT_REJECTION =
  'We could not verify this request. Please refresh the page and try again.'

/**
 * Invisible bot check for the three unauthenticated-ish write surfaces (sponsor
 * application + both coach signup entry points). The matching client-side challenge is
 * armed in `instrumentation-client.ts`; the page paths listed there and the actions that
 * call this must stay in sync.
 *
 * Called ONCE at the top of an action, before the throttle and before any database work —
 * never inside a Promise.all with the throttle, because the throttle must not burn a
 * bucket for a request already identified as a bot.
 *
 * FAILS OPEN, deliberately: a BotID outage must not close the only sponsor-acquisition
 * funnel the product has, nor the coach signup path. The failure is written to
 * console.error as well as Sentry, because Sentry has no DSN in any Vercel environment
 * today and a Sentry-only report would make this silent.
 *
 * `checkBotId()` returns HUMAN in development by default, so `npm run dev` and the local
 * Playwright suite are unaffected. If the E2E suite is ever pointed at a preview URL, add
 * a Vercel WAF bypass rule for the runner rather than building a code-level bypass.
 */
async function isBotRequest(context: string): Promise<boolean> {
  try {
    const verification = await checkBotId()
    return verification.isBot
  } catch (e) {
    console.error(`[${context}] checkBotId threw (failing OPEN)`, e)
    Sentry.captureException(e)
    return false
  }
}

// ---------------------------------------------------------------------------
// Shared credential-file validation (also used by app/actions/credentials.ts)
// ---------------------------------------------------------------------------

const MAX_CREDENTIAL_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_CREDENTIAL_MIMES = ['application/pdf', 'image/jpeg', 'image/png'] as const
/**
 * Validates size, MIME allowlist, and magic bytes; returns the canonical
 * extension derived from the (verified) MIME type — never trusts the client
 * filename. Returns `{ error }` on any failure.
 */
export async function validateCredentialFile(
  file: File
): Promise<{ ext: string; error?: never } | { ext?: never; error: string }> {
  // Delegates to lib/file-validation so this and uploadTeamLogo cannot drift apart —
  // the logo path was doing extension-only checks while this one did it correctly.
  const result = await validateUploadedFile(file, {
    allowedMimes: ALLOWED_CREDENTIAL_MIMES,
    maxBytes: MAX_CREDENTIAL_FILE_SIZE,
    label: 'File',
  })
  if (result.error !== undefined) return { error: result.error }
  return { ext: result.ext }
}

const MAX_TAX_DOC_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_TAX_DOC_MIMES = ['application/pdf'] as const

/**
 * Validates size, MIME allowlist, and magic bytes for W-9s.
 * Returns the canonical extension (pdf).
 */
export async function validateTaxDocumentFile(
  file: File
): Promise<{ ext: string; error?: never } | { ext?: never; error: string }> {
  const result = await validateUploadedFile(file, {
    allowedMimes: ALLOWED_TAX_DOC_MIMES,
    maxBytes: MAX_TAX_DOC_FILE_SIZE,
    label: 'Tax document',
  })
  if (result.error !== undefined) return { error: result.error }
  return { ext: result.ext }
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
  // Bot protection only. The corporate-domain gate is deliberately NOT applied anywhere on
  // the coach path — volunteers legitimately sign up with personal addresses.
  if (await isBotRequest('createCoachProfile')) return { error: BOT_REJECTION }

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
  // Bot protection only — no domain gating on the coach path. See createCoachProfile.
  if (await isBotRequest('completeCoachProfile')) return { error: BOT_REJECTION }

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
  if (await isBotRequest('createSponsorApplication')) return { error: BOT_REJECTION }

  const result = sponsorSignupSchema.safeParse(data)
  if (!result.success) {
    return { error: 'Validation failed: ' + result.error.issues.map((i) => i.message).join(', ') }
  }

  const { userId: clerkUserId } = await auth()
  if (!clerkUserId) return { error: 'Not authenticated' }

  const payload = result.data

  const adminClient = createAdminClient()

  // The email is authoritative from CLERK, never from the client — the same rule
  // completeCoachProfile already follows at :199-206 ("authoritative from Clerk").
  //
  // Without this, `payload.email` (pure client input) is written to profiles.email, and
  // approveSponsorApplication LINKS SPONSOR COMPANIES BY THAT COLUMN. profiles.email has
  // no UNIQUE constraint, so: sign up with any address, call this action with
  // email:"victim@bigcorp.com", and your profile sits there as role='sponsor',
  // sponsor_id=NULL. When the admin approves the REAL application from that company, the
  // link query picks the oldest unlinked sponsor profile with a matching email — the
  // attacker's — handing them the victim's funding cap, pitch inbox and decision powers.
  let verifiedEmail: string | undefined
  try {
    const clerk = await clerkClient()
    const clerkUser = await clerk.users.getUser(clerkUserId)
    verifiedEmail =
      clerkUser.primaryEmailAddress?.emailAddress ?? clerkUser.emailAddresses[0]?.emailAddress
  } catch (e) {
    console.error('createSponsorApplication: failed to resolve Clerk user', e)
  }
  if (!verifiedEmail) {
    return { error: 'Could not resolve your account email. Please sign out and back in.' }
  }
  const sessionEmail = verifiedEmail.trim().toLowerCase()

  if (payload.email && payload.email !== sessionEmail) {
    return {
      error:
        `This application must use the email address on your account (${sessionEmail}). ` +
        `Sign out and apply from the correct account if you need a different one.`,
    }
  }

  // P0-13: this action upserts role:'sponsor' onto whatever profile the current
  // Clerk session owns. Without a guard, a signed-in COACH or ADMIN who lands on
  // /sponsors/apply and completes the wizard has their role silently rewritten to
  // 'sponsor' with sponsor_id NULL — the (sponsor) layout then blocks everything and
  // there is no admin UI anywhere to change a role back. If the only admin does this,
  // /admin is lost. The upsert also clobbers email, full_name, phone_number,
  // address_line1, coppa_acknowledged and tos_accepted.
  //
  // Mirrors the guard completeCoachProfile already has at :233-240, but scoped: an
  // EXISTING SPONSOR must still be allowed through, because the stranded-sponsor
  // recovery form (CompleteSponsorApplicationForm, added in 3ab1895) re-calls this
  // action for a profile that already exists. Only a cross-role overwrite is refused.
  const { data: existingProfile } = await adminClient
    .from('profiles')
    .select('id, role')
    .eq('clerk_user_id', clerkUserId)
    .maybeSingle()

  if (existingProfile && existingProfile.role !== 'sponsor') {
    return {
      error:
        `You are already signed in as a ${existingProfile.role}. Sponsor applications must use a ` +
        `separate account — sign out first, then apply.`,
    }
  }

  // Corporate email domain gating — SPONSOR ONLY (the coach path never calls this).
  //
  // Checks the CLERK SESSION email, never payload.email: the two are already refused when
  // they differ, and the session address is the one that lands in profiles.email and that
  // approveSponsorApplication links companies by.
  //
  // Runs before the throttle so a refused applicant does not also burn a throttle bucket,
  // and it FAILS OPEN internally (see lib/sponsor-domain-gate.ts).
  const gate = await checkSponsorEmailDomain(sessionEmail)
  const applicantEmailDomain = emailDomain(sessionEmail)

  if (!gate.allowed) {
    // Log the DOMAIN and the category, never the full address: audit_log is admin-readable
    // but it is also what /api/admin/export dumps to CSV.
    await writeAudit(adminClient, {
      actor_id: existingProfile?.id ?? null,
      action: 'sponsor_application_blocked',
      entity_type: 'sponsor_applications',
      entity_id: null,
      metadata: { email_domain: applicantEmailDomain, rule_category: gate.reason },
    })
    return { error: gate.message }
  }

  // Advisory domain-match verdict for the admin reviewer. NEVER a rejection.
  //
  // An allowlisted applicant is, in practice, someone on a free-mail domain an admin
  // waved through, so their email host says nothing about the company they represent —
  // 'unknown' is honest, where compareDomains would report a guaranteed 'mismatch'.
  const applicantWebsiteDomain = websiteDomain(payload.website)
  const domainMatch =
    gate.reason === 'allowlisted'
      ? 'unknown'
      : compareDomains(applicantEmailDomain, applicantWebsiteDomain, payload.companyName)

  // Abuse throttle. This flow runs post-Clerk-signup (semi-authenticated), but
  // account creation is cheap, so cap applications per IP and per email. The
  // throttle FAILS OPEN: if the RPC itself errors we log and let the application
  // through rather than blocking legitimate sponsors.
  //
  // The failure is written to console.error as well as Sentry. Sentry has no DSN in
  // any Vercel environment today, so a Sentry-only report is a no-op and the throttle
  // would fail open completely silently.
  try {
    const ip = await getClientIp()
    const [ipRes, emailRes] = await Promise.all([
      adminClient.rpc('check_throttle', {
        p_key: `sponsor-apply:${ip}`,
        p_limit: 3,
        p_window: '1 hour',
      }),
      adminClient.rpc('check_throttle', {
        p_key: `sponsor-apply-email:${sessionEmail}`,
        p_limit: 2,
        p_window: '1 day',
      }),
    ])
    if (ipRes.error || emailRes.error) {
      const err = new Error(
        `[createSponsorApplication] check_throttle RPC failed (failing OPEN): ${ipRes.error?.message ?? ''} ${emailRes.error?.message ?? ''}`
      )
      console.error(err.message, { ip: ipRes.error, email: emailRes.error })
      Sentry.captureException(err)
    } else if (ipRes.data === false || emailRes.data === false) {
      return { error: 'Too many applications — please try again later.' }
    }
  } catch (e) {
    console.error('[createSponsorApplication] throttle threw (failing OPEN)', e)
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
        email: sessionEmail,
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
  // double-submit) with an existing pending application for this email is a no-op,
  // so admins only ever see one row per applicant.
  //
  // P0-15: this lookup used to filter `.eq('status', 'pending')` against
  // sponsor_applications.contact_email, which is UNIQUE (0035:18). For a REJECTED
  // prior applicant the filter matched nothing, so the code took the insert branch,
  // the insert failed 23505, the error was only console.error'd, and the action
  // returned success. The applicant was left with role='sponsor', sponsor_id=NULL,
  // parked on /awaiting-verification forever, and no application ever reached the
  // admin queue. The status filter is gone: the UNIQUE column is looked up by email
  // alone, which is the only lookup that can actually predict the insert.
  const { data: existingApp, error: existingAppError } = await adminClient
    .from('sponsor_applications')
    .select('id, status')
    .eq('contact_email', sessionEmail)
    .maybeSingle()

  if (existingAppError) {
    console.error('Failed to look up existing sponsor application:', existingAppError)
    return { error: mapDbError(existingAppError, 'createSponsorApplication.lookup') }
  }

  let isNewApplication = false

  if (!existingApp) {
    const { error: appError } = await adminClient.from('sponsor_applications').insert({
      company_name: payload.companyName,
      contact_name: payload.fullName,
      contact_email: sessionEmail,
      proposed_cap_cents: payload.proposedCapCents,
      message: payload.sponsorshipReason,
      // The wizard has always collected `website` and this insert always dropped it, so
      // no reviewer could compare a domain the row was never given.
      website: payload.website,
      email_domain: applicantEmailDomain,
      website_domain: applicantWebsiteDomain,
      domain_match: domainMatch,
    })

    // Previously console.error only, then fell through to `return` with no error —
    // the wizard read that as success and the lead was lost with zero signal.
    if (appError) {
      console.error('Failed to create sponsor application entry:', appError)
      return { error: mapDbError(appError, 'createSponsorApplication.insert') }
    }
    isNewApplication = true
  } else if (existingApp.status === 'rejected') {
    // Product decision (2026-08-06): a previously-rejected applicant may re-apply.
    // Reopen the existing row as pending with the new answers so it re-enters the
    // admin queue, rather than 23505-failing on the UNIQUE email.
    const { error: reopenError } = await adminClient
      .from('sponsor_applications')
      .update({
        company_name: payload.companyName,
        contact_name: payload.fullName,
        proposed_cap_cents: payload.proposedCapCents,
        message: payload.sponsorshipReason,
        // A re-application must refresh the verdict, not keep a stale one.
        website: payload.website,
        email_domain: applicantEmailDomain,
        website_domain: applicantWebsiteDomain,
        domain_match: domainMatch,
        status: 'pending',
        reviewed_by: null,
        reviewed_at: null,
      })
      .eq('id', existingApp.id)

    if (reopenError) {
      console.error('Failed to reopen rejected sponsor application:', reopenError)
      return { error: mapDbError(reopenError, 'createSponsorApplication.reopen') }
    }
    isNewApplication = true
  } else if (existingApp.status === 'approved') {
    // Already a sponsor. Don't create a second company row (see the
    // approveSponsorApplication idempotency fix in admin.ts) and don't re-notify.
    return
  }
  // status === 'pending': genuine retry / double-submit. Stay quiet, as before.

  // Send notifications (only for a genuinely new application — retries stay quiet)
  if (!isNewApplication) return
  try {
    // Confirmation to sponsor
    await sendSponsorApplicationConfirmation(
      payload.companyName,
      sessionEmail,
      payload.fullName,
      payload.proposedCapCents
    )

    // Alert to admins (Email)
    await sendSponsorApplicationAlert(
      payload.companyName,
      payload.fullName,
      sessionEmail,
      payload.proposedCapCents
    )

    // Alert to admins (In-App). A domain mismatch is appended to the SAME notification —
    // it is a heads-up for a human reviewer, not a new notification type (and
    // notifications.type is a CHECK-constrained column where 'general' already covers it).
    const mismatchNote =
      domainMatch === 'mismatch'
        ? ` Heads up: the applicant's email domain (${applicantEmailDomain}) does not match ` +
          `the company website they gave (${applicantWebsiteDomain}).`
        : ''

    const { data: admins } = await adminClient.from('profiles').select('id').eq('role', 'admin')
    if (admins) {
      await Promise.all(
        admins.map((admin) =>
          createInAppNotification({
            skipEmail: true,
            recipientId: admin.id,
            type: 'general',
            title: 'New Sponsor Application',
            body:
              `${payload.companyName} (${payload.fullName}) has applied to become a sponsor.` +
              mismatchNote,
          })
        )
      )
    }
  } catch (e) {
    console.error('Failed to send sponsor notifications:', e)
  }
}
