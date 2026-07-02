'use server'

import { revalidatePath } from 'next/cache'
import * as Sentry from '@sentry/nextjs'
import { createInAppNotification, sendCoachVerificationEmail, sendCoachDenialEmail } from '@/lib/notify'
import { requireAdmin } from '@/lib/actions-utils'
import { mapDbError } from '@/lib/errors'
import { z } from 'zod'

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

  // Fetch coach profile to get pending data and name
  const { data: coachProfile } = await adminClient
    .from('profiles')
    .select('full_name, pending_team_data')
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
      const ftcTeamNumber = (payloadData.ftcTeamNumber as number | undefined) ?? null
      const rawStatus = (payloadData.status as string) || 'existing'
      const status = rawStatus === 'existing' && !ftcTeamNumber ? 'incubator' : rawStatus

      const teamName = ((payloadData.teamName as string | undefined) || '').trim()
      // slug is NOT NULL UNIQUE with no DB default — derive it here (same rule
      // as the 0046 backfill), uniquified with a random suffix on collision.
      const baseSlug = (teamName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'team')
        + (ftcTeamNumber ? `-${ftcTeamNumber}` : '')

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
        tax_status: (payloadData.taxStatus as string | undefined) || 'None',
        community_interest_text: (payloadData.communityInterestText as string | undefined)?.trim() || null,
        seed_funding_goals_cents: (payloadData.seedFundingGoalsCents as number | undefined) ?? 0,
      }

      let { error: teamError } = await adminClient.from('teams').insert(teamPayload as never)
      if (teamError?.code === '23505') {
        // slug collision — retry once with a random suffix
        ;({ error: teamError } = await adminClient
          .from('teams')
          .insert({ ...teamPayload, slug: `${baseSlug}-${Math.random().toString(36).slice(2, 8)}` } as never))
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
    .select('company_name, contact_name, contact_email, proposed_cap_cents, message')
    .eq('id', applicationId)
    .single()

  if (fetchError || !app) return { error: 'Application not found' }

  // Create the sponsor record
  const { data: newSponsor, error: insertError } = await adminClient.from('sponsors').insert({
    company_name: app.company_name,
    contact_name: app.contact_name,
    contact_email: app.contact_email,
    funding_cap_cents: app.proposed_cap_cents ?? 0,
    status: 'active',
    source: 'public_optin' as const,
    notes: app.message ?? null,
  })
    .select('id')
    .single()

  if (insertError || !newSponsor) {
    return { error: insertError ? mapDbError(insertError, 'approveSponsorApplication.insert') : 'Failed to create sponsor' }
  }

  // Link the applicant's profile to the new sponsor so requireSponsor() admits them.
  // Public opt-in applicants signed up via signUpSponsor (role='sponsor', sponsor_id=null);
  // without this they would be locked out of the entire sponsor portal after approval.
  // Match on the application contact email (same value the user signed up with).
  if (app.contact_email) {
    const { error: linkError } = await adminClient
      .from('profiles')
      .update({ sponsor_id: newSponsor.id } as never)
      .eq('email', app.contact_email)
      .eq('role', 'sponsor')

    if (linkError) {
      console.error('[approveSponsorApplication] failed to link profile to sponsor:', linkError)
    }
  }

  // Mark application as approved
  await adminClient
    .from('sponsor_applications')
    .update({ status: 'approved', approved_at: new Date().toISOString(), approved_by: user.id } as never)
    .eq('id', applicationId)

  await adminClient.from('audit_log').insert({
    actor_id: user.id,
    action: 'approve_sponsor_application',
    entity_type: 'sponsor_applications',
    entity_id: applicationId,
  })

  revalidatePath('/applications')
  revalidatePath('/sponsors')
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

  const { error } = await adminClient
    .from('sponsor_applications')
    .update({ status: 'rejected' })
    .eq('id', applicationId)

  if (error) return { error: mapDbError(error, 'rejectSponsorApplication.update') }

  await adminClient.from('audit_log').insert({
    actor_id: user.id,
    action: 'reject_sponsor_application',
    entity_type: 'sponsor_applications',
    entity_id: applicationId,
  })

  revalidatePath('/applications')
  return { success: true }
}

