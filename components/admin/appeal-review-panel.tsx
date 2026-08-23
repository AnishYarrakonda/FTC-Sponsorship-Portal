'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { assignAppeal, resolveAppeal } from '@/app/actions/appeals'
import { AlertTriangle, Gavel } from 'lucide-react'

export type AdminAppeal = {
  id: string
  subject_type: string
  subject_id: string
  status: string
  statement: string
  created_at: string
  decision_at: string
  original_decider_id: string | null
  original_decider_name: string | null
  assigned_reviewer_id: string | null
  assigned_reviewer_name: string | null
  resolution_notes: string | null
  resolved_at: string | null
  appellant_name: string | null
  /** The admin's own reason for the original decision, so it can be re-read in context. */
  original_reason: string | null
  subject_label: string
}

function ageDays(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

/**
 * Age, not expiry. An appeal already open when the 30-day filing window closes stays open
 * until a human resolves it — an unresolved appeal is the platform's failure, not the
 * coach's. Visibility is the pressure.
 */
function AgeBadge({ createdAt }: { createdAt: string }) {
  const days = ageDays(createdAt)
  const tone =
    days >= 14
      ? 'border-red-300 bg-red-50 text-red-900 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300'
      : days >= 7
        ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200'
        : 'border-border bg-muted text-muted-foreground'
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums ${tone}`}>
      {days === 0 ? 'today' : `${days}d old`}
    </span>
  )
}

export function AppealReviewPanel({
  appeals,
  currentAdminId,
  isSuperAdmin,
}: {
  appeals: AdminAppeal[]
  currentAdminId: string
  isSuperAdmin: boolean
}) {
  if (appeals.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        No open appeals. Nothing to review.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {appeals.map((a) => (
        <AppealRow key={a.id} appeal={a} currentAdminId={currentAdminId} isSuperAdmin={isSuperAdmin} />
      ))}
    </div>
  )
}

function AppealRow({
  appeal,
  currentAdminId,
  isSuperAdmin,
}: {
  appeal: AdminAppeal
  currentAdminId: string
  isSuperAdmin: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [overrideReason, setOverrideReason] = useState('')
  const [showOverride, setShowOverride] = useState(false)
  const [notes, setNotes] = useState('')
  const [outcome, setOutcome] = useState<'upheld' | 'overturned' | null>(null)

  const iMadeThisDecision = !!appeal.original_decider_id && appeal.original_decider_id === currentAdminId
  const isOpen = appeal.status === 'open'
  const isUnderReview = appeal.status === 'under_review'

  function assignToMe(reason?: string) {
    startTransition(async () => {
      const result = await assignAppeal({
        appealId: appeal.id,
        reviewerId: currentAdminId,
        ...(reason ? { overrideReason: reason } : {}),
      })
      if (result?.requiresOverride) {
        setShowOverride(true)
        toast.warning(result.warning ?? 'A written reason is required.')
        return
      }
      if (result?.error) {
        toast.error(result.error)
        return
      }
      toast.success('Assigned to you.')
      setShowOverride(false)
      setOverrideReason('')
      router.refresh()
    })
  }

  function resolve() {
    if (!outcome) return
    startTransition(async () => {
      const result = await resolveAppeal({ appealId: appeal.id, outcome, resolutionNotes: notes.trim() })
      if (result?.error) {
        toast.error(result.error)
        return
      }
      toast.success(outcome === 'overturned' ? 'Overturned. The coach has been notified.' : 'Upheld. The coach has been notified.')
      setNotes('')
      setOutcome(null)
      router.refresh()
    })
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm">
            {appeal.appellant_name ?? 'A coach'} · {appeal.subject_label}
          </CardTitle>
          <div className="flex items-center gap-2">
            <AgeBadge createdAt={appeal.created_at} />
            {appeal.assigned_reviewer_name && (
              <span className="text-xs text-muted-foreground">
                with {appeal.assigned_reviewer_name}
              </span>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {appeal.original_reason && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Original decision{appeal.original_decider_name ? ` — ${appeal.original_decider_name}` : ''}
            </p>
            <p className="mt-1 whitespace-pre-wrap rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
              {appeal.original_reason}
            </p>
          </div>
        )}

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            The coach&apos;s appeal
          </p>
          <p className="mt-1 whitespace-pre-wrap rounded-lg border p-3 text-sm">{appeal.statement}</p>
        </div>

        {/* The soft different-reviewer rule, surfaced rather than enforced by a dead button. */}
        {isOpen && iMadeThisDecision && (
          <div className="flex gap-2.5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div>
              <p className="font-semibold">You made this decision.</p>
              <p className="mt-0.5">
                {isSuperAdmin
                  ? 'Assign another admin, or record a written reason to review it yourself.'
                  : 'A super admin must approve a self-review. Assign another admin instead.'}
              </p>
            </div>
          </div>
        )}

        {isOpen && (
          <div className="flex flex-col gap-2">
            {showOverride && iMadeThisDecision && isSuperAdmin && (
              <>
                <Textarea
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  rows={2}
                  placeholder="Why are you reviewing your own decision? This is recorded in the audit log."
                  aria-label="Self-review reason"
                />
                <span className="text-xs tabular-nums text-muted-foreground">
                  {overrideReason.trim().length} / 20 minimum
                </span>
              </>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={
                  isPending ||
                  (showOverride && iMadeThisDecision && (!isSuperAdmin || overrideReason.trim().length < 20))
                }
                onClick={() => assignToMe(showOverride ? overrideReason.trim() : undefined)}
              >
                <Gavel className="mr-1.5 size-3.5" aria-hidden />
                {showOverride ? 'Record reason and take it' : 'Take this appeal'}
              </Button>
            </div>
          </div>
        )}

        {isUnderReview && (
          <div className="flex flex-col gap-2">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Explain the outcome. The coach sees this verbatim."
              aria-label="Resolution notes"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={outcome === 'overturned' ? 'default' : 'outline'}
                disabled={isPending}
                onClick={() => setOutcome('overturned')}
              >
                Overturn
              </Button>
              <Button
                size="sm"
                variant={outcome === 'upheld' ? 'default' : 'outline'}
                disabled={isPending}
                onClick={() => setOutcome('upheld')}
              >
                Uphold
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={isPending || !outcome || notes.trim().length < 20}
                onClick={resolve}
              >
                {/* P3: rendered "Confirm overturned" — the enum is a state, not a verb. */}
                {outcome === 'overturned'
                  ? 'Confirm overturn'
                  : outcome === 'upheld'
                    ? 'Confirm upholding the decision'
                    : 'Confirm decision'}
              </Button>
              <span className="text-xs tabular-nums text-muted-foreground">
                {notes.trim().length} / 20 minimum
              </span>
            </div>
            {outcome === 'overturned' && (
              <p className="text-xs text-muted-foreground">
                {appeal.subject_type === 'submission'
                  ? 'The pitch returns to “changes requested” so the coach can edit and resubmit. Nothing is re-sent to the sponsor, and no sponsor capacity moves.'
                  : appeal.subject_type === 'team_verification'
                    ? 'Your notes become the override reason on the verification record, the team number is manually confirmed, and an incubator team provisioned by the rejection is reinstated.'
                    : 'The denial is cleared and the coach can upload their ID again. This does NOT mark them verified — the original document was deleted at denial.'}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
