'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { clerkClient } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { requireAuth } from '@/lib/actions-utils'
import { mapDbError } from '@/lib/errors'
import { env } from '@/lib/env'
import { writeAudit } from '@/lib/audit'
import { sponsorRecipientProfiles } from '@/lib/sponsor-recipients'
import { createInAppNotification } from '@/lib/notify'

const updateProfileSchema = z.object({
  fullName: z.string().min(2, 'Name must be at least 2 characters').max(100),
})

const updatePasswordSchema = z.object({
  newPassword: z
    .string()
    .min(12, 'Password must be at least 12 characters')
    .regex(/[A-Z]/, 'Must include at least one uppercase letter')
    .regex(/[a-z]/, 'Must include at least one lowercase letter')
    .regex(/[0-9]/, 'Must include at least one number'),
  currentPassword: z.string().min(1, 'Current password is required'),
})

const changeEmailSchema = z.object({
  newEmail: z.string().trim().toLowerCase().email('Enter a valid email address'),
  currentPassword: z.string().min(1, 'Current password is required'),
})

const deleteAccountSchema = z.object({
  confirmEmail: z.string().trim().toLowerCase().email('Enter a valid email address'),
  currentPassword: z.string().min(1, 'Current password is required'),
  /**
   * B-03-16. Set only after the caller has been shown, and explicitly acknowledged, the
   * live sponsorship commitments their deletion will orphan. Optional so the first call
   * can discover them; the second call carries it.
   */
  acknowledgeCommitments: z.boolean().optional(),
})

/**
 * B-03-16. Non-terminal fulfillment statuses — a commitment still in motion. `receipted`
 * and `cancelled` are terminal and need no warning.
 */
const IN_FLIGHT_FULFILLMENT_STATUSES = ['pledged', 'agreement_signed', 'payment_sent', 'payment_received'] as const

export async function updateProfile(data: { fullName: string }) {
  const result = updateProfileSchema.safeParse(data)
  if (!result.success) {
    return { error: result.error.issues[0].message }
  }

  let user, supabase
  try {
    const auth = await requireAuth()
    user = auth.user
    supabase = auth.supabase
  } catch {
    return { error: 'Not authenticated' }
  }

  const { error: profileError } = await supabase
    .from('profiles')
    .update({ full_name: result.data.fullName })
    .eq('id', user.id)

  if (profileError) return { error: mapDbError(profileError, 'updateProfile') }

  await writeAudit(createAdminClient(), {
    actor_id: user.id,
    action: 'update_profile',
    entity_type: 'profiles',
    entity_id: user.id,
    metadata: { field: 'full_name' },
  })

  return { success: true }
}

export async function updatePassword(data: { newPassword: string; currentPassword: string }) {
  const result = updatePasswordSchema.safeParse(data)
  if (!result.success) {
    return { error: result.error.issues[0].message }
  }

  let user, clerkUserId
  try {
    const auth = await requireAuth()
    user = auth.user
    clerkUserId = auth.clerkUserId
  } catch {
    return { error: 'Not authenticated' }
  }

  const clerk = await clerkClient()

  // Re-authenticate before changing password
  try {
    await clerk.users.verifyPassword({
      userId: clerkUserId,
      password: result.data.currentPassword,
    })
  } catch {
    return { error: 'Current password is incorrect.' }
  }

  try {
    await clerk.users.updateUser(clerkUserId, { password: result.data.newPassword })
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Unable to update password.' }
  }

  await writeAudit(createAdminClient(), {
    actor_id: user.id,
    action: 'update_password',
    entity_type: 'profiles',
    entity_id: user.id,
  })

  return { success: true }
}

