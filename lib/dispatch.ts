import SubmissionEmail from '@/emails/submission-email'
import { Resend } from 'resend'
import { createHash } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { env } from '@/lib/env'
import { mapBudgetItems } from '@/lib/dispatch-budget'
import { SUPPORT_EMAIL as SITE_SUPPORT_EMAIL } from '@/lib/site-config'
import * as Sentry from '@sentry/nextjs'

const resend = new Resend(env.RESEND_API_KEY)

export type DispatchResult = { success: boolean; error?: string }

export { mapBudgetItems }

const SUPPORT_EMAIL = SITE_SUPPORT_EMAIL


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
  accessToken?: string,
  options?: { replyTo?: string }
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

    // The body already handled a null state; this template literal did not, and
    // rendered "Team 6832 (null)" straight into the subject line of the single most
    // important email this product sends.
    const teamLabel = team.ftc_team_number ? `Team ${team.ftc_team_number}` : 'Incubator Team'
    const state = typeof team.state === 'string' ? team.state.trim() : ''
    const subject = `Verified FTC Robotics Sponsorship Proposal: ${teamLabel}${state ? ` (${state})` : ''}`

    // The payment-handoff copy in this template and in handshake-email.tsx both tell the
    // sponsor to "reply to this email". RESEND_FROM_EMAIL is forced to noreply@ in
    // production (lib/env.ts:70-76) and no sender set replyTo anywhere in the codebase,
    // so every one of those replies landed in an unread mailbox. Route them at the coach
    // when we have their address, and at the support inbox otherwise.
    const coachProfile = (team.profiles ?? null) as { email?: string | null; full_name?: string | null } | null
    const replyTo = options?.replyTo ?? coachProfile?.email ?? SUPPORT_EMAIL

    const result = await resend.emails.send({
      from: env.RESEND_FROM_EMAIL,
      to: sponsor.contact_email as string,
      replyTo,
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
        // app/actions/team.ts:17-26 writes budget_items as snake_case
        // ({label, qty, unit_cost_cents, total_cents}) but SubmissionEmail reads
        // camelCase. The old `as` cast is compile-time only, so every row rendered
        // `undefined / 100` => "$NaN" in the sponsor's inbox while tsc stayed silent.
        // Mapped explicitly; asserted by tests/dispatch-budget-mapping.test.ts.
        budgetItems: mapBudgetItems(team.budget_items),
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
      // The token is part of the key on purpose: retrying the SAME dispatch (same token)
      // must dedupe, but a deliberate RE-dispatch mints a fresh token and MUST actually
      // send. Keying on submissionId alone made redispatch a silent no-op at Resend.
      idempotencyKey: createHash('sha256')
        .update(submissionId + 'sponsor' + (accessToken ?? ''))
        .digest('hex'),
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
