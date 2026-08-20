'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { releaseCoachReply, rejectCoachReply } from '@/app/actions/messages'
import { ShieldCheck, Flag } from 'lucide-react'

export type PendingCoachReply = {
  id: string
  body: string
  author_label: string
  created_at: string
  submission_id: string
  team_name: string
  company_name: string
  /** The most recent sponsor message on the same thread, for context. */
  question_body: string | null
  question_label: string | null
}

export type FlaggedSponsorMessage = {
  id: string
  body: string
  author_label: string
  created_at: string
  flagged_at: string
  submission_id: string
  team_name: string
  company_name: string
}

/**
 * The COPPA checklist rendered BESIDE every message body, not behind a tooltip.
 *
 * This human read is the actual control on student PII — there is deliberately no
 * classifier upstream of it, precisely so this review cannot decay into rubber-stamping
 * whatever a machine passed.
 */
function CoppaChecklist() {
  return (
    <div className="flex gap-2.5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
      <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div>
        <p className="font-semibold">Before releasing, confirm the reply has:</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          <li>no student names or initials</li>
          <li>no student photos or links to them</li>
          <li>no ages, grades, or school schedules</li>
          <li>no detail that could identify a specific minor</li>
        </ul>
      </div>
    </div>
  )
}

export function MessageReviewQueue({
  pending,
  flagged,
}: {
  pending: PendingCoachReply[]
  flagged: FlaggedSponsorMessage[]
}) {
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold">Coach replies awaiting release</h2>
          <p className="text-sm text-muted-foreground">
            A coach reply is invisible to the sponsor until you release it. This is the same
            gate that applies to pitches, and the control that keeps student information off
            the wire.
          </p>
        </div>

        {pending.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No replies waiting. Nothing to review.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {pending.map((m) => (
              <PendingRow key={m.id} message={m} />
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold">Reported messages</h2>
          <p className="text-sm text-muted-foreground">
            Sponsor messages a coach flagged. The sponsor direction is not pre-moderated, so
            this is how a sponsor asking for student details reaches a human.
          </p>
        </div>

        {flagged.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            Nothing reported. That is the good state.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {flagged.map((m) => (
              <Card key={m.id} className="border-destructive/40">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Flag className="size-3.5 text-destructive" aria-hidden />
                    {m.company_name} → {m.team_name}
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  <p className="whitespace-pre-wrap rounded-lg border bg-muted/40 p-3 text-sm">
                    {m.body}
                  </p>
                  <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span>
                      {m.author_label} · reported {new Date(m.flagged_at).toLocaleString()}
                    </span>
                    <Link
                      href={`/submissions?submission=${m.submission_id}`}
                      className="underline underline-offset-2"
                    >
                      View submission
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function PendingRow({ message }: { message: PendingCoachReply }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showReject, setShowReject] = useState(false)
  const [reason, setReason] = useState('')

  function release() {
    startTransition(async () => {
      const result = await releaseCoachReply({ messageId: message.id })
      if (result?.error) {
        toast.error(result.error)
        return
      }
      toast.success('Released. The sponsor has been notified.')
      router.refresh()
    })
  }

  function reject() {
    const trimmed = reason.trim()
    if (trimmed.length < 10) {
      toast.error('Give the coach a reason of at least 10 characters.')
      return
    }
    startTransition(async () => {
      const result = await rejectCoachReply({ messageId: message.id, reason: trimmed })
      if (result?.error) {
        toast.error(result.error)
        return
      }
      toast.success('Rejected. The coach has the reason and can rewrite.')
      setShowReject(false)
      setReason('')
      router.refresh()
    })
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">
          {message.team_name} → {message.company_name}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-[1fr_18rem]">
        <div className="flex flex-col gap-3">
          {message.question_body && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {message.question_label ?? 'Sponsor'} asked
              </p>
              <p className="mt-1 whitespace-pre-wrap rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
                {message.question_body}
              </p>
            </div>
          )}

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {message.author_label} wants to reply
            </p>
            <p className="mt-1 whitespace-pre-wrap rounded-lg border p-3 text-sm">
              {message.body}
            </p>
          </div>

          {showReject && (
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Why is this not being sent? The coach sees this verbatim."
              aria-label="Rejection reason"
            />
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={isPending} onClick={release}>
              Release to sponsor
            </Button>
            {showReject ? (
              <>
                <Button size="sm" variant="destructive" disabled={isPending} onClick={reject}>
                  Confirm rejection
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => {
                    setShowReject(false)
                    setReason('')
                  }}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={() => setShowReject(true)}
              >
                Reject with a reason
              </Button>
            )}
            <span className="text-xs text-muted-foreground">
              {new Date(message.created_at).toLocaleString()}
            </span>
          </div>
        </div>

        <CoppaChecklist />
      </CardContent>
    </Card>
  )
}
