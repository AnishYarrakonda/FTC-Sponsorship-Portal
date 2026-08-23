'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { ActionWarning } from '@/components/ui/action-warning'
import { approveSponsorApplication, rejectSponsorApplication } from '@/app/actions/admin'

export function ApplicationActions({ applicationId }: { applicationId: string }) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)

  function handle(action: 'approve' | 'reject') {
    setError(null)
    setWarning(null)
    startTransition(async () => {
      const result =
        action === 'approve'
          ? await approveSponsorApplication(applicationId)
          : await rejectSponsorApplication(applicationId)
      if (result?.error) setError(result.error)
      // P0-11: approveSponsorApplication warns when the sponsor company was created but
      // no profile could be linked to it — the applicant cannot sign in at all. Read by
      // nothing before; the admin just saw the row succeed.
      else if ('warning' in result && typeof result.warning === 'string') setWarning(result.warning)
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {error && <p className="text-xs text-destructive-text mr-2">{error}</p>}
      {warning && (
        <div className="w-full">
          <ActionWarning>{warning}</ActionWarning>
        </div>
      )}
      <Button size="sm" variant="outline" onClick={() => handle('reject')} disabled={isPending}>
        Reject
      </Button>
      <Button size="sm" onClick={() => handle('approve')} disabled={isPending}>
        {isPending ? 'Processing…' : 'Approve & Add Sponsor'}
      </Button>
    </div>
  )
}
