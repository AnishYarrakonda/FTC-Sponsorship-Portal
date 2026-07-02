'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Info, X } from 'lucide-react'

const AREA_LABELS: Record<string, string> = {
  admin: 'admin',
  coach: 'coach',
  sponsor: 'sponsor',
}

/**
 * Shown at the top of a dashboard when the user was bounced out of an area
 * their role can't access (role layouts append `?redirected=<area>`).
 * Dismissible; renders nothing when the param is absent or unknown.
 */
export function RoleRedirectBanner() {
  const searchParams = useSearchParams()
  const [dismissed, setDismissed] = useState(false)

  const area = searchParams.get('redirected')
  const label = area ? AREA_LABELS[area] : undefined
  if (!label || dismissed) return null

  return (
    <div
      role="status"
      className="mb-6 flex items-start justify-between gap-3 rounded-lg border border-border bg-accent/40 px-4 py-3"
    >
      <div className="flex items-start gap-2.5 text-sm">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
        <p className="text-foreground">
          You don&apos;t have access to the {label} area — here&apos;s your dashboard instead.
          <span className="block text-xs text-muted-foreground mt-0.5">
            If you think this is a mistake, contact support.
          </span>
        </p>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      >
        <X className="h-4 w-4" strokeWidth={1.5} />
      </button>
    </div>
  )
}
