'use client'

import { useState, useTransition } from 'react'
import { retryCreateSponsorOrganization } from '@/app/actions/admin'

export function SponsorOrgRetryButton({ sponsorId }: { sponsorId: string }) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleClick() {
    setError(null)
    startTransition(async () => {
      const result = await retryCreateSponsorOrganization(sponsorId)
      if (result?.error) setError(result.error)
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleClick}
        disabled={isPending}
        className="text-xs font-medium px-2.5 py-1 rounded-full border transition-colors disabled:opacity-50 bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-emerald-900/60 hover:text-emerald-400 hover:bg-emerald-500/5"
      >
        {isPending ? 'Creating…' : 'Create organization'}
      </button>
      {error && <p className="text-xs text-red-400 max-w-[220px] text-right">{error}</p>}
    </div>
  )
}
