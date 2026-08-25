'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import { ExternalLink } from 'lucide-react'
import { mintSensitiveDocumentUrl } from '@/app/actions/sensitive-documents'

/**
 * A-06-03. "Open Externally" for a government photo ID or a W-9.
 *
 * This used to be an `<a href={signedUrl}>` reusing the URL minted when the queue page
 * rendered. That is why the TTL was 1800 seconds: it had to survive however long the admin
 * spent working through the list. The consequence was a URL that authorizes anyone holding
 * it — no session required — sitting live for half an hour.
 *
 * Minting on click instead lets the TTL be 60 seconds without the link ever going stale,
 * and gives the audit log a row for each actual view rather than one per page load.
 */
export function OpenSensitiveDocumentButton({
  kind,
  subjectId,
  label = 'Open Externally',
}: {
  kind: 'coach_credential'
  subjectId: string
  label?: string
}) {
  const [isPending, startTransition] = useTransition()

  function handleOpen() {
    startTransition(async () => {
      const result = await mintSensitiveDocumentUrl({ kind, subjectId })
      if (result.error || !result.url) {
        toast.error(result.error ?? 'Could not open that document.')
        return
      }
      // noopener/noreferrer: the signed URL must not leak through a referrer header.
      window.open(result.url, '_blank', 'noopener,noreferrer')
    })
  }

  return (
    <button
      type="button"
      onClick={handleOpen}
      disabled={isPending}
      className="pointer-events-auto bg-background/80 hover:bg-accent text-foreground text-xs px-3 py-1.5 rounded-full backdrop-blur flex items-center gap-1.5 transition-colors border border-border/50 disabled:opacity-60"
    >
      {isPending ? 'Opening…' : label} <ExternalLink className="h-3 w-3" aria-hidden="true" />
    </button>
  )
}
