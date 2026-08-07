import SubmissionDecisionEmail from '@/emails/submission-decision-email'
import CredentialUploadAlert from '@/emails/credential-upload-alert'
import SponsorAppConfirmation from '@/emails/sponsor-app-confirmation'
import HandshakeEmail from '@/emails/handshake-email'
import CoachVerificationEmail from '@/emails/coach-verification-email'
import CoachSignupWelcomeEmail from '@/emails/coach-signup-welcome'
import CoachDenialEmail from '@/emails/coach-denial-email'
import NotificationEmail from '@/emails/notification-email'
import { Resend } from 'resend'
import { createHash } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { env } from '@/lib/env'
import * as Sentry from '@sentry/nextjs'
import { SUPPORT_EMAIL } from '@/lib/site-config'

const resend = new Resend(env.RESEND_API_KEY)

/**
 * Every sender in this module resolves to this shape and NEVER throws.
 * Failures are reported to Sentry; callers can (but are not required to)
 * inspect `success` to surface a warning when a decision-critical email
 * could not be delivered.
 */
export type NotifyResult = { success: boolean; error?: string }

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message)
  }
  return String(err)
}

/** Log + report a notify failure to Sentry and return the failed result. */
function notifyFailure(context: string, err: unknown): NotifyResult {
  const message = errorMessage(err)
  console.error(`[notify] ${context} failed`, err)
  Sentry.captureException(
    err instanceof Error ? err : new Error(`[notify:${context}] ${message}`),
    { extra: { context } }
  )
  return { success: false, error: message }
}

/** Send via Resend, mapping both thrown errors and `result.error` to a NotifyResult. */
async function sendViaResend(
  context: string,
  payload: Parameters<typeof resend.emails.send>[0],
  options?: Parameters<typeof resend.emails.send>[1]
): Promise<NotifyResult> {
  try {
    const { error } = await resend.emails.send(payload, options)
    if (error) return notifyFailure(context, error)
    return { success: true }
  } catch (err) {
    return notifyFailure(context, err)
  }
}

async function getAdminNotificationRecipients() {
  const configured = env.ADMIN_NOTIFICATION_EMAILS
    ?.split(',')
    .map((email) => email.trim())
    .filter(Boolean)

  if (configured && configured.length > 0) {
    return configured
  }

  const supabase = createAdminClient()
  const { data: admins } = await supabase
    .from('profiles')
    .select('email')
    .eq('role', 'admin')

  return (admins || [])
    .map((a) => a.email)
    .filter((email): email is string => Boolean(email))
}

/** Email the coach when their submission receives a moderation decision. */
export async function sendSubmissionDecisionEmail(
  submissionId: string,
  decision: 'approved' | 'declined' | 'changes_requested',
  feedback?: string
): Promise<NotifyResult> {
  try {
    const supabase = createAdminClient()
    const { data: submission } = await supabase
      .from('submissions')
      .select('id, team_id, sponsor_id, teams:team_id(owner_id, profiles:owner_id(email, full_name)), sponsors:sponsor_id(company_name)')
      .eq('id', submissionId)
      .single()

    if (!submission) {
      return notifyFailure('sendSubmissionDecisionEmail', new Error(`Submission ${submissionId} not found`))
    }

    const team = submission.teams as any
    const sponsor = submission.sponsors as any
    const coachEmail = team?.profiles?.email
    const coachName = team?.profiles?.full_name ?? 'Coach'

    const config = {
      approved: 'Your submission has been approved 🎉',
      declined: 'Update on your submission',
      changes_requested: 'Changes requested on your submission',
    }

    if (!coachEmail) {
      return notifyFailure('sendSubmissionDecisionEmail', new Error(`No coach email for submission ${submissionId}`))
    }

    return await sendViaResend('sendSubmissionDecisionEmail', {
      from: env.RESEND_FROM_EMAIL,
      to: coachEmail,
      subject: config[decision],
      react: SubmissionDecisionEmail({
        submissionTitle: `Submission to ${sponsor?.company_name ?? 'Sponsor'}`,
        coachName,
        decision,
        feedback,
      }),
    })
  } catch (err) {
    return notifyFailure('sendSubmissionDecisionEmail', err)
  }
}

/** Alert admins when a new coach has uploaded their credentials. */
export async function sendCredentialUploadAlert(
  _coachId: string,
  coachName: string,
  coachEmail: string
): Promise<NotifyResult> {
  try {
    const recipients = await getAdminNotificationRecipients()
    if (recipients.length === 0) {
      return notifyFailure('sendCredentialUploadAlert', new Error('No admin notification recipients configured'))
    }

    return await sendViaResend('sendCredentialUploadAlert', {
      from: env.RESEND_FROM_EMAIL,
      to: recipients,
      subject: `Action Required: New Coach Credentials (${coachName})`,
      react: CredentialUploadAlert({
        coachName,
        coachEmail,
        reviewUrl: `${env.NEXT_PUBLIC_APP_URL}/analytics`, // Analytics page has the pending list
      }),
    })
  } catch (err) {
    return notifyFailure('sendCredentialUploadAlert', err)
  }
}

