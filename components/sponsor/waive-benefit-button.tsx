'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { waiveBenefit } from '@/app/actions/recognition'

/**
 * "Not needed" — the sponsor declining a benefit they are owed.
 *
 * A sponsor cannot mark a benefit DELIVERED (that is the team's claim to make) and this
 * is the only recognition write they have. The RPC enforces the same split.
 */
export function WaiveBenefitButton({ deliveryId, label }: { deliveryId: string; label: string }) {
  const [pending, startTransition] = useTransition()

  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await waiveBenefit({ deliveryId })
          if (res.error) toast.error(res.error)
          else toast.success(`“${label}” marked as not needed.`)
        })
      }
    >
      {pending ? 'Saving…' : 'Not needed'}
    </Button>
  )
}
