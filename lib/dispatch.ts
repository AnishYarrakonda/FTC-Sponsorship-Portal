import SubmissionEmail from '@/emails/submission-email'
import { Resend } from 'resend'
import { createHash } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { env } from '@/lib/env'
import * as Sentry from '@sentry/nextjs'

const resend = new Resend(env.RESEND_API_KEY)

export type DispatchResult = { success: boolean; error?: string }

function dispatchFailure(err: unknown, submissionId: string): DispatchResult {
  const message = err instanceof Error ? err.message
    : err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message)
    : String(err)
  console.error('[dispatch] Failed to dispatch email', err)
  Sentry.captureException(
    err instanceof Error ? err : new Error(`[dispatch] ${message}`),
    { extra: { submissionId } }
  )
  return { success: false, error: message }
}

/**
 * Admin-gated sponsor outreach. This is the ONLY path that may email a pitch to
 * a sponsor. Never throws — always resolves to a DispatchResult so callers can
 * surface a warning when the outreach email could not be sent.
 */
export async function dispatchApprovedSubmission(
  submissionId: string,
  accessToken?: string
): Promise<DispatchResult> {
  try {
    const supabase = createAdminClient()

    const { data: submission } = await supabase
      .from('submissions')
      .select(`
        *,
        teams:team_id (
          *,
          profiles:owner_id (email, full_name)
        ),
        sponsors:sponsor_id (
          *
        )
      `)
      .eq('id', submissionId)
      .single()

    if (!submission || !submission.sponsors || !submission.teams) {
      return dispatchFailure(new Error('Submission not found or missing relations'), submissionId)
    }

    const sponsor = submission.sponsors as unknown as Record<string, unknown>
    const team = submission.teams as unknown as Record<string, unknown>

    const viewerUrl = accessToken
      ? `${env.NEXT_PUBLIC_APP_URL}/sponsor-view/${accessToken}`
      : null

    const subject = `Verified FTC Robotics Sponsorship Proposal: Team ${team.ftc_team_number ?? 'Incubator'} (${team.state})`

    const result = await resend.emails.send({
      from: env.RESEND_FROM_EMAIL,
      to: sponsor.contact_email as string,
      subject,
      react: SubmissionEmail({
        teamName: team.team_name as string,
        ftcTeamNumber: team.ftc_team_number as number | null,
        state: team.state as string,
        taxStatus: team.tax_status as string,
        missionStatement: team.mission_statement as string | null,
        technicalSummary: team.technical_summary as string | null,
        outreachSummary: team.outreach_summary as string | null,
        financialAskCents: team.financial_ask_cents as number,
        budgetItems: team.budget_items as { label: string; qty: number; unitCostCents: number; totalCents: number }[],
        customPitchAlignment: submission.custom_pitch_alignment ?? '',
        specificNeedsStatement: submission.specific_needs_statement ?? '',
        heroImageUrl: ((team.media_urls as string[]) ?? [])[0] ?? null,
        viewerUrl,
      }),
      tags: [
        { name: 'submission_id', value: submission.id },
        { name: 'sponsor_id', value: sponsor.id as string },
      ],
    }, {
      // Request-level idempotency so a retried dispatch never double-sends.
      idempotencyKey: createHash('sha256').update(submissionId + 'sponsor').digest('hex'),
    })

    if (result.data?.id) {
      await supabase
        .from('submissions')
        .update({ resend_message_id: result.data.id })
        .eq('id', submissionId)
    }

    if (result.error) {
      console.error('[dispatch] Failed to send email to', sponsor.contact_email, result.error)
      return dispatchFailure(result.error, submissionId)
    }

    return { success: true }
  } catch (e) {
    return dispatchFailure(e, submissionId)
  }
}
