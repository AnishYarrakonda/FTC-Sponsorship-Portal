'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { createAgreementDraft } from '@/app/actions/agreements'
import type { AgreementTemplateKey } from '@/lib/schemas/agreement'

export function AgreementNewVersionButton({
  templateKey,
  title,
  body,
  consentText,
}: {
  templateKey: AgreementTemplateKey
  title: string
  body: string
  consentText: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const handleClick = () => {
    if (isPending) return
    startTransition(async () => {
      const result = await createAgreementDraft({ key: templateKey, title, body, consentText })
      if (result.error) {
        toast.error(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <Button disabled={isPending} loading={isPending} onClick={handleClick}>
      Create version N+1 from this
    </Button>
  )
}
