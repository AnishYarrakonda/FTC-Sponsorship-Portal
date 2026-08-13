'use server'

import { revalidatePath } from 'next/cache'
import * as Sentry from '@sentry/nextjs'
import { clerkClient } from '@clerk/nextjs/server'
import { createInAppNotification, sendCoachVerificationEmail, sendCoachDenialEmail } from '@/lib/notify'
import { requireAdmin, requireSuperAdmin } from '@/lib/actions-utils'
import { purgeCoachCredentials } from '@/lib/credentials-retention'
import { mapDbError } from '@/lib/errors'
import { deriveTeamSlug, uniquifyTeamSlug } from '@/lib/team-slug'
import { verifyFTCTeamIdentity } from '@/lib/ftc-roster'
import { teamVerificationOverrideSchema } from '@/lib/schemas/team'
import {
  ADMIN_LEVEL_LABELS,
  demoteAdminSchema,
  provisionAdminSchema,
  setAdminLevelSchema,
  type DemoteAdminInput,
  type ProvisionAdminInput,
  type SetAdminLevelInput,
} from '@/lib/schemas/admin'
import type { Database } from '@/lib/supabase/types'
import type { createAdminClient } from '@/lib/supabase/admin'
import { z } from 'zod'

type TeamStatus = Database['public']['Enums']['team_status']
type TaxStatus = Database['public']['Enums']['tax_status_type']

const verifyCoachSchema = z.object({
  coachId: z.string().uuid(),
  verified: z.boolean(),
})

const applicationActionSchema = z.object({
  applicationId: z.string().uuid(),
})

const sponsorIdSchema = z.object({
  sponsorId: z.string().uuid(),
})

// Shared by approveSponsorApplication and retryCreateSponsorOrganization (the admin
// recovery path for a sponsor whose org creation failed at approval time). Creates the
// Clerk Organization, stamps sponsors.clerk_org_id, and seeds the applicant's own
// sponsor_members row as org_admin. A Clerk failure is reported to the caller as a
// warning, never a hard error — the sponsor still works via the legacy
// profiles.sponsor_id branch of current_sponsor_ids() until this is retried.
async function createClerkOrgForSponsor(
  adminClient: ReturnType<typeof createAdminClient>,
  sponsor: { id: string; company_name: string },
  applicant: { id: string; clerk_user_id: string | null }
): Promise<{ ok: true } | { ok: false; warning: string }> {
  if (!applicant.clerk_user_id) {
    return { ok: false, warning: 'The applicant has no linked Clerk account yet, so no organization was created.' }
  }
  try {
    const clerk = await clerkClient()
    const org = await clerk.organizations.createOrganization({
      name: sponsor.company_name,
      createdBy: applicant.clerk_user_id,
    })

    const { error: stampError } = await adminClient
      .from('sponsors')
      .update({ clerk_org_id: org.id })
      .eq('id', sponsor.id)
    if (stampError) {
      Sentry.captureException(new Error(`[createClerkOrgForSponsor] failed to stamp clerk_org_id: ${stampError.message}`))
      return { ok: false, warning: 'Clerk organization was created but could not be linked. Contact engineering.' }
    }

    // The creator is automatically an org:admin member in Clerk; look their membership
    // up rather than assuming an id so clerk_membership_id is accurate.
    let clerkMembershipId: string | null = null
    try {
      const memberships = await clerk.organizations.getOrganizationMembershipList({ organizationId: org.id })
      clerkMembershipId = memberships.data.find((m) => m.publicUserData?.userId === applicant.clerk_user_id)?.id ?? null
    } catch {
      // Non-fatal — the sponsor_members row below still grants access via the app.
    }

    const { error: memberError } = await adminClient.from('sponsor_members').upsert(
      {
        sponsor_id: sponsor.id,
        profile_id: applicant.id,
        clerk_org_id: org.id,
        clerk_membership_id: clerkMembershipId,
        role: 'org_admin',
        joined_at: new Date().toISOString(),
      },
      { onConflict: 'sponsor_id,profile_id' }
    )
    if (memberError) {
      Sentry.captureException(new Error(`[createClerkOrgForSponsor] failed to insert sponsor_members: ${memberError.message}`))
      return { ok: false, warning: 'Clerk organization was created but the membership row could not be saved. Contact engineering.' }
    }

    return { ok: true }
  } catch (err) {
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)))
    return {
      ok: false,
      warning: 'Could not create a Clerk organization for this sponsor. The account still works for one user; retry from this page.',
    }
  }
}

