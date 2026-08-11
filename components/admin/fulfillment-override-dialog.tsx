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
import { adminOverrideFulfillmentStatus } from '@/app/actions/fulfillment'
import { LEGAL_TRANSITIONS, canTransition, FulfillmentStatus } from '@/lib/fulfillment-status'
import { LIMITS } from '@/lib/schemas/limits'

export function FulfillmentOverrideDialog({ fulfillment }: { fulfillment: any }) {
  const currentStatus = fulfillment.status as FulfillmentStatus
  const legalTargets = (LEGAL_TRANSITIONS[currentStatus] || []).filter(t =>
    canTransition(currentStatus, t, 'admin')
  )

  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  
  const [targetStatus, setTargetStatus] = useState<FulfillmentStatus>(legalTargets[0] || currentStatus)
  const [reason, setReason] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'check' | 'ach' | 'wire' | 'other' | ''>('')
  const [occurredOn, setOccurredOn] = useState('')
  const [error, setError] = useState<string | null>(null)
  
  const isReasonValid = reason.trim().length >= 10
  const isTargetPaymentSent = targetStatus === 'payment_sent'
  const isDisabled = isPending || legalTargets.length === 0 || !isReasonValid

  function onSubmit() {
    setError(null)
    if (!isReasonValid) return

    startTransition(async () => {
      const res = await adminOverrideFulfillmentStatus({
        fulfillmentId: fulfillment.id,
        toStatus: targetStatus as any,
        reason: reason.trim(),
        paymentMethod: isTargetPaymentSent && paymentMethod ? paymentMethod : undefined,
        occurredOn: isTargetPaymentSent && occurredOn ? occurredOn : undefined,
      })
      
      if (res.error) {
        setError(res.error)
      } else {
        toast.success('Status overridden successfully')
        setOpen(false)
        router.refresh()
      }
    })
  }
  
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" disabled={legalTargets.length === 0}>
            Override
          </Button>
        }
      />
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle>Admin Override</DialogTitle>
          <DialogDescription>
            Record an administrative status override for this fulfillment.
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid gap-4 py-3">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          
          <div className="space-y-2">
            <Label>Target Status</Label>
            {legalTargets.length > 0 ? (
              <select
                value={targetStatus}
                onChange={(e) => setTargetStatus(e.target.value as FulfillmentStatus)}
                className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {legalTargets.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            ) : (
              <div className="text-xs text-muted-foreground italic">No legal transition target available for status: {currentStatus}</div>
            )}
          </div>

          {isTargetPaymentSent && (
            <>
              <div className="space-y-2">
                <Label>Payment Method (Optional)</Label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as any)}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">Select method...</option>
                  <option value="check">Check</option>
                  <option value="ach">ACH</option>
                  <option value="wire">Wire</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div className="space-y-2">
                <Label>Date Sent (Optional)</Label>
                <Input
                  type="date"
                  max={new Date().toISOString().split('T')[0]}
                  value={occurredOn}
                  onChange={e => setOccurredOn(e.target.value)}
                />
              </div>
            </>
          )}
          
          <div className="space-y-2">
            <Label>Reason (Required, min 10 characters)</Label>
            <Textarea 
              value={reason}
              onChange={e => setReason(e.target.value)}
              maxLength={LIMITS.fulfillmentNote}
              placeholder="Explain why this manual override is being issued..."
            />
            {reason.length > 0 && !isReasonValid && (
              <p className="text-xs text-destructive">Reason must be at least 10 characters (currently {reason.trim().length}).</p>
            )}
          </div>

          <p className="text-xs text-muted-foreground border-l-2 border-amber-500/50 pl-2">
            An override is recorded against your account with this reason. Use it to correct a mistake, not to move money.
          </p>
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>Cancel</Button>
          <Button onClick={onSubmit} disabled={isDisabled}>
            {isPending ? 'Saving...' : 'Apply Override'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

