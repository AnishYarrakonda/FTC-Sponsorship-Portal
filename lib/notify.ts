import SubmissionDecisionEmail from '@/emails/submission-decision-email'
import CredentialUploadAlert from '@/emails/credential-upload-alert'
import SponsorAppConfirmation from '@/emails/sponsor-app-confirmation'
import HandshakeEmail from '@/emails/handshake-email'
import CoachVerificationEmail from '@/emails/coach-verification-email'
import CoachSignupWelcomeEmail from '@/emails/coach-signup-welcome'
import CoachDenialEmail from '@/emails/coach-denial-email'
import NotificationEmail from '@/emails/notification-email'
import FulfillmentNudgeEmail from '@/emails/fulfillment-nudge-email'
import FundingReceiptEmail from '@/emails/funding-receipt-email'
import ThreadMessageEmail from '@/emails/thread-message-email'
import type { ReceiptDocumentContext } from '@/lib/receipt-document'
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

/** Alert admins when a coach uploads a W-9. */
export async function sendW9UploadAlert(
  teamName: string,
  coachName: string,
  coachEmail: string
): Promise<NotifyResult> {
  try {
    const recipients = await getAdminNotificationRecipients()
    if (recipients.length === 0) {
      return notifyFailure('sendW9UploadAlert', new Error('No admin notification recipients configured'))
    }

    return await sendViaResend('sendW9UploadAlert', {
      from: env.RESEND_FROM_EMAIL,
      to: recipients,
      subject: `Action Required: New W-9 Upload (${teamName})`,
      react: CredentialUploadAlert({
        coachName,
        coachEmail,
        heading: 'New W-9 uploaded',
        description: `uploaded a new W-9 for team ${teamName}.`,
        reviewUrl: `${env.NEXT_PUBLIC_APP_URL}/admin/payouts`,
      }),
    })
  } catch (err) {
    return notifyFailure('sendW9UploadAlert', err)
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
  // First thing a prospective sponsor ever receives from us — a reply must reach a human.
  // Beyond the human cost, a From whose replies bounce is itself a mild negative reputation
  // signal with several providers. See docs/email-deliverability.md.
  return sendViaResend('sendSponsorApplicationConfirmation', {
    from: env.RESEND_FROM_EMAIL,
    to: contactEmail,
    replyTo: SUPPORT_EMAIL,
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
  // This email tells a coach their application needs work; they will reply asking how.
  // Route that at the support inbox rather than the noreply@ void.
  return sendViaResend('sendCoachDenialEmail', {
    from: env.RESEND_FROM_EMAIL,
    to,
    replyTo: SUPPORT_EMAIL,
    subject: 'Application Update Required — FTC Pitfund',
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
      subject: 'Welcome to FTC Pitfund!',
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
    subject: 'Welcome to FTC Pitfund!',
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
    title: 'Welcome to FTC Pitfund! 🎉',
    body: `Hi ${name},\n\nWe're thrilled to have you here. Your account is currently pending verification—our team reviews photo IDs within 24-48 hours.\n\nIn the meantime, you can start building your team portfolio to get a head start on your funding requests!`,
    skipEmail: true, // coach already receives sendCoachSignupWelcomeEmail
  })
}

export async function sendFulfillmentNudgeEmail(args: {
  fulfillmentId: string
  to: string
  replyTo?: string
  recipientName: string
  audience: 'sponsor' | 'coach' | 'admin'
  sponsorName: string
  teamName: string
  ftcTeamNumber: number | null
  amountCents: number
  status: 'pledged' | 'agreement_signed' | 'payment_sent'
  daysOpen: number
}): Promise<NotifyResult> {
  const dateStr = new Date().toISOString().split('T')[0]
  const idempotencyKey = createHash('sha256')
    .update(args.fulfillmentId + 'nudge' + args.audience + dateStr)
    .digest('hex')

  const ctaUrl = args.audience === 'admin'
    ? `${env.NEXT_PUBLIC_APP_URL}/reconciliation`
    : args.audience === 'sponsor'
    ? `${env.NEXT_PUBLIC_APP_URL}/sponsor/funding`
    : `${env.NEXT_PUBLIC_APP_URL}/dashboard?tab=funding`

  const ctaLabel = args.audience === 'sponsor' && (args.status === 'pledged' || args.status === 'agreement_signed')
    ? 'Mark payment sent'
    : args.audience === 'coach'
    ? 'Confirm receipt'
    : 'View details'

  return sendViaResend(
    'sendFulfillmentNudgeEmail',
    {
      from: env.RESEND_FROM_EMAIL,
      to: args.to,
      replyTo: args.replyTo || SUPPORT_EMAIL,
      subject: `Update on ${args.sponsorName} sponsorship for ${args.teamName}`,
      react: FulfillmentNudgeEmail({
        recipientName: args.recipientName,
        audience: args.audience,
        sponsorName: args.sponsorName,
        teamName: args.teamName,
        ftcTeamNumber: args.ftcTeamNumber,
        amountCents: args.amountCents,
        status: args.status,
        daysOpen: args.daysOpen,
        ctaUrl,
        ctaLabel,
      }),
    },
    { idempotencyKey }
  )
}

export async function sendFundingReceiptEmail(args: {
  receiptId: string
  receiptNumber: string
  to: string
  replyTo?: string
  ctx?: ReceiptDocumentContext
  /** Pass stored document_html to re-send immutably without re-rendering. */
  rawHtml?: string
  isResend?: boolean
}): Promise<NotifyResult> {
  const idempotencyKey = args.isResend
    ? createHash('sha256').update(args.receiptId + 'receipt-resend' + Date.now()).digest('hex')
    : createHash('sha256').update(args.receiptId + 'receipt').digest('hex')

  // Prefer stored HTML (resend path) to avoid silently picking up template changes.
  // Fall back to rendering from ctx when rawHtml is not supplied (first-issue path).
  const reactElement = (!args.rawHtml && args.ctx) ? FundingReceiptEmail(args.ctx) : undefined
  const payeeName = args.ctx?.payeeLegalName ?? 'the payee'

  return sendViaResend(
    'sendFundingReceiptEmail',
    {
      from: env.RESEND_FROM_EMAIL,
      to: args.to,
      replyTo: args.replyTo || SUPPORT_EMAIL,
      subject: `[Receipt ${args.receiptNumber}] Contribution Acknowledgment — ${payeeName}`,
      ...(args.rawHtml ? { html: args.rawHtml } : { react: reactElement }),
    },
    { idempotencyKey }
  )
}



/**
 * Email a released Q&A message to the counterparty.
 *
 * Called once per release from releaseCoachReply. For a token-only sponsor there is no
 * profiles row, so createInAppNotification is impossible and this is the ONLY channel that
 * reaches them — which is why the release path always sends it, even when the in-app
 * fan-out also fired for account sponsors.
 *
 * replyTo is SUPPORT_EMAIL and NEVER the counterparty's address. sendHandshakeEmail
 * deliberately cross-wires the two humans, but only AFTER a funding match is settled; doing
 * it here would create exactly the unmoderated coach->sponsor backchannel this whole feature
 * exists to prevent.
 */
export async function sendThreadMessageEmail(messageId: string): Promise<NotifyResult> {
  try {
    const admin = createAdminClient()

    const { data: message, error } = await admin
      .from('submission_messages')
      .select('id, body, author_role, author_label, status, submission_id')
      .eq('id', messageId)
      .single()

    if (error || !message) {
      return notifyFailure('sendThreadMessageEmail', error ?? new Error('message not found'))
    }
    if (message.status !== 'released') {
      // Defensive: nothing unreleased ever leaves the building.
      return notifyFailure(
        'sendThreadMessageEmail',
        new Error(`refusing to send message ${messageId} with status ${message.status}`)
      )
    }

    const { data: submission } = await admin
      .from('submissions')
      .select('id, sponsor_id, teams:team_id(team_name, owner_id), sponsors:sponsor_id(company_name, contact_name, contact_email)')
      .eq('id', message.submission_id)
      .single()

    if (!submission) {
      return notifyFailure('sendThreadMessageEmail', new Error('submission not found'))
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const team = (submission as any).teams as { team_name?: string; owner_id?: string } | null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sponsor = (submission as any).sponsors as {
      company_name?: string
      contact_name?: string
      contact_email?: string
    } | null

    const teamName = team?.team_name ?? 'the team'
    const sponsorName = sponsor?.company_name ?? 'the sponsor'

    let to: string | null = null
    let recipientName = 'there'
    let ctaUrl: string | undefined

    if (message.author_role === 'coach') {
      // Coach -> sponsor. Prefer a portal account; fall back to the company contact, and to
      // the still-live token link when that is the only surface they have.
      // profiles.sponsor_id first, then sponsor_members — the same union
      // current_sponsor_ids() does (0082), so an org teammate who never had
      // profiles.sponsor_id stamped is still reachable.
      let { data: sponsorProfile } = await admin
        .from('profiles')
        .select('email, full_name')
        .eq('role', 'sponsor')
        .eq('sponsor_id', submission.sponsor_id)
        .not('email', 'is', null)
        .limit(1)
        .maybeSingle()

      if (!sponsorProfile?.email) {
        const { data: member } = await admin
          .from('sponsor_members')
          .select('profiles:profile_id(email, full_name)')
          .eq('sponsor_id', submission.sponsor_id)
          .limit(1)
          .maybeSingle()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const memberProfile = (member as any)?.profiles as { email?: string; full_name?: string } | null
        if (memberProfile?.email) {
          sponsorProfile = { email: memberProfile.email, full_name: memberProfile.full_name ?? '' }
        }
      }

      if (sponsorProfile?.email) {
        to = sponsorProfile.email
        recipientName = sponsorProfile.full_name ?? sponsor?.contact_name ?? 'there'
        ctaUrl = `${env.NEXT_PUBLIC_APP_URL}/sponsor/submissions/${submission.id}`
      } else if (sponsor?.contact_email) {
        // Token-only sponsor: no portal account, so no portal link.
        //
        // The prompt for this feature asked for a /sponsor-view/<token> CTA here, gated on
        // the token still being unused/unrevoked/unexpired. That is not buildable: 0018
        // stores only sha256(token) and the raw value is never persisted, so the URL cannot
        // be reconstructed server-side. Minting a fresh token to make a link would be a new
        // dispatch surface, which Core Mandate 2 puts behind admin approval — not something
        // a message release may do implicitly.
        //
        // So this email carries the message body and no button. The sponsor still holds the
        // original dispatch email with their live link, and the body is the actual payload.
        to = sponsor.contact_email
        recipientName = sponsor.contact_name ?? 'there'
        ctaUrl = undefined
      }
    } else {
      // Sponsor -> coach. Only reachable when a caller chooses to email the coach directly;
      // the normal sponsor path notifies in-app instead.
      const { data: coach } = await admin
        .from('profiles')
        .select('email, full_name')
        .eq('id', team?.owner_id ?? '')
        .maybeSingle()

      if (coach?.email) {
        to = coach.email
        recipientName = coach.full_name ?? 'Coach'
        ctaUrl = `${env.NEXT_PUBLIC_APP_URL}/submissions/${submission.id}`
      }
    }

    if (!to) {
      return notifyFailure(
        'sendThreadMessageEmail',
        new Error(`no deliverable address for message ${messageId}`)
      )
    }

    return sendViaResend(
      'sendThreadMessageEmail',
      {
        from: env.RESEND_FROM_EMAIL,
        to,
        replyTo: SUPPORT_EMAIL,
        subject: `${message.author_label} replied about ${teamName}`,
        react: ThreadMessageEmail({
          recipientName,
          counterpartyLabel: message.author_label,
          teamName,
          sponsorName,
          messageBody: message.body,
          ctaUrl,
          ctaLabel: 'Open the conversation',
        }),
      },
      { idempotencyKey: createHash('sha256').update(messageId + 'thread').digest('hex') }
    )
  } catch (err) {
    return notifyFailure('sendThreadMessageEmail', err)
  }
}

