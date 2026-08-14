'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { confirmPortfolioMediaNoMinors } from '@/app/actions/impact'

/**
 * The portfolio-photo affirmation that gates media_urls into CSR impact reports.
 *
 * Fail closed: unaffirmed photos appear in no report. A database trigger clears the
 * affirmation whenever media_urls changes, so this control can drift out of sync with the
 * server after an upload — which is correct, and the copy says so rather than pretending
 * the checkbox is sticky.
 *
 * Be honest about the control: it is a human affirmation plus admin review. We do not
 * screen images automatically and must not imply that we do.
 */
export function MediaAffirmation({
  teamId,
  confirmedAt,
}: {
  teamId: string
  confirmedAt: string | null
}) {
  const [confirmed, setConfirmed] = useState(!!confirmedAt)
  const [pending, startTransition] = useTransition()

  const toggle = (next: boolean) => {
    setConfirmed(next)
    startTransition(async () => {
      const res = await confirmPortfolioMediaNoMinors({ teamId, confirmed: next })
      if (res.error) {
        setConfirmed(!next)
        toast.error(res.error)
      } else {
        toast.success(
          next ? 'Photos may now appear in sponsor impact reports.' : 'Photos excluded from reports.'
        )
      }
    })
  }

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={confirmed}
          disabled={pending}
          onChange={(e) => toggle(e.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 rounded border-border"
        />
        <span>
          I confirm these photos show robots, workspaces, signage or events — no identifiable
          students. Photos without this confirmation are excluded from sponsor impact reports.
        </span>
      </label>
      <p className="mt-2 text-xs text-muted-foreground">
        Changing your photos clears this confirmation, so re-confirm after any upload.
        Administrators review images and can remove them.
      </p>
    </div>
  )
}