export async function verifyCoach(coachId: string, verified: boolean) {
  const parsed = verifyCoachSchema.safeParse({ coachId, verified })
  if (!parsed.success) return { error: 'Invalid data' }

  let user, adminClient
  try {
    const auth = await requireAdmin()
    user = auth.user
    adminClient = auth.adminClient
  } catch (e: any) {
    return { error: e.message }
  }

  // Fetch coach profile to get pending data, name, and the credential path we are
  // about to destroy (see the purge below — the path is unrecoverable once cleared).
  const { data: coachProfile } = await adminClient
    .from('profiles')
    .select('full_name, pending_team_data, coach_credentials_url')
    .eq('id', coachId)
    .single()

  const { error } = await adminClient
    .from('profiles')
    .update({
      coach_verified: verified,
      // Approval supersedes any earlier denial. pending_team_data is cleared
      // below only AFTER the team row is provisioned successfully, so a failed
      // insert can still be retried by the dashboard fallback.
      ...(verified ? { denial_reason: null, denied_at: null } : {})
    })
    .eq('id', coachId)

  if (error) return { error: mapDbError(error, 'verifyCoach.update') }

  await adminClient.from('audit_log').insert({
    actor_id: user.id,
    action: verified ? 'verify_coach' : 'unverify_coach',
    entity_type: 'profiles',
    entity_id: coachId,
  })

  let provisioningWarning: string | undefined

  if (verified) {
    const coachName = coachProfile?.full_name ?? 'Coach'
    
    // Provision team from pending data. Writes ONLY the fields the signup
    // wizard currently collects — never the legacy robot columns (drivetrain,
    // build_system, programming, cad_software, control_system, sensors, …),
    // which are being dropped from the schema.
    if (coachProfile?.pending_team_data) {
      const payloadData = coachProfile.pending_team_data as Record<string, unknown>

      // Existing teams MUST have a team number (DB constraint); if missing,
      // fall back to incubator instead of failing provisioning.
      //
      // pending_team_data is untyped jsonb, so both enum columns are narrowed here
      // rather than cast away at the insert. This is what the `as never` on the insert
      // used to hide — and hiding it is what let the missing `slug` through (P0-14).
      const ftcTeamNumber = (payloadData.ftcTeamNumber as number | undefined) ?? null
      const rawStatus = (payloadData.status as string) || 'existing'
      let status: TeamStatus =
        rawStatus === 'incubator' || (rawStatus === 'existing' && !ftcTeamNumber)
          ? 'incubator'
          : 'existing'
      const rawTaxStatus = (payloadData.taxStatus as string | undefined) || 'None'
      const taxStatus: TaxStatus =
        rawTaxStatus === '501c3' || rawTaxStatus === 'School' ? rawTaxStatus : 'None'

      const teamName = ((payloadData.teamName as string | undefined) || '').trim()

      // This is the PRIMARY team-creation path (prompts/07) — before this slice it ran
      // NO roster check at all. Verification must never leave a coach unverified: a
      // rejected match downgrades to the incubator branch that already exists below
      // rather than failing provisioning, and every other outcome just proceeds.
      let verificationWarning: string | undefined
      let verificationRecordId: string | null = null
      if (status === 'existing' && ftcTeamNumber) {
        const verification = await verifyFTCTeamIdentity({
          teamNumber: ftcTeamNumber,
          claimedTeamName: teamName,
          claimedOrganization: (payloadData.organization as string | undefined) ?? null,
          profileId: coachId,
        })
        verificationRecordId = verification.recordId

        if (verification.outcome === 'rejected') {
          status = 'incubator'
          verificationWarning =
            `Team #${ftcTeamNumber} could not be matched to the official FIRST roster by name, ` +
            'so the team was provisioned as an incubator pending manual review instead of an existing team.'
        } else if (verification.outcome === 'needs_review') {
          verificationWarning =
            `Team #${ftcTeamNumber}'s name didn't closely match the official FIRST roster record ` +
            '(now flagged for review in the verification queue).'
        }
      }

      // slug is NOT NULL UNIQUE with no DB default — derive it with the shared helper
      // (P0-14: this was the one site 4ebe492 fixed, inline; three others were missed).
      const baseSlug = deriveTeamSlug(teamName, ftcTeamNumber)

      const teamPayload = {
        owner_id: coachId,
        status,
        ftc_team_number: ftcTeamNumber,
        team_name: teamName,
        slug: baseSlug,
        organization: (payloadData.organization as string | undefined)?.trim() || null,
        city: ((payloadData.city as string | undefined) || '').trim(),
        state: ((payloadData.state as string | undefined) || '').trim(),
        mission_statement: ((payloadData.missionStatement as string | undefined) || '').trim(),
        tax_status: taxStatus,
        community_interest_text: (payloadData.communityInterestText as string | undefined)?.trim() || null,
        seed_funding_goals_cents: (payloadData.seedFundingGoalsCents as number | undefined) ?? 0,
      }

      let { data: insertedTeam, error: teamError } = await adminClient.from('teams').insert(teamPayload).select('id').single()
      if (teamError?.code === '23505') {
        // slug collision — retry once with a random suffix
        ;({ data: insertedTeam, error: teamError } = await adminClient
          .from('teams')
          .insert({ ...teamPayload, slug: uniquifyTeamSlug(baseSlug) })
          .select('id')
          .single())
      }
      if (teamError) {
        // The coach IS verified; keep pending data for retry and tell the admin.
        console.error('[verifyCoach] team provisioning failed:', teamError)
        Sentry.captureException(new Error(`[verifyCoach] team provisioning failed: ${teamError.message}`))
        provisioningWarning =
          'Coach verified, but their team could not be created automatically. Ask them to re-save their portfolio, or contact support.'
      } else {
        await adminClient.from('profiles').update({ pending_team_data: null }).eq('id', coachId)
        if (verificationRecordId && insertedTeam?.id) {
          await adminClient
            .from('team_verification_records')
            .update({ team_id: insertedTeam.id })
            .eq('id', verificationRecordId)
        }
        provisioningWarning = verificationWarning
      }
    }

    await Promise.all([
      createInAppNotification({
        skipEmail: true,
        recipientId: coachId,
        type: 'coach_verified',
        title: 'Your account has been verified!',
        body: 'Your team portfolio has been successfully created. You can now submit sponsorship applications.',
      }),
      sendCoachVerificationEmail(coachId, coachName),
    ])

    // The photo ID has now served its only purpose. Destroy it.
    //
    // Runs LAST on purpose: the coach is already verified and notified, so a storage
    // failure here costs nothing and tonight's sweep retries it. Running it earlier
    // would risk deleting the evidence for a verification that then failed to land.
    const purge = await purgeCoachCredentials(
      adminClient,
      coachId,
      coachProfile?.coach_credentials_url
    )

    if (purge.purged && coachProfile?.coach_credentials_url) {
      await adminClient.from('audit_log').insert({
        actor_id: user.id,
        action: 'purge_coach_credentials',
        entity_type: 'profiles',
        entity_id: coachId,
        metadata: { reason: 'verified', file_path: coachProfile.coach_credentials_url },
      })
    }
  } else {
    // Revoking used to be silent. It now also means the coach must re-upload, because
    // approval destroyed their ID — so a coach who was never told would sit on a
    // dashboard that had quietly stopped letting them submit, with no way to guess why.
    await createInAppNotification({
      recipientId: coachId,
      type: 'general',
      title: 'Your coach verification was removed',
      body:
        'An administrator has removed the verified status from your account, so you cannot ' +
        'submit new pitches for now. Your team portfolio and existing pitches are untouched. ' +
        'To get verified again, upload your photo ID once more from your account page — ' +
        'your previous one was deleted after your original review.',
    })
  }

  revalidatePath('/coaches')
  revalidatePath('/analytics')
  revalidatePath('/admin')
  return { success: true, ...(provisioningWarning ? { warning: provisioningWarning } : {}) }
}

