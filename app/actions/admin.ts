'use server'

import { revalidatePath } from 'next/cache'
import * as Sentry from '@sentry/nextjs'
import { createInAppNotification, sendCoachVerificationEmail, sendCoachDenialEmail } from '@/lib/notify'
import { requireAdmin } from '@/lib/actions-utils'
import { purgeCoachCredentials } from '@/lib/credentials-retention'
import { mapDbError } from '@/lib/errors'
import { deriveTeamSlug, uniquifyTeamSlug } from '@/lib/team-slug'
import type { Database } from '@/lib/supabase/types'
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
      const status: TeamStatus =
        rawStatus === 'incubator' || (rawStatus === 'existing' && !ftcTeamNumber)
          ? 'incubator'
          : 'existing'
      const rawTaxStatus = (payloadData.taxStatus as string | undefined) || 'None'
      const taxStatus: TaxStatus =
        rawTaxStatus === '501c3' || rawTaxStatus === 'School' ? rawTaxStatus : 'None'

      const teamName = ((payloadData.teamName as string | undefined) || '').trim()
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

      let { error: teamError } = await adminClient.from('teams').insert(teamPayload)
      if (teamError?.code === '23505') {
        // slug collision — retry once with a random suffix
        ;({ error: teamError } = await adminClient
          .from('teams')
          .insert({ ...teamPayload, slug: uniquifyTeamSlug(baseSlug) }))
      }
      if (teamError) {
        // The coach IS verified; keep pending data for retry and tell the admin.
        console.error('[verifyCoach] team provisioning failed:', teamError)
        Sentry.captureException(new Error(`[verifyCoach] team provisioning failed: ${teamError.message}`))
        provisioningWarning =
          'Coach verified, but their team could not be created automatically. Ask them to re-save their portfolio, or contact support.'
      } else {
        await adminClient.from('profiles').update({ pending_team_data: null }).eq('id', coachId)
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

export async function approveSponsorApplication(applicationId: string) {
  const parsed = applicationActionSchema.safeParse({ applicationId })
  if (!parsed.success) return { error: 'Invalid application ID' }

  let user, adminClient
  try {
    const auth = await requireAdmin()
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
  if (contactEmail) {
    const { data: applicantProfile, error: findError } = await adminClient
      .from('profiles')
      .select('id')
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

  return { success: true }
}

export async function rejectSponsorApplication(applicationId: string) {
  const parsed = applicationActionSchema.safeParse({ applicationId })
  if (!parsed.success) return { error: 'Invalid application ID' }

  let user, adminClient
  try {
    const auth = await requireAdmin()
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

