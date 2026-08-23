'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { setFulfillmentPoNumber } from '@/app/actions/sponsor-finance'

/**
 * A-12-04. The sponsor's purchase-order reference for one commitment.
 *
 * Editable at any status, including after payment: a PO is issued by the sponsor's AP
 * department on their own schedule, often after the money has already been committed here,
 * and it gets corrected. Locking it to a lifecycle stage would guarantee it goes stale.
 *
 * It constrains nothing — see migration 0110. This is a reference a finance team needs to
 * reconcile, not an input to any decision.
 */
export function PoNumberField({
  fulfillmentId,
  initialValue,
}: {
  fulfillmentId: string
  initialValue: string | null
}) {
  const router = useRouter()
  const [value, setValue] = useState(initialValue ?? '')
  const [isPending, startTransition] = useTransition()

  const dirty = (value.trim() || null) !== (initialValue || null)

  function handleSave() {
    startTransition(async () => {
      const result = await setFulfillmentPoNumber({ fulfillmentId, poNumber: value.trim() })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(value.trim() ? 'PO number saved' : 'PO number cleared')
      router.refresh()
    })
  }

  return (
    <div className="flex items-end gap-2">
      <div className="min-w-0 flex-1 space-y-1">
        <Label htmlFor={`po-${fulfillmentId}`} className="text-xs text-muted-foreground">
          PO number
        </Label>
        <Input
          id={`po-${fulfillmentId}`}
          value={value}
          maxLength={64}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. PO-2026-00412"
          className="h-8 font-mono text-xs"
        />
      </div>
      <Button size="sm" variant="outline" onClick={handleSave} disabled={isPending || !dirty}>
        {isPending ? 'Saving…' : 'Save'}
      </Button>
    </div>
  )
}
