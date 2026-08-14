'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { LIMITS } from '@/lib/schemas/limits'
import { createAppeal } from '@/app/actions/appeals'
import type { AppealableSubject } from '@/lib/schemas/appeal'
import { Scale } from 'lucide-react'

const STATUS_COPY: Record<string, { label: string; className: string }> = {
  open: { label: 'Awaiting review', className: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200' },
  under_review: { label: 'Under review', className: 'border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-200' },
  upheld: { label: 'Decision stands', className: 'border-border bg-muted text-muted-foreground' },
  overturned: { label: 'Appeal successful', className: 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200' },
  withdrawn: { label: 'Withdrawn', className: 'border-border bg-muted text-muted-foreground' },
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

/**
 * The coach's appeal entry point. Renders one of four states, all of them explicit:
 * already filed, window closed, eligible, or (via the parent) nothing to appeal.
 *
 * The deadline is shown BEFORE it passes — a coach should never discover the window closed
 * by having a submit button fail.
 */
export function AppealForm({ subject }: { subject: AppealableSubject }) {
  const router = useRouter()
  const [statement, setStatement] = useState('')
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  if (subject.existingAppeal) {
    const copy = STATUS_COPY[subject.existingAppeal.status] ?? STATUS_COPY.open
    return (
      <div className="rounded-xl border border-border bg-background/60 p-4 text-left space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Your appeal
          </p>
          <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${copy.className}`}>
            {copy.label}
          </span>
        </div>
        <Link
          href={`/appeals/${subject.existingAppeal.id}`}
          className="text-sm text-primary underline underline-offset-2"
        >
          View your appeal →
        </Link>
      </div>
    )
  }

  if (!subject.windowOpen) {
    return (
      <div className="rounded-xl border border-border bg-background/60 p-4 text-left">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Appeal</p>
        <p className="mt-1 text-sm text-muted-foreground">
          The 30-day window to appeal this decision closed on {formatDate(subject.deadline)}.
        </p>
      </div>
    )
  }

  function submit() {
    startTransition(async () => {
      const result = await createAppeal({
        subjectType: subject.subjectType,
        subjectId: subject.subjectId,
        statement: statement.trim(),
      })
      if (result?.error) {
        toast.error(result.error)
        return
      }
      toast.success('Appeal filed. An administrator will review it.')
      setStatement('')
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <div className="rounded-xl border border-border bg-background/60 p-4 text-left space-y-3">
      <div className="flex items-start gap-2.5">
        <Scale className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Appeal this decision
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            If you believe this decision was wrong, a different administrator will re-read it.
            You have until <span className="font-medium text-foreground">{formatDate(subject.deadline)}</span>.
          </p>
        </div>
      </div>

      {open ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Explain what you think was missed. An appeal is a second read of the same decision —
            it is not a place to submit new material, and it does not send anything to a sponsor.
          </p>
          <Textarea
            value={statement}
            onChange={(e) => setStatement(e.target.value)}
            rows={6}
            maxLength={LIMITS.appealStatement}
            placeholder="Why should this decision be reconsidered?"
            aria-label="Your appeal"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs tabular-nums text-muted-foreground">
              {statement.trim().length} / {LIMITS.appealStatement} · 50 minimum
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" disabled={isPending} onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" disabled={isPending || statement.trim().length < 50} onClick={submit}>
                File appeal
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          Appeal this decision
        </Button>
      )}
    </div>
  )
}