export async function denyCoach(coachId: string, reason: string) {
  if (!reason.trim()) return { error: 'Denial reason is required' }

  let user, adminClient
  try {
    const auth = await requireAdmin()
    user = auth.user
    adminClient = auth.adminClient
  } catch (e: any) {
    return { error: e.message }
  }

  // Fetch coach info to get their email/name and current credentials path
  const { data: coachProfile } = await adminClient
    .from('profiles')
    .select('full_name, email, coach_credentials_url')
    .eq('id', coachId)
    .single()

  if (!coachProfile) return { error: 'Coach not found' }

  // Optionally delete the physical file from storage
  if (coachProfile.coach_credentials_url) {
    const { error: deleteError } = await adminClient.storage
      .from('coach-credentials')
      .remove([coachProfile.coach_credentials_url])
    
    if (deleteError) {
      console.error('Failed to delete credentials file during denial:', deleteError)
      // Continue anyway; DB state is more important
    }
  }

  // Update profile: clear data, keep verified = false, and record the denial
  // so the coach sees the reason on /awaiting-verification and admins see the
  // history when re-reviewing. A successful re-upload clears both fields.
  const { error } = await adminClient
    .from('profiles')
    .update({
      coach_verified: false,
      coach_credentials_url: null,
      // Stamped only when a document actually existed to destroy — otherwise this
      // would claim a review happened for a coach who never uploaded anything.
      ...(coachProfile.coach_credentials_url
        ? { coach_credentials_purged_at: new Date().toISOString() }
        : {}),
      pending_team_data: null,
      denial_reason: reason.trim(),
      denied_at: new Date().toISOString(),
    })
    .eq('id', coachId)

  if (error) return { error: mapDbError(error, 'denyCoach.update') }

  await adminClient.from('audit_log').insert({
    actor_id: user.id,
    action: 'deny_coach',
    entity_type: 'profiles',
    entity_id: coachId,
    metadata: { reason }
  })

  // Send the denial email
  if (coachProfile.email) {
    await sendCoachDenialEmail(
      coachProfile.email, 
      coachProfile.full_name ?? 'Coach', 
      reason
    )
    
    // Also send an in-app notification
    await createInAppNotification({
      skipEmail: true,
      recipientId: coachId,
      type: 'coach_verified', // Re-using type since we don't have a distinct 'coach_denied' type yet
      title: 'Application Update Required',
      body: 'There was an issue verifying your coach application. Please check your email for details.',
    })
  }

  revalidatePath('/coaches')
  return { success: true }
}

