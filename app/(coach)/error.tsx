'use client'

import { useEffect } from 'react'
import Link from 'next/link'

export default function CoachError({
  error,
  reset,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  reset?: () => void
  unstable_retry?: () => void
}) {
  useEffect(() => {
    console.error('[coach/error] Unhandled error:', error)
  }, [error])

  const retry = unstable_retry ?? reset

  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-sm text-muted-foreground">Something went wrong. Please try again.</p>
      <div className="flex gap-3">
        {retry && (
          <button
            onClick={() => retry()}
            className="rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-accent"
          >
            Try again
          </button>
        )}
        <Link
          href="/dashboard"
          className="rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-accent"
        >
          Go to dashboard
        </Link>
      </div>
      <p className="text-xs text-muted-foreground">
        If this keeps happening, email{' '}
        <a href="mailto:support@ftcportal.dev" className="underline hover:text-foreground">
          support@ftcportal.dev
        </a>
        .
      </p>
    </div>
  )
}
