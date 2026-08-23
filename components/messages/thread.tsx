'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { AlertTriangle, Clock, Flag, ShieldCheck } from 'lucide-react'

export type ThreadMessage = {
  id: string
  author_role: 'coach' | 'sponsor' | string
  author_label: string
  body: string
  status: string
  created_at: string
  rejected_reason?: string | null
  flagged_at?: string | null
}

export type ThreadViewerRole = 'coach' | 'sponsor' | 'admin'

/**
 * One component, three consumers: the coach detail page, the sponsor review console, and
 * the tokenized /sponsor-view page.
 *
 * `composerWarning` is the standing COPPA notice above the coach composer. It is passed in
 * rather than hardcoded because only the coach direction needs it — and it is deliberately
 * NOT dismissible. A warning that can be turned off is not a control.
 */
export function MessageThread({
  messages,
  viewerRole,
  canCompose,
  composerWarning,
  closedNotice,
  onSubmit,
  onReport,
  emptyState,
  title = 'Questions & answers',
  description,
}: {
  messages: ThreadMessage[]
  viewerRole: ThreadViewerRole
  canCompose: boolean
  composerWarning?: React.ReactNode
  closedNotice?: string
  onSubmit?: (body: string) => Promise<{ error?: string; success?: boolean; pending?: boolean }>
  onReport?: (messageId: string, reason: string) => Promise<{ error?: string; success?: boolean }>
  emptyState?: string
  title?: string
  description?: string
}) {
  const [body, setBody] = useState('')
  const [reportingId, setReportingId] = useState<string | null>(null)
  const [reportReason, setReportReason] = useState('')
  const [isPending, startTransition] = useTransition()

  function submit() {
    const trimmed = body.trim()
    if (!trimmed || !onSubmit) return
    startTransition(async () => {
      const result = await onSubmit(trimmed)
      if (result?.error) {
        toast.error(result.error)
        return
      }
      setBody('')
      toast.success(
        result?.pending
          ? 'Sent for review. Our team reads every reply before the sponsor sees it.'
          : 'Message sent.'
      )
    })
  }

  function submitReport(messageId: string) {
    const trimmed = reportReason.trim()
    if (!trimmed || !onReport) return
    startTransition(async () => {
      const result = await onReport(messageId, trimmed)
      if (result?.error) {
        toast.error(result.error)
        return
      }
      setReportingId(null)
      setReportReason('')
      toast.success('Reported. Our team will review this message.')
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {emptyState ?? 'No questions yet.'}
          </p>
        ) : (
          <ol className="flex flex-col gap-3">
            {messages.map((m) => {
              const mine =
                (viewerRole === 'coach' && m.author_role === 'coach') ||
                (viewerRole === 'sponsor' && m.author_role === 'sponsor')
              const held = m.status === 'pending'
              const rejected = m.status === 'rejected'

              return (
                <li
                  key={m.id}
                  className={cn(
                    'flex flex-col gap-1.5',
                    mine ? 'items-end' : 'items-start'
                  )}
                >
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{m.author_label}</span>
                    <span>{new Date(m.created_at).toLocaleString()}</span>
                  </div>

                  <div
                    className={cn(
                      'max-w-[42rem] rounded-lg border px-3.5 py-2.5 text-sm whitespace-pre-wrap',
                      mine ? 'bg-accent/60' : 'bg-card',
                      (held || rejected) && 'opacity-70 border-dashed'
                    )}
                  >
                    {m.body}
                  </div>

                  {held && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
                      <Clock className="size-3" aria-hidden />
                      Awaiting admin review
                    </span>
                  )}

                  {rejected && (
                    <div className="max-w-[42rem] rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive-text">
                      <span className="inline-flex items-center gap-1.5 font-semibold">
                        <AlertTriangle className="size-3" aria-hidden />
                        Not sent to the sponsor
                      </span>
                      {m.rejected_reason && <p className="mt-1">{m.rejected_reason}</p>}
                      <p className="mt-1 opacity-80">You can rewrite this and send it again.</p>
                    </div>
                  )}

                  {/* Reporting exists only on the un-moderated direction: sponsor -> coach. */}
                  {onReport && viewerRole === 'coach' && m.author_role === 'sponsor' && (
                    m.flagged_at ? (
                      <span className="text-xs text-muted-foreground">Reported — under review</span>
                    ) : reportingId === m.id ? (
                      <div className="flex w-full max-w-[42rem] flex-col gap-2">
                        <Textarea
                          value={reportReason}
                          onChange={(e) => setReportReason(e.target.value)}
                          rows={2}
                          placeholder="What is wrong with this message? (e.g. it asks for student details)"
                          aria-label="Reason for reporting this message"
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={isPending || reportReason.trim().length < 10}
                            onClick={() => submitReport(m.id)}
                          >
                            Report message
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={isPending}
                            onClick={() => {
                              setReportingId(null)
                              setReportReason('')
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                        onClick={() => setReportingId(m.id)}
                      >
                        <Flag className="size-3" aria-hidden />
                        Report this message
                      </button>
                    )
                  )}
                </li>
              )
            })}
          </ol>
        )}

        {canCompose && onSubmit ? (
          <div className="flex flex-col gap-2 border-t pt-4">
            {composerWarning}
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              maxLength={2000}
              placeholder={
                viewerRole === 'sponsor'
                  ? 'Ask the coach a question about this proposal…'
                  : 'Write your reply…'
              }
              aria-label="Message"
            />
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">
                {viewerRole === 'coach'
                  ? 'Replies are read by our team before the sponsor sees them.'
                  : 'Plain text only. The coach sees this immediately.'}
              </span>
              <Button
                size="sm"
                disabled={isPending || body.trim().length < 5}
                onClick={submit}
              >
                {viewerRole === 'coach' ? 'Send for review' : 'Send question'}
              </Button>
            </div>
          </div>
        ) : closedNotice ? (
          <p className="border-t pt-4 text-sm text-muted-foreground">{closedNotice}</p>
        ) : null}
      </CardContent>
    </Card>
  )
}

/**
 * The standing, non-dismissible COPPA notice above the coach composer. Exported so every
 * coach-facing consumer renders the identical wording.
 */
export function CoachComposerWarning() {
  return (
    <div className="flex gap-2.5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
      <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div>
        <p className="font-semibold">Never include student information.</p>
        <p className="mt-0.5">
          No student names, photos, ages, or schedule details that could identify a minor —
          not even initials. Our team reads every reply before the sponsor sees it, and a
          reply that includes any of these will be rejected.
        </p>
      </div>
    </div>
  )
}