export async function changeEmail(data: { newEmail: string; currentPassword: string }) {
  const result = changeEmailSchema.safeParse(data)
  if (!result.success) {
    return { error: result.error.issues[0].message }
  }

  let user, clerkUserId
  try {
    const auth = await requireAuth()
    user = auth.user
    clerkUserId = auth.clerkUserId
  } catch {
    return { error: 'Not authenticated' }
  }

  if (result.data.newEmail === (user.email ?? '').toLowerCase()) {
    return { error: 'New email must be different from your current email.' }
  }

  const clerk = await clerkClient()

  // Re-authenticate before changing email
  try {
    await clerk.users.verifyPassword({
      userId: clerkUserId,
      password: result.data.currentPassword,
    })
  } catch {
    return { error: 'Current password is incorrect.' }
  }

  // Clerk owns email verification: register the new address (unverified, not yet
  // primary). The user confirms it via the link Clerk emails, after which it can
  // be promoted to primary. The profiles.email mirror is updated by the Clerk
  // webhook once the change lands.
  try {
    await clerk.emailAddresses.createEmailAddress({
      userId: clerkUserId,
      emailAddress: result.data.newEmail,
      verified: false,
      primary: false,
    })
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Unable to change email.' }
  }

  await writeAudit(createAdminClient(), {
    actor_id: user.id,
    action: 'change_email_requested',
    entity_type: 'profiles',
    entity_id: user.id,
    metadata: { new_email: result.data.newEmail },
  })

  return {
    success: true,
    message: `Verification sent to ${result.data.newEmail} — it becomes your active email once confirmed.`,
  }
}

export async function deleteAccount(data: {
  confirmEmail: string
  currentPassword: string
  acknowledgeCommitments?: boolean
}) {
  const parsed = deleteAccountSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid account deletion request' }
  }

  let user, clerkUserId
  try {
    const auth = await requireAuth()
    user = auth.user
    clerkUserId = auth.clerkUserId
  } catch {
    return { error: 'Not authenticated' }
  }

  const userEmail = (user.email ?? '').toLowerCase()
  if (!userEmail || parsed.data.confirmEmail !== userEmail) {
    return { error: 'Confirmation email does not match your account email.' }
  }

  const clerk = await clerkClient()

  // Re-authenticate before destructive deletion
  try {
    await clerk.users.verifyPassword({
      userId: clerkUserId,
      password: parsed.data.currentPassword,
    })
  } catch {
    return { error: 'Re-authentication failed. Check your current password and try again.' }
  }

  /**
   * B-03-16. Deleting the Clerk user fires `user.deleted`, which removes the profile and
   * lets the database cascade take the team and its submissions with it. That cascade is
   * safe for capacity (the 0067 BEFORE DELETE trigger gives reservations back, and
   * detect_capacity_drift stays at zero) and the ESIGN record survives because the
   * signature row snapshots signer_legal_name / signer_email / typed_name. What it did
   * NOT do was tell anybody: a coach could leave with an executed agreement and a sponsor
   * who had actually mailed a cheque, and the sponsor would learn nothing.
   *
   * This is a hard warning rather than a block. Refusing deletion outright would make a
   * user's ability to leave the platform contingent on a third party's payment workflow,
   * which is the wrong trade for an account-erasure control. So: enumerate the live
   * commitments, make the caller acknowledge them explicitly, then notify the sponsor side
   * on the way out.
   */
  const adminClient = createAdminClient()
  const { data: liveFulfillments } = await adminClient
    .from('funding_fulfillments')
    .select('id, sponsor_id, amount_cents, status, submission_id, teams:team_id(team_name, owner_id)')
    .in('status', [...IN_FLIGHT_FULFILLMENT_STATUSES])

  const ownCommitments = (liveFulfillments ?? []).filter(
    (f) => (f.teams as { owner_id?: string } | null)?.owner_id === user.id
  )

  if (ownCommitments.length > 0 && !parsed.data.acknowledgeCommitments) {
    const total = ownCommitments.reduce((sum, f) => sum + (f.amount_cents ?? 0), 0)
    return {
      requiresCommitmentAcknowledgement: true,
      commitmentCount: ownCommitments.length,
      commitmentTotalCents: total,
      error:
        `Your team has ${ownCommitments.length} sponsorship commitment${ownCommitments.length === 1 ? '' : 's'} ` +
        `still in progress, worth ${(total / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}. ` +
        'Deleting your account removes your team and its pitches. Any payment already sent to you will ' +
        'no longer be tracked here, and the sponsors involved will be notified that you have left.',
    }
  }

  // Notify the sponsor side BEFORE the profile disappears — afterwards the team name and
  // the fulfillment's link back to a submission are gone.
  for (const commitment of ownCommitments) {
    if (!commitment.sponsor_id) continue
    const teamName = (commitment.teams as { team_name?: string } | null)?.team_name ?? 'A team you sponsor'
    const recipients = await sponsorRecipientProfiles(adminClient, commitment.sponsor_id)
    for (const recipient of recipients) {
      await createInAppNotification({
        recipientId: recipient.id,
        type: 'general',
        title: `${teamName} has left the platform`,
        body:
          `The coach for ${teamName} has deleted their account while a sponsorship commitment of ` +
          `${((commitment.amount_cents ?? 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} ` +
          `was still in progress (status: ${commitment.status}). No further payment should be sent. ` +
          'Cancel the commitment from your Funding page to release the reserved capacity, or contact support.',
      })
    }
  }

  await writeAudit(adminClient, {
    actor_id: user.id,
    action: 'delete_account',
    entity_type: 'profiles',
    entity_id: user.id,
    metadata: {
      in_flight_commitments: ownCommitments.length,
      in_flight_total_cents: ownCommitments.reduce((sum, f) => sum + (f.amount_cents ?? 0), 0),
      acknowledged: parsed.data.acknowledgeCommitments === true,
    },
  })

  try {
    await clerk.users.deleteUser(clerkUserId)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Unable to delete account.' }
  }

  redirect('/login?deleted=1')
}

