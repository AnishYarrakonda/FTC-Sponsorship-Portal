import Link from 'next/link'
import { getAuthedProfile } from '@/lib/actions-utils'
import { redirect, notFound } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { buttonVariants } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/status-badge'
import { MatchHandoffPanel } from '@/components/funding/match-handoff-panel'
import { createAdminClient } from '@/lib/supabase/admin'
import { COACH_EDITABLE_STATUSES, isAwaitingSponsor } from '@/lib/submission-status'
import { WithdrawPitchButton } from '@/components/coach/withdraw-pitch-button'
import { CoachThreadPanel } from '@/components/messages/thread-panels'
import type { ThreadMessage } from '@/components/messages/thread'
import { cn } from '@/lib/utils'

// This route had no bare detail page before — only /edit. It exists because a submission
// past the coach-editable statuses (`approved`, say) has nothing sensible to "edit" but
// still needs somewhere to show its outcome. Since 0111 that outcome is the whole of the
// post-match experience: who the sponsor is, what they committed, and how to reach them.
export default async function CoachSubmissionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const authed = await getAuthedProfile()
  if (!authed) redirect('/login')
  const { supabase, user } = authed

  const { data: submission } = await supabase
    .from('submissions')
    .select('id, status, requested_amount_cents, reserved_amount_cents, team_id, sponsor_id, expires_at')
    .eq('id', id)
    .maybeSingle()

  if (!submission) notFound()

  const { data: team } = await supabase
    .from('teams')
    .select('owner_id, team_name')
    .eq('id', submission.team_id)
    .maybeSingle()

  if (!team || team.owner_id !== user.id) notFound()

  // sponsors is RLS-restricted (coaches aren't a party to other sponsors' rows); the
  // public view is the established pattern for coach-facing sponsor name lookups — see
  // app/(coach)/dashboard/page.tsx.
  const { data: sponsor } = await supabase
    .from('v_sponsors_public')
    .select('company_name')
    .eq('id', submission.sponsor_id)
    .maybeSingle()

  const isEditable = (COACH_EDITABLE_STATUSES as readonly string[]).includes(submission.status)
  const sponsorName = sponsor?.company_name ?? 'Sponsor'
  const amountCents = submission.reserved_amount_cents || submission.requested_amount_cents
  const isMatched = submission.status === 'approved'

  /**
   * The sponsor's contact address, for the handoff panel only.
   *
   * This crosses a boundary that was closed deliberately: v_sponsors_public omits
   * contact_email, and its COMMENT ON VIEW names that as P0-4 — a coach must not be able to
   * enumerate sponsor contacts by browsing. So rather than loosen the view (house rule 9),
   * the crossing is done here through the admin client, scoped to the single sponsor this
   * coach's own approved submission is already tied to, selecting the one column. A coach
   * with no match gets nothing, which is the pre-existing behaviour.
   */
  let sponsorContactEmail: string | null = null
  if (isMatched && submission.sponsor_id) {
    const { data: contact } = await createAdminClient()
      .from('sponsors')
      .select('contact_email')
      .eq('id', submission.sponsor_id)
      .maybeSingle()
    sponsorContactEmail = contact?.contact_email ?? null
  }

  // Read through the RLS-respecting server client: sm_select_coach already hides other
  // people's pending drafts and other coaches' threads, so there is nothing to re-filter
  // in TS. The coach DOES see their own pending/rejected rows — that is deliberate, so
  // "awaiting review" and a rejection reason are both visible to them.
  const { data: threadRows } = await supabase
    .from('submission_messages')
    .select('id, author_role, author_label, body, status, created_at, rejected_reason, flagged_at')
    .eq('submission_id', id)
    .order('created_at', { ascending: true })

  const messages = (threadRows ?? []) as ThreadMessage[]
  const hasSponsorMessage = messages.some((m) => m.author_role === 'sponsor')
  const threadLive =
    isAwaitingSponsor(submission.status) &&
    (!submission.expires_at || new Date(submission.expires_at) > new Date())

  return (
    <div className="container mx-auto max-w-3xl space-y-6 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{sponsorName}</h1>
          <p className="text-sm text-muted-foreground">
            {(amountCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} pitch
          </p>
        </div>
        <StatusBadge status={submission.status} />
      </div>

      {isMatched && (
        <MatchHandoffPanel
          viewer="coach"
          counterpartyName={sponsorName}
          counterpartyEmail={sponsorContactEmail}
          amountCents={amountCents}
          askedForCents={submission.requested_amount_cents}
          teamName={team.team_name}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pitch</CardTitle>
        </CardHeader>
        <CardContent>
          {isEditable ? (
            <Link href={`/submissions/${id}/edit`} className={cn(buttonVariants())}>
              Edit pitch
            </Link>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                This pitch is no longer editable in its current status.
              </p>
              {/* B-03-12. While the sponsor still has it, the coach can pull it back —
                  which is also the only way to free the capacity it reserves before the
                  14-day expiry. */}
              {isAwaitingSponsor(submission.status) && (
                <WithdrawPitchButton submissionId={id} sponsorName={sponsorName} />
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <CoachThreadPanel
        submissionId={id}
        messages={messages}
        canCompose={threadLive}
        hasSponsorMessage={hasSponsorMessage}
        sponsorName={sponsorName}
        closedNotice={
          threadLive
            ? undefined
            : 'This pitch is no longer awaiting a sponsor decision, so the thread is read-only.'
        }
      />
    </div>
  )
}
