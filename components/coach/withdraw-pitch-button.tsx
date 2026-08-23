'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { withdrawSubmission } from '@/app/actions/submission'
import { LIMITS } from '@/lib/schemas/limits'

/**
 * B-03-12. The only coach-facing exit from a dispatched pitch.
 *
 * Deliberately behind a confirm dialog with a stated consequence: withdrawing is visible to
 * the sponsor and the pitch has to be resubmitted through moderation afterwards, so it is
 * not a control to click by accident from a list view.
 */
export function WithdrawPitchButton({
  submissionId,
  sponsorName,
}: {
  submissionId: string
  sponsorName: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [isPending, startTransition] = useTransition()

  function handleWithdraw() {
    startTransition(async () => {
      const result = await withdrawSubmission(submissionId, reason.trim() || undefined)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Pitch withdrawn')
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* base-ui composes through `render`, not Radix's `asChild`. */}
      <DialogTrigger render={<Button variant="outline" className="gap-2" />}>
        <Undo2 className="h-4 w-4" aria-hidden="true" />
        Withdraw pitch
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Withdraw this pitch?</DialogTitle>
          <DialogDescription>
            {sponsorName} will be told you have withdrawn it, and the amount you reserved
            against their budget is released immediately. You can edit the pitch and submit
            it again — it will go back through admin review first.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="withdraw-reason">Reason (optional, for your records)</Label>
          <Textarea
            id="withdraw-reason"
            value={reason}
            maxLength={LIMITS.feedback}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. wrong amount requested"
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
            Keep it active
          </Button>
          <Button variant="destructive" onClick={handleWithdraw} disabled={isPending}>
            {isPending ? 'Withdrawing…' : 'Withdraw pitch'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
