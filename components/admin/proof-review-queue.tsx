'use client'

import { useState, useTransition } from 'react'
import Image from 'next/image'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { adminVoidBenefitProof } from '@/app/actions/recognition'
import {
  isRecognitionBenefitType,
  recognitionBenefitLabel,
} from '@/lib/recognition'

export interface ProofRow {
  id: string
  benefit_type: string
  status: string
  proof_url: string
  proof_uploaded_at: string | null
  team_name: string | null
  company_name: string | null
}

/**
 * The COPPA review queue: every delivery carrying a proof photo, newest first.
 *
 * This is the actual control. The no-minors affirmation is a human promise and the DB
 * CHECK only enforces that the promise was made — neither inspects the image. An admin
 * looking at these photos is what catches a student in frame, so the queue is deliberately
 * a wall of thumbnails rather than a list of filenames.
 */
export function ProofReviewQueue({ rows }: { rows: ProofRow[] }) {
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [pending, startTransition] = useTransition()

  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Proof photos</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No proof photos have been uploaded yet.</p>
        </CardContent>
      </Card>
    )
  }

  const label = (b: string) => (isRecognitionBenefitType(b) ? recognitionBenefitLabel(b) : b)

  const voidProof = (id: string) =>
    startTransition(async () => {
      const res = await adminVoidBenefitProof({ deliveryId: id, reason: reasons[id] ?? '' })
      if (res.error) toast.error(res.error)
      else {
        toast.success('Proof removed. Both parties have been notified.')
        setReasons((r) => ({ ...r, [id]: '' }))
      }
    })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Proof photos</CardTitle>
        <p className="text-sm text-muted-foreground">
          Newest first. Removing a photo takes it out of both portals and asks the team for a
          replacement. It does not delete the stored file — note that in the reason if the image
          needs purging out of band.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {rows.map((row) => (
          <div key={row.id} className="flex flex-col gap-3 border-t border-border pt-5 first:border-t-0 first:pt-0 sm:flex-row">
            <a href={row.proof_url} target="_blank" rel="noreferrer" className="shrink-0">
              <Image
                src={row.proof_url}
                alt={`Proof for ${label(row.benefit_type)}`}
                width={112}
                height={112}
                unoptimized
                className="h-28 w-28 rounded-md border border-border object-cover"
              />
            </a>
            <div className="min-w-0 flex-1 space-y-2">
              <div>
                <p className="text-sm font-medium">{label(row.benefit_type)}</p>
                <p className="text-xs text-muted-foreground">
                  {row.team_name ?? 'Unknown team'} → {row.company_name ?? 'Unknown sponsor'}
                  {row.proof_uploaded_at
                    ? ` · ${new Date(row.proof_uploaded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                    : ''}
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  placeholder="Reason (min 10 characters) — shown to the coach"
                  value={reasons[row.id] ?? ''}
                  maxLength={500}
                  onChange={(e) => setReasons((r) => ({ ...r, [row.id]: e.target.value }))}
                />
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={pending || (reasons[row.id] ?? '').trim().length < 10}
                  onClick={() => voidProof(row.id)}
                >
                  Remove photo
                </Button>
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
