'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/status-badge'
import { EmptyState } from '@/components/ui/empty-state'
import { ActionWarning } from '@/components/ui/action-warning'
import { Send, CheckCircle2, Inbox } from 'lucide-react'
import { redispatchSubmission } from '@/app/actions/moderation'

export interface InFlightSubmission {
  id: string
  status: string
  sent_at: string | null
  expires_at: string | null
  resend_message_id: string | null
  reserved_amount_cents: number | null
  teams: { team_name: string | null; ftc_team_number: number | null } | null
  sponsors: { company_name: string | null } | null
}

function money(cents: number | null | undefined) {
  return `$${((cents ?? 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
}

function when(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * P0-11 / status-enum coverage.
 *
 * `dispatched`, `delivered` and `opened` are real statuses that NO admin or coach view
 * rendered — a live pitch simply fell out of the product once it left the review queue.
 * That is also why a failed dispatch was unrecoverable: there was no screen on which to
 * offer a retry, and re-approving is impossible because approve_submission_atomic
 * asserts status='pending'.
 *
 * Resending mints a fresh access token (0070) and revokes the previous unused one. It
 * moves no money: the reservation from the original approval is still live.
 */
export function InFlightSubmissions({ submissions }: { submissions: InFlightSubmission[] }) {
  const [isPending, startTransition] = useTransition()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [sent, setSent] = useState<Record<string, boolean>>({})

  function handleResend(id: string) {
    setBusyId(id)
    setErrors((e) => ({ ...e, [id]: '' }))
    startTransition(async () => {
      const res = await redispatchSubmission(id)
      if (res?.error) {
        setErrors((e) => ({ ...e, [id]: res.error as string }))
      } else {
        setSent((s) => ({ ...s, [id]: true }))
      }
      setBusyId(null)
    })
  }

  if (submissions.length === 0) {
    return (
      <EmptyState
        className="py-12"
        icon={Inbox}
        title="Nothing awaiting a sponsor"
        description="Approved pitches appear here until the sponsor decides, so you can confirm delivery or resend."
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {submissions.map((s) => {
        const teamLabel = s.teams?.ftc_team_number
          ? `Team ${s.teams.ftc_team_number} — ${s.teams?.team_name ?? 'Unnamed'}`
          : (s.teams?.team_name ?? 'Unnamed team')

        return (
          <Card key={s.id}>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">{teamLabel}</CardTitle>
                  <CardDescription>
                    to {s.sponsors?.company_name ?? 'Unknown sponsor'} · {money(s.reserved_amount_cents)} reserved
                  </CardDescription>
                </div>
                <StatusBadge status={s.status} />
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-muted-foreground text-xs">Sent</dt>
                  <dd>{when(s.sent_at)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Link expires</dt>
                  <dd>{when(s.expires_at)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Email accepted by Resend</dt>
                  <dd>{s.resend_message_id ? 'Yes' : 'No'}</dd>
                </div>
              </dl>

              {/*
                No resend_message_id means the send never reached Resend at all, while the
                approval already reserved capacity and told the coach it was approved.
                This is the exact silent state P0-11 describes, so name it explicitly.
              */}
              {!s.resend_message_id && !sent[s.id] && (
                <ActionWarning>
                  This pitch reserved {money(s.reserved_amount_cents)} of the sponsor&apos;s capacity, but no
                  outbound email was ever accepted by the mail provider — the sponsor has most likely
                  never seen it. Resend to deliver a fresh secure link.
                </ActionWarning>
              )}

              {errors[s.id] && (
                <p className="text-sm text-destructive">{errors[s.id]}</p>
              )}

              {sent[s.id] ? (
                <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" strokeWidth={1.5} />
                  Resent — a new secure link is on its way and the previous one has been revoked.
                </p>
              ) : (
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleResend(s.id)}
                    disabled={isPending && busyId === s.id}
                  >
                    <Send className="mr-2 h-4 w-4" strokeWidth={1.5} />
                    {isPending && busyId === s.id ? 'Resending…' : 'Resend to sponsor'}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
