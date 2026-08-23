import Link from 'next/link'
import { getAuthedProfile } from '@/lib/actions-utils'
import { redirect, notFound } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { buttonVariants } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/status-badge'
import { AgreementStatusRow } from '@/components/agreements/agreement-status-row'
import { COACH_EDITABLE_STATUSES, isAwaitingSponsor } from '@/lib/submission-status'
import { WithdrawPitchButton } from '@/components/coach/withdraw-pitch-button'
import { CoachThreadPanel } from '@/components/messages/thread-panels'
import type { ThreadMessage } from '@/components/messages/thread'
import { cn } from '@/lib/utils'

// This route had no bare detail page before this slice — only /edit. It exists now as
// the natural home for the Agreement status row (a submission past the coach-editable
// statuses, e.g. `approved`, has nothing sensible to "edit" but still needs somewhere to
// show its agreement/fulfillment state and link to the sign or verification page).
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

      {await AgreementStatusRow({ supabase, submissionId: id, viewerRole: 'coach' })}

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
