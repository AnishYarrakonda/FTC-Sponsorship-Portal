'use client'

import { useRef, useState, useTransition } from 'react'
import Image from 'next/image'
import { AlertTriangle, Camera, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { uploadBenefitProof } from '@/app/actions/recognition'
import { recognitionBenefitHint, type RecognitionBenefitType } from '@/lib/recognition'

/**
 * Proof photo uploader.
 *
 * The no-minors affirmation gates the file input itself, not just the submit: the coach
 * cannot choose a file until they have read and ticked it. The server action re-checks
 * before touching storage, and a DB CHECK makes a proof without the affirmation
 * unrepresentable — three layers, because this is the COPPA control.
 *
 * We are honest in the copy about what the control is: a human affirmation and admin
 * review. There is no automated face detection and we do not imply there is.
 */
export function BenefitProofUploader({
  deliveryId,
  benefitType,
  proofUrl,
  voidReason,
}: {
  deliveryId: string
  benefitType: RecognitionBenefitType
  proofUrl: string | null
  voidReason: string | null
}) {
  const [confirmed, setConfirmed] = useState(false)
  const [pending, startTransition] = useTransition()
  const [localUrl, setLocalUrl] = useState<string | null>(proofUrl)
  const inputRef = useRef<HTMLInputElement>(null)

  const onFile = (file: File | undefined) => {
    if (!file) return
    if (!confirmed) {
      toast.error('Tick the no-students confirmation first.')
      return
    }
    const formData = new FormData()
    formData.set('file', file)
    formData.set('noMinorsConfirmed', 'true')

    startTransition(async () => {
      const res = await uploadBenefitProof(deliveryId, formData)
      if (res.error) {
        toast.error(res.error)
        if (inputRef.current) inputRef.current.value = ''
        return
      }
      setLocalUrl(res.url ?? null)
      toast.success('Proof photo uploaded.')
    })
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
      {voidReason && !localUrl && (
        <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-900 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            <span className="font-medium">An administrator removed the previous photo.</span>{' '}
            {voidReason} Please upload a replacement.
          </p>
        </div>
      )}

      {localUrl ? (
        <div className="flex items-center gap-3">
          <Image
            src={localUrl}
            alt={`Proof photo for ${benefitType}`}
            width={64}
            height={64}
            unoptimized
            className="h-16 w-16 rounded-md border border-border object-cover"
          />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium">Proof attached</p>
            <p className="text-xs text-muted-foreground">{recognitionBenefitHint(benefitType)}</p>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{recognitionBenefitHint(benefitType)}</p>
      )}

      <label className="flex items-start gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 rounded border-border"
        />
        <span>
          I confirm this photo shows no students and no identifiable minors. Photos are reviewed by
          administrators and can be removed.
        </span>
      </label>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        disabled={!confirmed || pending}
        onChange={(e) => onFile(e.target.files?.[0])}
        className="hidden"
        id={`proof-${deliveryId}`}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!confirmed || pending}
        onClick={() => inputRef.current?.click()}
      >
        {pending ? (
          <>
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden /> Uploading…
          </>
        ) : (
          <>
            <Camera className="mr-2 h-3.5 w-3.5" aria-hidden />
            {localUrl ? 'Replace photo' : 'Attach photo'}
          </>
        )}
      </Button>
      <p className="text-[11px] text-muted-foreground">JPG, PNG or WebP, up to 5 MB.</p>
    </div>
  )
}