export async function requestDataExport(): Promise<{ error?: string; message?: string }> {
  let user
  try {
    const auth = await requireAuth()
    user = auth.user
  } catch {
    return { error: 'Not authenticated' }
  }

  if (!user.email) {
    return { error: 'No email address is associated with your account.' }
  }

  // Collect every record we hold for this user. (COPPA: the schema contains zero
  // student PII, so this is the user's own coach/sponsor data only.)
  const admin = createAdminClient()
  const [profileRes, teamsRes, notificationsRes, auditRes] = await Promise.all([
    admin.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    admin.from('teams').select('*').eq('owner_id', user.id),
    admin.from('notifications').select('*').eq('recipient_id', user.id),
    admin.from('audit_log').select('*').eq('actor_id', user.id),
  ])

  const teamIds = (teamsRes.data ?? []).map((t) => t.id)
  let submissions: unknown[] = []
  if (teamIds.length > 0) {
    const subRes = await admin.from('submissions').select('*').in('team_id', teamIds)
    submissions = subRes.data ?? []
  }

  const exportPayload = {
    generated_at: new Date().toISOString(),
    account: { id: user.id, email: user.email },
    profile: profileRes.data ?? null,
    teams: teamsRes.data ?? [],
    submissions,
    notifications: notificationsRes.data ?? [],
    audit_log: auditRes.data ?? [],
  }
  const json = JSON.stringify(exportPayload, null, 2)

  // Email the export to the requester's own verified address. This is a self-service
  // transactional email (not sponsor-facing), so it is not subject to the admin dispatch gate.
  try {
    const { Resend } = await import('resend')
    const resend = new Resend(env.RESEND_API_KEY)
    const { error: sendError } = await resend.emails.send({
      from: env.RESEND_FROM_EMAIL,
      to: user.email,
      subject: 'Your FTC Pitfund data export',
      text:
        'Attached is a JSON export of the data we hold for your account, including your ' +
        'profile, team portfolio, submissions, notifications, and activity log. ' +
        'If you did not request this export, please contact support.',
      attachments: [
        {
          filename: `ftc-portal-data-export-${new Date().toISOString().slice(0, 10)}.json`,
          content: Buffer.from(json).toString('base64'),
        },
      ],
    })
    if (sendError) {
      console.error('[data-export] Resend returned an error', sendError)
      return { error: 'We could not send your export right now. Please try again later.' }
    }
  } catch (e) {
    console.error('[data-export] send failed', e)
    return { error: 'We could not send your export right now. Please try again later.' }
  }

  await writeAudit(admin, {
    actor_id: user.id,
    action: 'data_export',
    entity_type: 'profiles',
    entity_id: user.id,
    metadata: { delivered_to: user.email },
  })

  return { message: `Your data export has been emailed to ${user.email}.` }
}
