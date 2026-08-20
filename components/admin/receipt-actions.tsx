'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
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
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  issueReceiptForFulfillment,
  voidReceipt,
  reissueReceipt,
  resendReceiptEmail,
} from '@/app/actions/receipt'
import { LIMITS } from '@/lib/schemas/limits'
import { Ban, RefreshCw, Send, FileCheck } from 'lucide-react'

export function IssueReceiptButton({ fulfillmentId }: { fulfillmentId: string }) {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function onClick() {
    startTransition(async () => {
      const res = await issueReceiptForFulfillment({ fulfillmentId })
      if (res.error) {
        toast.error(res.error)
      } else {
        toast.success(`Receipt ${res.receiptNumber || ''} issued successfully`)
        router.refresh()
      }
    })
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={isPending}
      className="flex items-center gap-1.5 text-xs"
    >
      <FileCheck className="h-3.5 w-3.5" />
      {isPending ? 'Issuing...' : 'Issue Receipt'}
    </Button>
  )
}

export function VoidReceiptDialog({
  receiptId,
  receiptNumber,
}: {
  receiptId: string
  receiptNumber: string
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const isValid = reason.trim().length >= 10

  function onSubmit() {
    if (!isValid) return
    setError(null)
    startTransition(async () => {
      const res = await voidReceipt({ receiptId, reason: reason.trim() })
      if (res.error) {
        setError(res.error)
      } else {
        toast.success(`Receipt ${receiptNumber} voided`)
        setOpen(false)
        router.refresh()
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" className="flex items-center gap-1.5 text-xs text-destructive hover:text-destructive">
            <Ban className="h-3.5 w-3.5" />
            Void
          </Button>
        }
      />
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Void Receipt {receiptNumber}</DialogTitle>
          <DialogDescription>
            Voiding a receipt invalidates it for tax deduction purposes. The document is preserved for legal auditing and both counterparties will be notified.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-3">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label>Reason for Void (Required, min 10 chars)</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={LIMITS.fulfillmentNote}
              placeholder="e.g. Payee legal name was listed incorrectly; reissuing under updated payout profile."
            />
            {reason.length > 0 && !isValid && (
              <p className="text-xs text-destructive">
                Reason must be at least 10 characters ({reason.trim().length}/10).
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onSubmit} disabled={isPending || !isValid}>
            {isPending ? 'Voiding...' : 'Void Receipt'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ReissueReceiptDialog({
  receiptId,
  receiptNumber,
}: {
  receiptId: string
  receiptNumber: string
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const isValid = reason.trim().length >= 10

  function onSubmit() {
    if (!isValid) return
    setError(null)
    startTransition(async () => {
      const res = await reissueReceipt({ receiptId, reason: reason.trim() })
      if (res.error) {
        setError(res.error)
      } else {
        toast.success(`Receipt reissued: ${res.receiptNumber || ''}`)
        setOpen(false)
        router.refresh()
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" className="flex items-center gap-1.5 text-xs">
            <RefreshCw className="h-3.5 w-3.5" />
            Reissue
          </Button>
        }
      />
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Reissue Receipt {receiptNumber}</DialogTitle>
          <DialogDescription>
            Void the current receipt and issue a new replacement receipt using the team&apos;s latest payout profile.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-3">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label>Reason for Reissue (Required, min 10 chars)</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={LIMITS.fulfillmentNote}
              placeholder="e.g. Updated payee legal name and W-9 verification completed."
            />
            {reason.length > 0 && !isValid && (
              <p className="text-xs text-destructive">
                Reason must be at least 10 characters ({reason.trim().length}/10).
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={isPending || !isValid}>
            {isPending ? 'Reissuing...' : 'Reissue Receipt'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ResendReceiptEmailButton({ receiptId }: { receiptId: string }) {
  const [isPending, startTransition] = useTransition()

  function onClick() {
    startTransition(async () => {
      const res = await resendReceiptEmail({ receiptId })
      if (res.error) {
        toast.error(res.error)
      } else {
        toast.success('Receipt email resent to sponsor.')
      }
    })
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={isPending}
      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
    >
      <Send className="h-3.5 w-3.5" />
      {isPending ? 'Sending...' : 'Resend Email'}
    </Button>
  )
}
