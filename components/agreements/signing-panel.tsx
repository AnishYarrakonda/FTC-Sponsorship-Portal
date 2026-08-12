'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertTriangle, ShieldCheck } from 'lucide-react'
import { signAgreement } from '@/app/actions/agreements-sign'
import { typedNameMatches } from '@/lib/agreements/typed-name-match'
import type { PreparedDocument } from '@/lib/agreements/provider'

interface SigningPanelProps {
  submissionId: string
  document: PreparedDocument
}

export function SigningPanel({ submissionId, document }: SigningPanelProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [scrolledToBottom, setScrolledToBottom] = useState(false)
  const [consentChecked, setConsentChecked] = useState(false)
  const [typedName, setTypedName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const sentinel = sentinelRef.current
    const root = scrollContainerRef.current
    if (!sentinel || !root) return

    // IntersectionObserver fires with the CURRENT intersection state as soon as
    // observation starts, so a document shorter than the viewport is treated as
    // already-read immediately — no separate "is this scrollable at all" check needed.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setScrolledToBottom(true)
      },
      { root, threshold: 0.99 }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [])

  const nameMatches = typedNameMatches(typedName, document.expectedSignerName)
  const showMismatchHint = typedName.trim().length > 0 && !nameMatches

  const controlsDisabled = !scrolledToBottom || isPending
  const canSubmit = scrolledToBottom && consentChecked && nameMatches && !isPending

  function handleSubmit() {
    setError(null)
    startTransition(async () => {
      const result = await signAgreement({
        submissionId,
        templateId: document.templateId,
        documentHash: document.sha256,
        typedName: typedName.trim(),
        consentAccepted: consentChecked,
      })
      if (result.error) {
        setError(result.error)
        toast.error('Could not record your signature')
        return
      }
      toast.success('Signature recorded')
      if (result.signatureId) {
        router.push(`/agreement-records/${result.signatureId}`)
      } else {
        router.refresh()
      }
    })
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{document.title}</CardTitle>
          <CardDescription>
            Scroll to the end of the agreement to continue.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            ref={scrollContainerRef}
            className="prose prose-invert max-h-[60vh] max-w-none overflow-y-auto rounded-md border border-border bg-card/50 p-6"
          >
            <div dangerouslySetInnerHTML={{ __html: document.html }} />
            <div ref={sentinelRef} data-testid="agreement-scroll-sentinel" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Consent to sign electronically</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{document.consentText}</p>

          <div className="flex items-start gap-2">
            <Checkbox
              id="consent-checkbox"
              checked={consentChecked}
              disabled={controlsDisabled}
              onCheckedChange={setConsentChecked}
              className="mt-1"
            />
            <Label htmlFor="consent-checkbox" className="text-sm font-normal leading-snug">
              I agree to sign this document electronically. I understand my typed name below
              is my legal signature and has the same effect as a handwritten one.
            </Label>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="typed-name">Type your full legal name to sign</Label>
            <Input
              id="typed-name"
              value={typedName}
              disabled={controlsDisabled}
              onChange={(e) => setTypedName(e.target.value)}
              placeholder={document.expectedSignerName || 'Your full legal name'}
              autoComplete="off"
            />
            {document.expectedSignerName && (
              <p className="text-xs text-muted-foreground">
                Must match the name on your account: {document.expectedSignerName}
              </p>
            )}
            {showMismatchHint && (
              <p className="text-xs text-destructive">This does not match the expected name.</p>
            )}
          </div>

          <Alert>
            <ShieldCheck className="h-4 w-4" />
            <AlertDescription>
              We will record your name, the time in UTC, your IP address, your browser, and
              a cryptographic fingerprint of this exact document.
            </AlertDescription>
          </Alert>

          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {!scrolledToBottom && (
            <p className="text-xs text-muted-foreground">
              Scroll to the end of the agreement to continue.
            </p>
          )}
        </CardContent>
        <CardFooter className="flex flex-col items-stretch gap-3">
          <Button onClick={handleSubmit} disabled={!canSubmit} className="w-full">
            {isPending ? 'Signing…' : 'Sign agreement'}
          </Button>
          <p className="text-center font-mono text-[10px] text-muted-foreground break-all">
            {document.sha256}
          </p>
        </CardFooter>
      </Card>
    </div>
  )
}