// Super admin, not reviewer (0084): approving an application mints a sponsor company
// with a funding cap, which is a capacity-governance act.
export async function approveSponsorApplication(applicationId: string) {
  const parsed = applicationActionSchema.safeParse({ applicationId })
  if (!parsed.success) return { error: 'Invalid application ID' }

  let user, adminClient
  try {
    const auth = await requireSuperAdmin()
    user = auth.user
    adminClient = auth.adminClient
  } catch (e: any) {
    return { error: e.message }
  }

  const { data: app, error: fetchError } = await adminClient
    .from('sponsor_applications')
    .select('company_name, contact_name, contact_email, proposed_cap_cents, message, status')
    .eq('id', applicationId)
    .single()

  if (fetchError || !app) return { error: 'Application not found' }

  if (app.status === 'approved') {
    return { error: 'This application has already been approved.' }
  }

  // CLAIM-FIRST idempotency. A plain `if (status === 'approved') return` is check-then-act:
  // two concurrent clicks both read 'pending' and both go on to insert a sponsor company
  // (there is no UNIQUE on sponsors.company_name or contact_email), which is the very
  // duplicate-cap bug the guard is meant to prevent. Flipping the status FIRST, with
  // `.eq('status','pending')` as the precondition, makes the claim atomic: the loser
  // matches zero rows and stops here.
  //
  // This also fixes the ordering hazard in the reverse direction — the status write used
  // to happen AFTER the sponsor insert and its error was never checked, so a failed write
  // left a real company row with a full cap behind a still-'pending' application, and the
  // next click created a second one.
  const { data: claimed, error: claimError } = await adminClient
    .from('sponsor_applications')
    .update({ status: 'approved', approved_at: new Date().toISOString(), approved_by: user.id } as never)
    .eq('id', applicationId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()

  if (claimError) {
    return { error: mapDbError(claimError, 'approveSponsorApplication.claim') }
  }
  if (!claimed) {
    return { error: 'This application was already processed. Refresh the page.' }
  }

  const contactEmail = app.contact_email?.trim().toLowerCase() ?? null

  // Create the sponsor record
  const { data: newSponsor, error: insertError } = await adminClient.from('sponsors').insert({
    company_name: app.company_name,
    contact_name: app.contact_name,
    contact_email: contactEmail ?? app.contact_email,
    funding_cap_cents: app.proposed_cap_cents ?? 0,
    status: 'active',
    source: 'public_optin' as const,
    notes: app.message ?? null,
  })
    .select('id')
    .single()

  if (insertError || !newSponsor) {
    // Release the claim so the admin can genuinely retry, rather than being told
    // "already approved" for an application that has no sponsor company.
    await adminClient
      .from('sponsor_applications')
      .update({ status: 'pending', approved_at: null, approved_by: null } as never)
      .eq('id', applicationId)
    return { error: insertError ? mapDbError(insertError, 'approveSponsorApplication.insert') : 'Failed to create sponsor' }
  }

  // Link the applicant's profile to the new sponsor so requireSponsor() admits them.
  // Public opt-in applicants signed up via the sponsor wizard (role='sponsor',
  // sponsor_id=null); without this they are locked out of the entire sponsor portal
  // after approval.
  //
  // Two defects fixed here:
  //  * CASE. profiles.email is Clerk-lowercased; contact_email was stored raw, so
  //    "Jane@Acme.COM" matched ZERO rows. Postgres does not report a zero-row UPDATE as
  //    an error, so linkError was null, the console.error never fired, and the action
  //    returned success — leaving the sponsor on "Awaiting verification" forever.
  //    Both sides are lowercased now (see also lib/schemas/sponsor.ts).
  //  * FAN-OUT. There was no .limit(1) and profiles.email has no UNIQUE constraint
  //    (0001:61), so EVERY profile sharing that address was linked to this one sponsor
  //    company — N users with full access to one sponsor's inbox, funding page and
  //    decision actions, behind a green success toast.
  let linkedProfileId: string | null = null
  let linkedProfileClerkId: string | null = null
  if (contactEmail) {
    const { data: applicantProfile, error: findError } = await adminClient
      .from('profiles')
      .select('id, clerk_user_id')
      .eq('email', contactEmail)
      .eq('role', 'sponsor')
      .is('sponsor_id', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (findError) {
      console.error('[approveSponsorApplication] failed to find applicant profile:', findError)
    } else if (applicantProfile) {
      const { error: linkError } = await adminClient
        .from('profiles')
        .update({ sponsor_id: newSponsor.id })
        .eq('id', applicantProfile.id)

      if (linkError) {
        console.error('[approveSponsorApplication] failed to link profile to sponsor:', linkError)
      } else {
        linkedProfileId = applicantProfile.id
        linkedProfileClerkId = applicantProfile.clerk_user_id
      }
    }
  }

  await adminClient.from('audit_log').insert({
    actor_id: user.id,
    action: 'approve_sponsor_application',
    entity_type: 'sponsor_applications',
    entity_id: applicationId,
    metadata: { sponsor_id: newSponsor.id, linked_profile_id: linkedProfileId },
  })

  // Create the Clerk Organization and seed the applicant as its org_admin, so a
  // teammate can be invited later. A failure here does NOT un-approve the sponsor — the
  // claim-first idempotency above already committed the approval, and current_sponsor_ids()
  // falls back to profiles.sponsor_id, so the applicant still has a working single-seat
  // account. It is surfaced as a warning with a retry path (retryCreateSponsorOrganization).
  let orgWarning: string | undefined
  if (linkedProfileId) {
    const orgResult = await createClerkOrgForSponsor(
      adminClient,
      { id: newSponsor.id, company_name: app.company_name },
      { id: linkedProfileId, clerk_user_id: linkedProfileClerkId }
    )
    if (!orgResult.ok) orgWarning = orgResult.warning
  }

  // The applicant was told "you will receive an email" and previously never got one.
  if (linkedProfileId) {
    await createInAppNotification({
      recipientId: linkedProfileId,
      type: 'general',
      title: 'Your sponsor account is approved',
      body: `${app.company_name} is now an active sponsor. Sign in to review team pitches and manage your funding.`,
    })
  }

  revalidatePath('/applications')
  revalidatePath('/sponsors')

  // The admin needs to know when the account exists but nobody can sign into it.
  if (!linkedProfileId) {
    return {
      success: true,
      warning:
        `${app.company_name} was created, but no unlinked sponsor profile matched ` +
        `${contactEmail ?? 'the application email'}. The applicant cannot access the sponsor portal ` +
        `until their profile is linked — check the email on their account.`,
    }
  }

  return orgWarning ? { success: true, warning: orgWarning } : { success: true }
}

// Admin-only recovery path when org creation failed at approval time (Clerk outage,
// missing clerk_user_id at that moment, etc.). The sponsor already works via the legacy
// profiles.sponsor_id branch of current_sponsor_ids(); this just gives them a second seat.
export async function retryCreateSponsorOrganization(sponsorId: string) {
  const parsed = sponsorIdSchema.safeParse({ sponsorId })
  if (!parsed.success) return { error: 'Invalid sponsor ID' }

  let user, adminClient
  try {
    const auth = await requireSuperAdmin()
    user = auth.user
    adminClient = auth.adminClient
  } catch (e: any) {
    return { error: e.message }
  }

  const { data: sponsor, error: sponsorError } = await adminClient
    .from('sponsors')
    .select('id, company_name, clerk_org_id')
    .eq('id', sponsorId)
    .single()
  if (sponsorError || !sponsor) return { error: 'Sponsor not found' }
  if (sponsor.clerk_org_id) return { error: 'This sponsor already has a Clerk organization.' }

  const { data: applicant, error: applicantError } = await adminClient
    .from('profiles')
    .select('id, clerk_user_id')
    .eq('sponsor_id', sponsorId)
    .eq('role', 'sponsor')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (applicantError) return { error: mapDbError(applicantError, 'retryCreateSponsorOrganization.findApplicant') }
  if (!applicant) return { error: 'No sponsor user is linked to this company yet — link one before creating an organization.' }

  const result = await createClerkOrgForSponsor(adminClient, sponsor, applicant)
  if (!result.ok) return { error: result.warning }

  await adminClient.from('audit_log').insert({
    actor_id: user.id,
    action: 'retry_create_sponsor_organization',
    entity_type: 'sponsors',
    entity_id: sponsorId,
    metadata: { applicant_profile_id: applicant.id },
  })

  revalidatePath('/sponsors')
  return { success: true }
}

// Super admin, not reviewer (0084) — the mirror of approveSponsorApplication above.
export async function rejectSponsorApplication(applicationId: string) {
  const parsed = applicationActionSchema.safeParse({ applicationId })
  if (!parsed.success) return { error: 'Invalid application ID' }

  let user, adminClient
  try {
    const auth = await requireSuperAdmin()
    user = auth.user
    adminClient = auth.adminClient
  } catch (e: any) {
    return { error: e.message }
  }

  const { data: app } = await adminClient
    .from('sponsor_applications')
    .select('company_name, contact_email, status')
    .eq('id', applicationId)
    .single()

  // A missing row previously fell through: the update matched zero rows, Postgres
  // reported no error, and the action returned success plus an audit entry for a
  // rejection that never happened.
  if (!app) return { error: 'Application not found.' }
  if (app.status === 'rejected') {
    return { error: 'This application has already been rejected.' }
  }
  // Rejecting an ALREADY-APPROVED application would flip the status while leaving the
  // sponsor company active and the applicant's profiles.sponsor_id linked — and then
  // email them a rejection. Deactivate the sponsor first if that is really the intent.
  if (app.status === 'approved') {
    return {
      error:
        'This application was already approved and the sponsor account exists. ' +
        'Deactivate the sponsor from the Sponsors page instead.',
    }
  }

  const { error } = await adminClient
    .from('sponsor_applications')
    .update({ status: 'rejected' })
    .eq('id', applicationId)
    .eq('status', 'pending')

  if (error) return { error: mapDbError(error, 'rejectSponsorApplication.update') }

  await adminClient.from('audit_log').insert({
    actor_id: user.id,
    action: 'reject_sponsor_application',
    entity_type: 'sponsor_applications',
    entity_id: applicationId,
  })

  // P1: rejection previously notified the applicant of NOTHING. They were left on the
  // "an administrator is reviewing your application… you will receive an email" screen
  // permanently, waiting for a mail that was never sent. createInAppNotification writes
  // the inbox row AND emails them.
  const contactEmail = app?.contact_email?.trim().toLowerCase()
  if (contactEmail) {
    const { data: applicantProfile } = await adminClient
      .from('profiles')
      .select('id')
      .eq('email', contactEmail)
      .eq('role', 'sponsor')
      // Same scoping as the approve path: without these, a duplicate email could route
      // the rejection to an already-linked, already-active sponsor.
      .is('sponsor_id', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (applicantProfile) {
      await createInAppNotification({
        recipientId: applicantProfile.id,
        type: 'general',
        title: 'Update on your sponsor application',
        body:
          `We were unable to approve the sponsor application for ${app?.company_name ?? 'your company'} ` +
          `at this time. If your circumstances change you are welcome to apply again, or reply to this ` +
          `email to reach the team.`,
      })
    }
  }

  revalidatePath('/applications')
  return { success: true }
}

export async function overrideTeamVerification(input: { recordId: string; reason: string }) {
  const parsed = teamVerificationOverrideSchema.safeParse(input)
  if (!parsed.success) {
    return { error: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', ') }
  }

  let user, adminClient
  try {
    const auth = await requireAdmin()
    user = auth.user
    adminClient = auth.adminClient
  } catch (e: any) {
    return { error: e.message }
  }

  const { data: record, error: fetchError } = await adminClient
    .from('team_verification_records')
    .select('id, team_id, profile_id, ftc_team_number, outcome')
    .eq('id', parsed.data.recordId)
    .single()

  if (fetchError || !record) return { error: 'Verification record not found' }

  const previousOutcome = record.outcome

  // team_verification_records has no UPDATE policy (0081) — this write only succeeds
  // because requireAdmin() hands back the service-role admin client.
  const { error: updateError } = await adminClient
    .from('team_verification_records')
    .update({
      outcome: 'overridden',
      override_reason: parsed.data.reason,
      overridden_by: user.id,
      overridden_at: new Date().toISOString(),
    })
    .eq('id', record.id)

  if (updateError) return { error: mapDbError(updateError, 'overrideTeamVerification.update') }

  // A rejection provisioned the team as an incubator (verifyCoach's downgrade branch) —
  // reinstate 'existing' now that an admin has manually confirmed the number.
  let teamOwnerId: string | null = null
  if (record.team_id) {
    const { data: team } = await adminClient
      .from('teams')
      .select('id, owner_id, status')
      .eq('id', record.team_id)
      .maybeSingle()

    teamOwnerId = team?.owner_id ?? null

    if (team && team.status === 'incubator' && previousOutcome === 'rejected') {
      await adminClient
        .from('teams')
        .update({ status: 'existing', ftc_team_number: record.ftc_team_number })
        .eq('id', record.team_id)
    }
  }

  await adminClient.from('audit_log').insert({
    actor_id: user.id,
    action: 'override_team_verification',
    entity_type: 'team_verification_records',
    entity_id: record.id,
    metadata: {
      ftc_team_number: record.ftc_team_number,
      previous_outcome: previousOutcome,
      reason: parsed.data.reason,
    },
  })

  const recipientId = teamOwnerId ?? record.profile_id
  if (recipientId) {
    await createInAppNotification({
      recipientId,
      type: 'general',
      title: 'Your team number has been manually verified',
      body: `An administrator manually confirmed FTC Team #${record.ftc_team_number} for your team.`,
    })
  }

  revalidatePath('/coaches')
  return { success: true }
}


// ── Admin provisioning (0084) ────────────────────────────────────────────────────────
//
// Before this slice there was NO admin-provisioning code path at all: admins existed only
// because scripts/seed-test-accounts.mjs inserted them or because someone edited the row
// by hand. These three actions are the whole surface, and every one of them is
// super-admin-only.
//
// The database floor (trg_assert_super_admin_floor, deferred to COMMIT) is the real
// guarantee that the platform never ends up with zero super admins. The self-demotion
// refusals below are UX on top of it — a clear message instead of a raw 23514 — never
// instead of it.

const SUPER_ADMIN_FLOOR_MESSAGE = 'There must always be at least one super admin.'

/** The floor trigger raises check_violation; everything else is a real database error. */
function mapAdminLevelError(error: { code?: string | null; message: string }, context: string) {
  if (error.code === '23514') return SUPER_ADMIN_FLOOR_MESSAGE
  return mapDbError({ message: error.message, code: error.code ?? undefined }, context)
}

/** Mirror role into Clerk publicMetadata for client UX gating (not security). */
async function mirrorRoleIntoClerk(clerkUserId: string | null, role: 'admin' | 'coach' | 'sponsor') {
  if (!clerkUserId) return 'This user has no linked Clerk account, so their role was not mirrored into Clerk.'
  try {
    const clerk = await clerkClient()
    await clerk.users.updateUserMetadata(clerkUserId, { publicMetadata: { role } })
    return undefined
  } catch (e) {
    console.error('[admin] failed to mirror role into Clerk metadata:', e)
    Sentry.captureException(e instanceof Error ? e : new Error(String(e)))
    return 'The role was saved, but Clerk metadata could not be updated. Their menus may look stale until they sign in again.'
  }
}

export async function setAdminLevel(input: SetAdminLevelInput) {
  const parsed = setAdminLevelSchema.safeParse(input)
  if (!parsed.success) {
    return { error: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', ') }
  }

  let user, adminClient
  try {
    const auth = await requireSuperAdmin()
    user = auth.user
    adminClient = auth.adminClient
  } catch (e: any) {
    return { error: e.message }
  }

  if (parsed.data.profileId === user.id && parsed.data.level !== 'super_admin') {
    return { error: 'You cannot demote yourself. Ask another super admin.' }
  }

  const { data: target } = await adminClient
    .from('profiles')
    .select('id, full_name, email, role, admin_level')
    .eq('id', parsed.data.profileId)
    .maybeSingle()

  if (!target) return { error: 'Admin not found' }
  if (target.role !== 'admin') return { error: 'That account is not an admin.' }
  if (target.admin_level === parsed.data.level) {
    return { error: `${target.full_name ?? 'That admin'} is already a ${ADMIN_LEVEL_LABELS[parsed.data.level].toLowerCase()}.` }
  }

  // .eq('role','admin') so a coach or sponsor can never be handed a level, even if the
  // row changed underneath the read above.
  const { data: updated, error } = await adminClient
    .from('profiles')
    .update({ admin_level: parsed.data.level })
    .eq('id', parsed.data.profileId)
    .eq('role', 'admin')
    .select('id')
    .maybeSingle()

  if (error) return { error: mapAdminLevelError(error, 'setAdminLevel.update') }
  if (!updated) return { error: 'That account is no longer an admin. Refresh the page.' }

  await adminClient.from('audit_log').insert({
    actor_id: user.id,
    action: 'set_admin_level',
    entity_type: 'profiles',
    entity_id: parsed.data.profileId,
    metadata: { from: target.admin_level, to: parsed.data.level, target_profile_id: parsed.data.profileId },
  })

  await createInAppNotification({
    recipientId: parsed.data.profileId,
    type: 'general',
    title: `Your admin access is now ${ADMIN_LEVEL_LABELS[parsed.data.level]}`,
    body:
      parsed.data.level === 'super_admin'
        ? 'You can now edit sponsor funding caps, decide sponsor applications, run data exports, and manage the admin team.'
        : 'You keep the moderation queue and coach verification. Funding caps, sponsor applications, exports, and admin management now need a super admin.',
  })

  revalidatePath('/admin/team')
  return { success: true }
}

export async function provisionAdmin(input: ProvisionAdminInput) {
  const parsed = provisionAdminSchema.safeParse(input)
  if (!parsed.success) {
    return { error: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', ') }
  }

  let user, adminClient
  try {
    const auth = await requireSuperAdmin()
    user = auth.user
    adminClient = auth.adminClient
  } catch (e: any) {
    return { error: e.message }
  }

  // profiles.email is Clerk-lowercased and has NO unique constraint (0001:61). Lowercase
  // both sides and .limit(1) — the exact pair of defects fixed in approveSponsorApplication.
  const email = parsed.data.email.trim().toLowerCase()
  const { data: profile, error: findError } = await adminClient
    .from('profiles')
    .select('id, full_name, email, role, admin_level, sponsor_id, clerk_user_id')
    .eq('email', email)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (findError) return { error: mapDbError(findError, 'provisionAdmin.find') }
  if (!profile) {
    return { error: `No account exists for ${email}. Ask them to sign up first, then promote them here.` }
  }

  if (profile.role === 'admin') {
    return {
      error: `${profile.full_name ?? email} is already an admin. Change their level from the list below instead.`,
    }
  }

  // Promoting either of these strands data the promoted account still owns: a linked
  // sponsor loses their company portal, and a coach's team has no other owner.
  if (profile.role === 'sponsor' && profile.sponsor_id) {
    return {
      error:
        `${email} is linked to a sponsor company. Promoting them would cut off that company's ` +
        'only portal access — unlink or transfer the sponsor account first.',
    }
  }
  if (profile.role === 'coach') {
    const { count: teamCount } = await adminClient
      .from('teams')
      .select('id', { count: 'exact', head: true })
      .eq('owner_id', profile.id)
      .is('deleted_at', null)

    if ((teamCount ?? 0) > 0) {
      return {
        error:
          `${email} owns a team portfolio. Promoting them would orphan it — transfer or archive ` +
          'the team first.',
      }
    }
  }

  const { error } = await adminClient
    .from('profiles')
    .update({ role: 'admin', admin_level: parsed.data.level, sponsor_id: null })
    .eq('id', profile.id)

  if (error) return { error: mapAdminLevelError(error, 'provisionAdmin.update') }

  const warning = await mirrorRoleIntoClerk(profile.clerk_user_id, 'admin')

  await adminClient.from('audit_log').insert({
    actor_id: user.id,
    action: 'provision_admin',
    entity_type: 'profiles',
    entity_id: profile.id,
    metadata: { email, from_role: profile.role, level: parsed.data.level },
  })

  await createInAppNotification({
    recipientId: profile.id,
    type: 'general',
    title: 'You now have admin access',
    body: `An existing super admin gave you ${ADMIN_LEVEL_LABELS[parsed.data.level]} access to the admin portal.`,
  })

  revalidatePath('/admin/team')
  return warning ? { success: true as const, warning } : { success: true as const }
}

