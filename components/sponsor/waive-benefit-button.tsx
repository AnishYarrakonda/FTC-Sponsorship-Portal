'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { buttonVariants } from '@/components/ui/button'
import { waiveBenefit } from '@/app/actions/recognition'
import { cn } from '@/lib/utils'

/**
 * "Not needed" — the sponsor declining a benefit they are owed.
 *
 * A sponsor cannot mark a benefit DELIVERED (that is the team's claim to make) and this
 * is the only recognition write they have. The RPC enforces the same split.
 *
 * A-07-01: this used to fire on a single click of a `ghost` button sitting inline in a
 * list — the lightest affordance in the design system attached to the least reversible
 * action on the page.
 *
 * The copy is precise about who can undo it, because the database is:
 * record_benefit_delivery refuses any move off `waived` unless the actor is an admin
 * ("a waived row is the sponsor's decision"). So the sponsor genuinely cannot undo it
 * themselves and there is no un-waive control in this portal — but an admin can, and
 * telling someone their mistake is permanent when it is not would send them away instead
 * of to support.
 */
export function WaiveBenefitButton({ deliveryId, label }: { deliveryId: string; label: string }) {
  const [pending, startTransition] = useTransition()

  const handleWaive = () => {
    startTransition(async () => {
      const res = await waiveBenefit({ deliveryId })
      if (res.error) toast.error(res.error)
      else toast.success(`“${label}” marked as not needed.`)
    })
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger
        className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
        disabled={pending}
      >
        {pending ? 'Saving…' : 'Not needed'}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Waive “{label}”?</AlertDialogTitle>
          <AlertDialogDescription>
            This tells the team you do not need this recognition benefit, and the team will
            no longer be expected to deliver it. <strong>You cannot undo this yourself</strong> —
            if you change your mind, an administrator has to reverse it for you.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Keep it</AlertDialogCancel>
          <AlertDialogAction onClick={handleWaive} disabled={pending}>
            Yes, waive it
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
