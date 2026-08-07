'use client'

import { useState, useTransition } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { CardFooter } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ActionWarning } from '@/components/ui/action-warning'
import { CheckCircle2 } from 'lucide-react'
import { requestEdit, declineSubmission, approveSubmission } from '@/app/actions/moderation'

export function ModerationActions({ submissionId, onApproveClick }: { submissionId: string; onApproveClick?: () => void }) {
  const [editOpen, setEditOpen] = useState(false)
  const [declineOpen, setDeclineOpen] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  function flashSuccess(msg: string) {
    setSuccessMsg(msg)
    setTimeout(() => setSuccessMsg(null), 2500)
  }

  const handleRequestEdit = () => {
    setError(null)
    startTransition(async () => {
      const result = await requestEdit(submissionId, feedback)
      if (result?.error) {
        setError(result.error)
        return
      }
      setEditOpen(false)
      setFeedback('')
      setWarning(result?.warning ?? null)
      flashSuccess(
        result?.warning ? 'Changes requested.' : 'Changes requested — coach has been notified.'
      )
    })
  }

  const handleDecline = () => {
    setError(null)
    startTransition(async () => {
      const result = await declineSubmission(submissionId, feedback)
      if (result?.error) {
        setError(result.error)
        return
      }
      setDeclineOpen(false)
      setFeedback('')
      setWarning(result?.warning ?? null)
      flashSuccess('Submission declined.')
    })
  }

  const handleApprove = () => {
    if (onApproveClick) {
      onApproveClick()
      return
    }
    setError(null)
    startTransition(async () => {
      const result = await approveSubmission(submissionId)
      if (result?.error) {
        setError(result.error)
        return
      }
      // P0-11: `warning` means the approval COMMITTED and capacity is already reserved,
      // but the pitch email to the sponsor failed. Claiming "dispatched to sponsor!"
      // here is the exact lie that made this failure undetectable.
      setWarning(result?.warning ?? null)
      flashSuccess(result?.warning ? 'Approved — see the notice below.' : 'Approved & dispatched to sponsor!')
    })
  }

  return (
    <CardFooter className="flex flex-col gap-3 border-t pt-4">
      {error && (
        <Alert variant="destructive" className="w-full">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {warning && <ActionWarning>{warning}</ActionWarning>}
      {successMsg && (
        <div className="w-full flex items-center gap-2 rounded-md bg-emerald-500/10 border border-emerald-900/50 text-emerald-400 px-3 py-2 text-sm">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          {successMsg}
        </div>
      )}
      <div className="flex justify-end gap-3 w-full">
        <Dialog open={editOpen} onOpenChange={(open) => {
          setEditOpen(open)
          if (!open) setFeedback('')
        }}>
          <DialogTrigger render={<Button variant="outline" disabled={isPending} />}>
            Request Edit
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Request Edit</DialogTitle>
              <DialogDescription>
                Provide specific feedback to the team about what needs to be changed before approval.
              </DialogDescription>
            </DialogHeader>
            <Textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Please clarify the line items and provide more detail."
              className="min-h-[100px]"
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditOpen(false)} disabled={isPending}>
                Cancel
              </Button>
              <Button onClick={handleRequestEdit} disabled={!feedback.trim() || isPending}>
                Submit Request
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={declineOpen} onOpenChange={(open) => {
          setDeclineOpen(open)
          if (!open) setFeedback('')
        }}>
          <DialogTrigger render={<Button variant="destructive" disabled={isPending} />}>
            Decline
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Decline Submission</DialogTitle>
              <DialogDescription>
                Provide reasoning for why this submission is being declined. The team will be able to see this feedback.
              </DialogDescription>
            </DialogHeader>
            <Textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Does not meet sponsorship criteria at this time."
              className="min-h-[100px]"
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeclineOpen(false)} disabled={isPending}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleDecline} disabled={!feedback.trim() || isPending}>
                Confirm Decline
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Button variant="default" onClick={handleApprove} disabled={isPending}>
          {isPending ? 'Processing...' : 'Approve & Dispatch to Sponsor'}
        </Button>
      </div>
    </CardFooter>
  )
}