/** Send "Match Made" emails to both sponsor and coach after an acceptance. */
export async function sendHandshakeEmail(
  submissionId: string,
  amountCents: number
): Promise<NotifyResult> {
  try {
    const supabase = createAdminClient()
    const { data: submission } = await supabase
      .from('submissions')
      .select(`
        id, team_id, sponsor_id,
        teams:team_id (
          team_name, ftc_team_number,
          profiles:owner_id (email, full_name)
        ),
        sponsors:sponsor_id (company_name, contact_email, contact_name)
      `)
      .eq('id', submissionId)
      .single()

    if (!submission) {
      return notifyFailure('sendHandshakeEmail', new Error(`Submission ${submissionId} not found`))
    }

    const team = submission.teams as unknown as Record<string, unknown>
    const sponsor = submission.sponsors as unknown as Record<string, unknown>
    const coachProfile = team.profiles as Record<string, string>

    const shared = {
      sponsorName: sponsor.company_name as string,
      teamName: team.team_name as string,
      ftcTeamNumber: team.ftc_team_number as number | null,
      amountCents,
      coachEmail: coachProfile.email,
    }

    // Both halves of this template instruct the recipient to "reply to this email" with
    // W-9 and payment instructions — the actual money handoff. RESEND_FROM_EMAIL is
    // forced to noreply@ in production (lib/env.ts:70-76) and `replyTo` was set NOWHERE
    // in the codebase, so every one of those replies went to an unread mailbox and the
    // handoff simply stopped. Point each side at the other's real address.
    const coachEmail = coachProfile.email
    const sponsorEmail = sponsor.contact_email as string

    const [coachResult, sponsorResult] = await Promise.all([
      // To coach — replies reach the sponsor.
      sendViaResend('sendHandshakeEmail(coach)', {
        from: env.RESEND_FROM_EMAIL,
        to: coachEmail,
        replyTo: sponsorEmail || SUPPORT_EMAIL,
        subject: `Match Made! ${sponsor.company_name} will sponsor your team for $${(amountCents / 100).toFixed(2)}`,
        react: HandshakeEmail({ ...shared, recipientName: coachProfile.full_name ?? 'Coach', isSponsor: false }),
      }, {
        idempotencyKey: createHash('sha256').update(submissionId + 'handshake-coach').digest('hex'),
      }),
      // To sponsor — replies reach the coach, who owns the W-9 and payment details.
      sendViaResend('sendHandshakeEmail(sponsor)', {
        from: env.RESEND_FROM_EMAIL,
        to: sponsorEmail,
        replyTo: coachEmail || SUPPORT_EMAIL,
        subject: `Match Made! You're sponsoring ${team.team_name} for $${(amountCents / 100).toFixed(2)}`,
        react: HandshakeEmail({ ...shared, recipientName: sponsor.contact_name as string ?? 'Sponsor', isSponsor: true }),
      }, {
        idempotencyKey: createHash('sha256').update(submissionId + 'handshake-sponsor').digest('hex'),
      }),
    ])

    if (!coachResult.success || !sponsorResult.success) {
      return {
        success: false,
        error: [coachResult.error, sponsorResult.error].filter(Boolean).join('; '),
      }
    }
    return { success: true }
  } catch (err) {
    return notifyFailure('sendHandshakeEmail', err)
  }
}

/** Confirm to a sponsor that we received their application. */
export async function sendSponsorApplicationConfirmation(
  companyName: string,
  contactEmail: string,
  contactName: string,
  proposedCapCents: number
): Promise<NotifyResult> {
  return sendViaResend('sendSponsorApplicationConfirmation', {
    from: env.RESEND_FROM_EMAIL,
    to: contactEmail,
    subject: 'We received your sponsor application',
    react: SponsorAppConfirmation({
      companyName,
      contactName,
      proposedCapCents,
    }),
  })
}

export async function createInAppNotification({
  recipientId, type, title, body, submissionId, skipEmail = false,
}: {
  recipientId: string
  type: 'submission_declined' | 'submission_approved' | 'submission_changes_requested' | 'coach_verified' | 'general'
  title: string
  body?: string
  submissionId?: string
  /**
   * Set true ONLY when the caller already sends a richer, recipient-specific
   * email for the same event (e.g. a decision or verification template) so we
   * don't double-email. When false (the default) every inbox alert is mirrored
   * by a direct email, guaranteeing both channels fire for every event.
   */
  skipEmail?: boolean
}): Promise<NotifyResult> {
  const supabase = createAdminClient()
  const failures: string[] = []

  // 1. In-app inbox alert.
  try {
    const { error: insertError } = await supabase.from('notifications').insert({
      recipient_id: recipientId,
      type, title, body: body ?? null, submission_id: submissionId ?? null,
    })
    if (insertError) {
      failures.push(notifyFailure('createInAppNotification(in-app)', insertError).error!)
    }
  } catch (err) {
    failures.push(notifyFailure('createInAppNotification(in-app)', err).error!)
  }

  // 2. Mirror it as a direct email (unless the caller sends its own).
  if (!skipEmail) {
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('email')
        .eq('id', recipientId)
        .single()
      if (profile?.email) {
        const emailResult = await sendViaResend('createInAppNotification(email)', {
          from: env.RESEND_FROM_EMAIL,
          to: profile.email,
          subject: title,
          react: NotificationEmail({
            title,
            body,
            ctaUrl: `${env.NEXT_PUBLIC_APP_URL}/dashboard`,
            ctaLabel: 'Open the portal',
          }),
        })
        if (!emailResult.success) failures.push(emailResult.error!)
      } else {
        failures.push(
          notifyFailure('createInAppNotification(email)', new Error(`No email on profile ${recipientId}`)).error!
        )
      }
    } catch (err) {
      failures.push(notifyFailure('createInAppNotification(email)', err).error!)
    }
  }

  if (failures.length > 0) return { success: false, error: failures.join('; ') }
  return { success: true }
}

