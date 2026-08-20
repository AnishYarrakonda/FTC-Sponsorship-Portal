'use client'

import { useState, useTransition } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { clearLegalReviewFlag } from '@/app/actions/agreements'

type ReviewItem = { id: string; title: string; version: number }

export function AgreementLegalReviewBanner({ items }: { items: ReviewItem[] }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [isPending, startTransition] = useTransition()

  if (items.length === 0) return null

  const handleClear = (id: string) => {
    if (!note.trim() || isPending) return
    startTransition(async () => {
      const result = await clearLegalReviewFlag({ id, reviewerNote: note.trim() })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Legal review flag cleared')
      setOpenId(null)
      setNote('')
    })
  }

  return (
    <Alert variant="destructive">
      <AlertTriangle />
      <AlertTitle>Attorney review required</AlertTitle>
      <AlertDescription>
        <p>
          These documents have not been reviewed by an attorney. They are engineering-drafted
          template copy, not legal advice. Have counsel review them before relying on them in a
          real transaction.
        </p>
        <ul className="mt-2 space-y-2">
          {items.map((item) => (
            <li key={item.id} className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-foreground">
                  {item.title} (v{item.version})
                </span>
                {openId !== item.id && (
                  <Button size="sm" variant="outline" onClick={() => setOpenId(item.id)}>
                    Mark reviewed
                  </Button>
                )}
              </div>
              {openId === item.id && (
                <div className="flex items-center gap-2">
                  <Input
                    autoFocus
                    placeholder="Reviewer note (required)"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    disabled={isPending}
                  />
                  <Button
                    size="sm"
                    disabled={!note.trim() || isPending}
                    loading={isPending}
                    onClick={() => handleClear(item.id)}
                  >
                    Confirm
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={isPending}
                    onClick={() => {
                      setOpenId(null)
                      setNote('')
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  )
}
