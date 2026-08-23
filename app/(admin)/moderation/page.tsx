import { createClient } from '@/lib/supabase/server'

/**
 * Matches the .limit(200) the in-flight query below already used. Raise it only with a
 * paging control to go with it — the columns selected here are wide.
 */
const MODERATION_QUEUE_LIMIT = 200
import { PageHeader } from '@/components/page-header'
import { ModerationQueue } from '@/components/admin/moderation-queue'
import { InFlightSubmissions, type InFlightSubmission } from '@/components/admin/in-flight-submissions'
import {
  MessageReviewQueue,
  type PendingCoachReply,
  type FlaggedSponsorMessage,
} from '@/components/admin/message-review-queue'

export const dynamic = 'force-dynamic'

export default async function ModerationPage() {
  const supabase = await createClient()

  const { data: submissions } = await supabase
    .from('submissions')
    .select(`
      id,
      updated_at,
      requested_amount_cents,
      custom_pitch_alignment,
      specific_needs_statement,
      teams:team_id (
        team_name,
        ftc_team_number,
        state,
        status,
        mission_statement,
        technical_summary,
        outreach_summary,
        financial_ask_cents,
        budget_items
      ),
      sponsors:sponsor_id (
        company_name
      )
    `)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(MODERATION_QUEUE_LIMIT)

  /**
   * The select above pulls wide free-text columns (custom_pitch_alignment,
   * specific_needs_statement, plus the joined team's mission/technical/outreach
   * summaries). Unbounded, a large backlog buffers every one of those into the function's
   * memory on a page the admin hits constantly. The sibling in-flight query below has
   * always capped at 200; this one simply never did.
   *
   * The count is fetched separately (head:true, no rows) so the cap is visible in the UI
   * rather than silently truncating the queue.
   */
  const { count: pendingTotal } = await supabase
    .from('submissions')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')

  // Pitches that have left the review queue but not yet reached a sponsor decision.
  // 'dispatched', 'delivered' and 'opened' previously appeared in NO admin view at all,
  // which is why a failed dispatch (P0-11) had nowhere to be seen or retried.
  const { data: inFlight } = await supabase
    .from('submissions')
    .select(`
      id,
      status,
      sent_at,
      expires_at,
      resend_message_id,
      reserved_amount_cents,
      teams:team_id ( team_name, ftc_team_number ),
      sponsors:sponsor_id ( company_name )
    `)
    .in('status', ['dispatched', 'delivered', 'opened'])
    .is('deleted_at', null)
    .order('sent_at', { ascending: false })
    .limit(200)

  // Coach replies waiting for release, oldest first. The admin client is not needed: the
  // sm_select_admin policy grants is_admin() a full read.
  const { data: pendingMessages } = await supabase
    .from('submission_messages')
    .select(`
      id,
      body,
      author_label,
      created_at,
      submission_id,
      submissions:submission_id (
        teams:team_id ( team_name ),
        sponsors:sponsor_id ( company_name )
      )
    `)
    .eq('status', 'pending')
    .eq('author_role', 'coach')
    .order('created_at', { ascending: true })
    .limit(100)

  // The sponsor question each reply is answering, fetched in one round trip and matched
  // per-thread below rather than N+1'ing one query per pending reply.
  const pendingSubmissionIds = Array.from(
    new Set((pendingMessages ?? []).map((m) => m.submission_id))
  )
  const { data: sponsorQuestions } = pendingSubmissionIds.length
    ? await supabase
        .from('submission_messages')
        .select('submission_id, body, author_label, created_at')
        .in('submission_id', pendingSubmissionIds)
        .eq('author_role', 'sponsor')
        .order('created_at', { ascending: false })
    : { data: [] }

  const latestQuestion = new Map<string, { body: string; author_label: string }>()
  for (const q of sponsorQuestions ?? []) {
    if (!latestQuestion.has(q.submission_id)) {
      latestQuestion.set(q.submission_id, { body: q.body, author_label: q.author_label })
    }
  }

  const pendingReplies: PendingCoachReply[] = (pendingMessages ?? []).map((m) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sub = (m as any).submissions
    const q = latestQuestion.get(m.submission_id)
    return {
      id: m.id,
      body: m.body,
      author_label: m.author_label,
      created_at: m.created_at,
      submission_id: m.submission_id,
      team_name: sub?.teams?.team_name ?? 'Unknown team',
      company_name: sub?.sponsors?.company_name ?? 'Unknown sponsor',
      question_body: q?.body ?? null,
      question_label: q?.author_label ?? null,
    }
  })

  const { data: flaggedRows } = await supabase
    .from('submission_messages')
    .select(`
      id,
      body,
      author_label,
      created_at,
      flagged_at,
      submission_id,
      submissions:submission_id (
        teams:team_id ( team_name ),
        sponsors:sponsor_id ( company_name )
      )
    `)
    .not('flagged_at', 'is', null)
    .order('flagged_at', { ascending: false })
    .limit(50)

  const flaggedMessages: FlaggedSponsorMessage[] = (flaggedRows ?? []).map((m) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sub = (m as any).submissions
    return {
      id: m.id,
      body: m.body,
      author_label: m.author_label,
      created_at: m.created_at,
      flagged_at: m.flagged_at as string,
      submission_id: m.submission_id,
      team_name: sub?.teams?.team_name ?? 'Unknown team',
      company_name: sub?.sponsors?.company_name ?? 'Unknown sponsor',
    }
  })

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Review Queue"
        subtitle="Review submitted portfolios and custom pitches. Approved submissions are dispatched to sponsors with a secure 14-day token link."
      />
      <ModerationQueue initialSubmissions={submissions ?? []} />
      {typeof pendingTotal === 'number' && pendingTotal > (submissions?.length ?? 0) && (
        <p className="-mt-6 text-sm text-muted-foreground">
          Showing the {submissions?.length ?? 0} oldest of {pendingTotal} pending pitches. Work
          through these and the rest will follow.
        </p>
      )}

      <MessageReviewQueue pending={pendingReplies} flagged={flaggedMessages} />

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold">Awaiting sponsor decision</h2>
          <p className="text-sm text-muted-foreground">
            Already approved and holding sponsor capacity. Resend if the sponsor never received the pitch.
          </p>
        </div>
        <InFlightSubmissions submissions={(inFlight ?? []) as unknown as InFlightSubmission[]} />
      </section>
    </div>
  )
}