/** Email a coach when an admin denies their credential verification. */
export async function sendCoachDenialEmail(
  to: string,
  coachName: string,
  reason: string
): Promise<NotifyResult> {
  return sendViaResend('sendCoachDenialEmail', {
    from: env.RESEND_FROM_EMAIL,
    to,
    subject: 'Application Update Required — FTC Matchmaker',
    react: CoachDenialEmail({ coachName, reason }),
  })
}

/** Send a congratulations email when an admin verifies a coach's credentials. */
export async function sendCoachVerificationEmail(
  coachId: string,
  coachName: string
): Promise<NotifyResult> {
  try {
    const supabase = createAdminClient()
    const { data: profile } = await supabase
      .from('profiles')
      .select('email')
      .eq('id', coachId)
      .single()

    if (!profile?.email) {
      return notifyFailure('sendCoachVerificationEmail', new Error(`No email on profile ${coachId}`))
    }

    return await sendViaResend('sendCoachVerificationEmail', {
      from: env.RESEND_FROM_EMAIL,
      to: profile.email,
      subject: 'Welcome to the FTC Matchmaker!',
      react: CoachVerificationEmail({ coachName }),
    })
  } catch (err) {
    return notifyFailure('sendCoachVerificationEmail', err)
  }
}

/** Alert admins when a new sponsor application is submitted. */
export async function sendSponsorApplicationAlert(
  companyName: string,
  contactName: string,
  contactEmail: string,
  proposedCapCents: number
): Promise<NotifyResult> {
  try {
    const recipients = await getAdminNotificationRecipients()
    if (recipients.length === 0) {
      return notifyFailure('sendSponsorApplicationAlert', new Error('No admin notification recipients configured'))
    }

    return await sendViaResend('sendSponsorApplicationAlert', {
      from: env.RESEND_FROM_EMAIL,
      to: recipients,
      subject: `Action Required: New Sponsor Application (${companyName})`,
      react: CredentialUploadAlert({
        coachName: contactName,
        coachEmail: contactEmail,
        reviewUrl: `${env.NEXT_PUBLIC_APP_URL}/applications`,
        heading: 'New sponsor application',
        description: `submitted a sponsor application on behalf of ${companyName} (proposed cap $${(proposedCapCents / 100).toLocaleString('en-US')}).`,
      }),
    })
  } catch (err) {
    return notifyFailure('sendSponsorApplicationAlert', err)
  }
}

export async function sendCoachSignupWelcomeEmail(
  coachEmail: string,
  coachName: string
): Promise<NotifyResult> {
  return sendViaResend('sendCoachSignupWelcomeEmail', {
    from: env.RESEND_FROM_EMAIL,
    to: coachEmail,
    subject: 'Welcome to the FTC Matchmaker!',
    react: CoachSignupWelcomeEmail({ coachName }),
  })
}

export async function sendWelcomeInAppNotification(
  userId: string,
  name: string
): Promise<NotifyResult> {
  // BUG FIX: the signup action passes the CLERK user id (text, `user_…`), but
  // notifications.recipient_id is a uuid FK to profiles(id) — so this insert
  // failed silently on every signup. Resolve non-uuid ids via profiles.clerk_user_id.
  let recipientId = userId
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)
  if (!isUuid) {
    try {
      const supabase = createAdminClient()
      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('clerk_user_id', userId)
        .single()
      if (!profile?.id) {
        return notifyFailure('sendWelcomeInAppNotification', new Error(`No profile for clerk user ${userId}`))
      }
      recipientId = profile.id
    } catch (err) {
      return notifyFailure('sendWelcomeInAppNotification', err)
    }
  }

  return createInAppNotification({
    recipientId,
    type: 'general',
    title: 'Welcome to the FTC Matchmaker! 🎉',
    body: `Hi ${name},\n\nWe're thrilled to have you here. Your account is currently pending verification—our team reviews photo IDs within 24-48 hours.\n\nIn the meantime, you can start building your team portfolio to get a head start on your funding requests!`,
    skipEmail: true, // coach already receives sendCoachSignupWelcomeEmail
  })
}
