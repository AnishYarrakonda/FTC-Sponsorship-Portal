'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { withdrawAppeal } from '@/app/actions/appeals'

export function WithdrawAppealButton({ appealId }: { appealId: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await withdrawAppeal({ appealId })
          if (result?.error) {
            toast.error(result.error)
            return
          }
          toast.success('Appeal withdrawn.')
          router.refresh()
        })
      }
    >
      Withdraw this appeal
    </Button>
  )
}
