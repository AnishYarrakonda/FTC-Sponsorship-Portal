'use client'

import { useRouter } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'

/**
 * "Back" control for standalone pages that can be reached with or without in-app history.
 *
 * Every in-app link to /legal/* opens in a new tab (`target="_blank"` in the signup
 * wizards), and search engines index those pages via the sitemap — both cases land the
 * user in a tab with nothing to pop, where a bare `router.back()` is a dead button.
 * The history check is done at click time rather than render time so the markup stays
 * identical on server and client (no hydration mismatch, no label flash).
 */
export function BackButton({
  fallbackHref = '/',
  label = 'Back',
}: {
  fallbackHref?: string
  label?: string
}) {
  const router = useRouter()

  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) {
          router.back()
        } else {
          router.push(fallbackHref)
        }
      }}
      className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
    >
      <ChevronLeft className="h-4 w-4" />
      {label}
    </button>
  )
}
