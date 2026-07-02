'use client'

import { useTransition } from 'react'
import { adminToggleSponsorStatus } from '@/app/actions/sponsor'

export function SponsorToggleButton({
  sponsorId,
  currentStatus,
}: {
  sponsorId: string
  currentStatus: string
}) {
  const [isPending, startTransition] = useTransition()
  const isActive = currentStatus === 'active'

  function handleToggle() {
    startTransition(async () => {
      await adminToggleSponsorStatus(sponsorId, isActive ? 'inactive' : 'active')
    })
  }

  return (
    <button
      onClick={handleToggle}
      disabled={isPending}
      className={`text-xs font-medium px-2.5 py-1 rounded-full border transition-colors disabled:opacity-50 ${
        isActive
          ? 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-red-900/60 hover:text-red-400 hover:bg-red-500/5'
          : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:border-emerald-900/60 hover:text-emerald-400 hover:bg-emerald-500/5'
      }`}
    >
      {isPending ? '…' : isActive ? 'Deactivate' : 'Activate'}
    </button>
  )
}
