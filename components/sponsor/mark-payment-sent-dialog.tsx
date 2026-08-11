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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { markPaymentSent } from '@/app/actions/fulfillment'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { LIMITS } from '@/lib/schemas/limits'

export function MarkPaymentSentDialog({ fulfillmentId, children }: { fulfillmentId: string, children?: React.ReactNode }) {
  const today = new Date().toISOString().split('T')[0]
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  
  const [method, setMethod] = useState<string>('')
  const [reference, setReference] = useState('')
  const [sentOn, setSentOn] = useState<string>(today)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  function onSubmit() {
    setError(null)
    startTransition(async () => {
      const res = await markPaymentSent({
        fulfillmentId,
        paymentMethod: method as 'check' | 'ach' | 'wire' | 'other',
        paymentReference: reference.trim() || undefined,
        sentOn: sentOn || undefined,
        note: note.trim() || undefined,
      })
      
      if (res.error) {
        setError(res.error)
      } else {
        toast.success('Payment marked as sent')
        setOpen(false)
        router.refresh()
      }
    })
  }
  
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={children ? undefined : <Button size="sm">Mark Payment Sent</Button>}>
        {children}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Mark Payment Sent</DialogTitle>
          <DialogDescription>
            Let the team know you've sent the funds so they can watch for it.
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid gap-4 py-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          
          <div className="space-y-3">
            <Label>Payment Method</Label>
            <RadioGroup value={method} onValueChange={setMethod} className="flex gap-4">
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="check" id="method-check" />
                <Label htmlFor="method-check">Check</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="ach" id="method-ach" />
                <Label htmlFor="method-ach">ACH</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="wire" id="method-wire" />
                <Label htmlFor="method-wire">Wire</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="other" id="method-other" />
                <Label htmlFor="method-other">Other</Label>
              </div>
            </RadioGroup>
          </div>
          
          <div className="space-y-2">
            <Label>Check number / ACH trace / wire reference</Label>
            <Input 
              value={reference} 
              onChange={e => setReference(e.target.value)} 
              maxLength={LIMITS.paymentReference} 
              placeholder="Optional"
            />
            <p className="text-xs text-muted-foreground">
              Shared with the team so they can match the deposit. Never emailed.
            </p>
          </div>
          
          <div className="space-y-2">
            <Label>Date Sent</Label>
            <Input 
              type="date"
              max={today}
              value={sentOn}
              onChange={e => setSentOn(e.target.value)}
            />
          </div>
          
          <div className="space-y-2">
            <Label>Note</Label>
            <Textarea 
              value={note}
              onChange={e => setNote(e.target.value)}
              maxLength={LIMITS.fulfillmentNote}
              placeholder="Optional message for the team..."
            />
          </div>
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>Cancel</Button>
          <Button onClick={onSubmit} disabled={isPending || !method}>
            {isPending ? 'Saving...' : 'Mark as Sent'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
