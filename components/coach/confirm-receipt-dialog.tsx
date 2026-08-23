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
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { confirmPaymentReceived } from '@/app/actions/fulfillment'
import { LIMITS } from '@/lib/schemas/limits'
import Link from 'next/link'

export function ConfirmReceiptDialog({ 
  fulfillmentId, 
  children,
  isVerified,
}: { 
  fulfillmentId: string
  children?: React.ReactNode
  isVerified: boolean
}) {
  const today = new Date().toISOString().split('T')[0]
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  
  const [receivedOn, setReceivedOn] = useState<string>(today)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [needsVerification, setNeedsVerification] = useState(false)

  function onSubmit() {
    setError(null)
    setNeedsVerification(false)
    startTransition(async () => {
      const res = await confirmPaymentReceived({
        fulfillmentId,
        receivedOn: receivedOn || undefined,
        note: note.trim() || undefined,
      })
      
      if (res.error) {
        if (res.code === 'NEEDS_VERIFICATION') {
          setNeedsVerification(true)
        } else {
          setError(res.error)
        }
      } else if (res.warning) {
        // The confirmation itself succeeded, but issuing the tax receipt did not. This
        // branch used to be missing entirely, so a failure here showed the coach a green
        // success toast and vanished — which is how B-03-01 stayed invisible in production.
        toast.warning('Payment confirmed, but the receipt could not be issued', {
          description: res.warning,
          duration: 10000,
        })
        setOpen(false)
        router.refresh()
      } else {
        toast.success('Payment confirmed')
        setOpen(false)
        router.refresh()
      }
    })
  }

  if (!isVerified || needsVerification) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={children ? undefined : <Button size="sm">Confirm Receipt</Button>}>
          {children}
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Verification Required</DialogTitle>
            <DialogDescription>
              You must verify your adult identity before confirming the receipt of funds.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              To comply with COPPA, adult identity verification is required before confirming funds.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button asChild>
              <Link href="/awaiting-verification">Go to Verification</Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }
  
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={children ? undefined : <Button size="sm">Confirm Receipt</Button>}>
        {children}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Confirm Payment Received</DialogTitle>
          <DialogDescription>
            Let the sponsor know you've received the funds. This completes the transaction.
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid gap-4 py-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          
          <div className="space-y-2">
            {/* A-08-03: <Label> with no htmlFor is a visual label only — a screen reader
                announces the field as an unnamed date input. Visual proximity is not an
                association. */}
            <Label htmlFor="receipt-date-received">Date Received</Label>
            <Input 
              id="receipt-date-received"
              type="date"
              max={today}
              value={receivedOn}
              onChange={e => setReceivedOn(e.target.value)}
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="receipt-note">Note (Optional)</Label>
            <Textarea 
              id="receipt-note"
              value={note}
              onChange={e => setNote(e.target.value)}
              maxLength={LIMITS.fulfillmentNote}
              placeholder="Send a quick thank you to the sponsor..."
            />
          </div>
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>Cancel</Button>
          <Button onClick={onSubmit} disabled={isPending || !receivedOn}>
            {isPending ? 'Saving...' : 'Confirm Receipt'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
