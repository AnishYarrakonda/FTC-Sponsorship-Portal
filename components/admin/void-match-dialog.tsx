'use client'

import { useId, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button, buttonVariants } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { voidMatch } from '@/app/actions/void-match'

const MIN_REASON = 10

export function VoidMatchDialog({
  submissionId,
  teamName,
  sponsorName,
  amountCents,
}: {
  submissionId: string
  teamName: string
  sponsorName: string
  amountCents: number
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  const reasonId = useId()
  const hintId = `${reasonId}-hint`

  const amountDisplay = (amountCents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })

  const tooShort = reason.trim().length < MIN_REASON

  function handleVoid() {
    startTransition(async () => {
      const res = await voidMatch({ submissionId, reason })
      if (res.error) {
        toast.error(res.error)
        return
      }
      setOpen(false)
      setReason('')
      toast.success(
        `Match voided. ${((res.releasedCents ?? 0) / 100).toLocaleString('en-US', {
          style: 'currency',
          currency: 'USD',
          maximumFractionDigits: 0,
        })} released back to ${sponsorName}'s capacity.`
      )
      router.refresh()
    })
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger className={buttonVariants({ variant: 'outline', size: 'sm' })}>
        Void match
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Void the {amountDisplay} match between {sponsorName} and {teamName}?
          </AlertDialogTitle>
          {/* Spelled out rather than summarised. An admin doing this is undoing something
              two other people were told had happened, and the money consequence is the
              part they are most likely to be wrong about. */}
          <AlertDialogDescription>
            {amountDisplay} is released back to {sponsorName}&apos;s funding capacity, and the pitch
            is marked withdrawn. Both the coach and {sponsorName} are notified, and your reason is
            included in that message. This does not move money &mdash;{' '}
            <strong>
              if {sponsorName} has already paid {teamName}, voiding here will not undo that
            </strong>
            , so sort the payment out with them first.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-2">
          <Label htmlFor={reasonId}>Reason</Label>
          <Textarea
            id={reasonId}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={500}
            aria-describedby={hintId}
            aria-invalid={reason.length > 0 && tooShort ? true : undefined}
            placeholder="e.g. Sponsor withdrew after a budget freeze; confirmed by email on 12 Aug."
          />
          {/* Persistent, not error-on-submit: the requirement is a fact about the field, and
              a rule that only appears after a failed attempt is one the user meets by luck. */}
          <p id={hintId} className="text-xs text-muted-foreground">
            At least {MIN_REASON} characters. This is written to the audit log and sent to both
            parties, so write it for them, not for yourself.
          </p>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <Button variant="destructive" onClick={handleVoid} disabled={isPending || tooShort}>
            {isPending ? 'Voiding…' : 'Void match'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