export async function demoteAdmin(input: DemoteAdminInput) {
  const parsed = demoteAdminSchema.safeParse(input)
  if (!parsed.success) {
    return { error: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', ') }
  }

  let user, adminClient
  try {
    const auth = await requireSuperAdmin()
    user = auth.user
    adminClient = auth.adminClient
  } catch (e: any) {
    return { error: e.message }
  }

  if (parsed.data.profileId === user.id) {
    return { error: 'You cannot demote yourself. Ask another super admin.' }
  }

  const { data: target } = await adminClient
    .from('profiles')
    .select('id, full_name, role, admin_level, clerk_user_id')
    .eq('id', parsed.data.profileId)
    .maybeSingle()

  if (!target) return { error: 'Admin not found' }
  if (target.role !== 'admin') return { error: 'That account is not an admin.' }

  // admin_level must go to NULL in the same statement: profiles_admin_level_requires_admin
  // rejects a level on a non-admin row.
  const { error } = await adminClient
    .from('profiles')
    .update({ role: parsed.data.newRole, admin_level: null })
    .eq('id', parsed.data.profileId)
    .eq('role', 'admin')

  if (error) return { error: mapAdminLevelError(error, 'demoteAdmin.update') }

  const warning = await mirrorRoleIntoClerk(target.clerk_user_id, parsed.data.newRole)

  await adminClient.from('audit_log').insert({
    actor_id: user.id,
    action: 'demote_admin',
    entity_type: 'profiles',
    entity_id: parsed.data.profileId,
    metadata: { from_level: target.admin_level, to_role: parsed.data.newRole },
  })

  await createInAppNotification({
    recipientId: parsed.data.profileId,
    type: 'general',
    title: 'Your admin access was removed',
    body: `Your account is now a ${parsed.data.newRole} account. Contact the platform team if this was unexpected.`,
  })

  revalidatePath('/admin/team')
  return warning ? { success: true as const, warning } : { success: true as const }
}
