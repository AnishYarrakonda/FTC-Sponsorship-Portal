'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertTriangle } from 'lucide-react'
import { createAgreementDraft, updateAgreementDraft, publishAgreementVersion } from '@/app/actions/agreements'
import {
  validateTemplateBody,
  renderAgreement,
  MissingMergeFieldError,
} from '@/lib/agreements/render'
import { exampleMergeContext } from '@/lib/agreements/merge-fields'
import type { AgreementTemplateKey } from '@/lib/schemas/agreement'

type Props =
  | {
      mode: 'create'
      templateKey: AgreementTemplateKey
      initialTitle?: string
      initialBody?: string
      initialConsentText?: string
    }
  | {
      mode: 'edit'
      templateKey: AgreementTemplateKey
      draftId: string
      initialTitle: string
      initialBody: string
      initialConsentText: string
    }

export function AgreementEditor(props: Props) {
  const router = useRouter()
  const [title, setTitle] = useState(props.initialTitle ?? '')
  const [body, setBody] = useState(props.initialBody ?? '')
  const [consentText, setConsentText] = useState(props.initialConsentText ?? '')
  const [isPending, startTransition] = useTransition()
  const [isPublishing, startPublish] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // Debounced live preview against the registry's example values.
  const [debouncedBody, setDebouncedBody] = useState(body)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedBody(body), 250)
    return () => clearTimeout(t)
  }, [body])

  const validation = useMemo(() => validateTemplateBody(debouncedBody), [debouncedBody])

  const preview = useMemo(() => {
    if (!validation.ok) return null
    try {
      return renderAgreement(debouncedBody, exampleMergeContext()).html
    } catch (e) {
      if (e instanceof MissingMergeFieldError) return null
      throw e
    }
  }, [debouncedBody, validation])

  const unknownTokens = validation.ok ? [] : validation.unknown

  const handleSave = () => {
    if (unknownTokens.length > 0 || isPending) return
    setError(null)
    startTransition(async () => {
      const result =
        props.mode === 'create'
          ? await createAgreementDraft({ key: props.templateKey, title, body, consentText })
          : await updateAgreementDraft({ id: props.draftId, title, body, consentText })

      if (result.error) {
        setError(result.error)
        toast.error('Save failed')
        return
      }
      toast.success('Draft saved')
      router.refresh()
    })
  }

  const handlePublish = () => {
    if (props.mode !== 'edit' || isPublishing) return
    setError(null)
    startPublish(async () => {
      const result = await publishAgreementVersion({ id: props.draftId })
      if (result.error) {
        setError(result.error)
        toast.error('Publish failed')
        return
      }
      toast.success('Version published')
      router.push(`/agreements/${props.templateKey}`)
      router.refresh()
    })
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{props.mode === 'create' ? 'New draft' : 'Edit draft'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="agreement-title">Title</label>
            <Input
              id="agreement-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isPending}
              maxLength={200}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="agreement-consent">Consent text (shown at signing)</label>
            <textarea
              id="agreement-consent"
              className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={consentText}
              onChange={(e) => setConsentText(e.target.value)}
              disabled={isPending}
              maxLength={4000}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="agreement-body">
              Document body — use <code>{'{{ field_name }}'}</code> for merge fields
            </label>
            {/* Plain textarea, not the tiptap rich-text editor: tiptap would mangle
                {{ tokens }} by wrapping them in markup. */}
            <textarea
              id="agreement-body"
              className="min-h-96 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={isPending}
              maxLength={60000}
            />
          </div>

          {unknownTokens.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertDescription>
                Unknown merge field(s): {unknownTokens.map((t) => `{{ ${t} }}`).join(', ')}. Remove
                or correct them before saving.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
        <CardFooter className="flex gap-2">
          <Button
            disabled={unknownTokens.length > 0 || isPending || !title.trim() || !consentText.trim()}
            loading={isPending}
            onClick={handleSave}
          >
            Save draft
          </Button>
          {props.mode === 'edit' && (
            <Button
              variant="outline"
              disabled={unknownTokens.length > 0 || isPublishing}
              loading={isPublishing}
              onClick={handlePublish}
            >
              Publish
            </Button>
          )}
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Live preview (example values)</CardTitle>
        </CardHeader>
        <CardContent>
          {preview ? (
            <div className="prose prose-invert prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: preview }} />
          ) : (
            <p className="text-sm text-muted-foreground">
              {unknownTokens.length > 0
                ? 'Fix the unknown merge field(s) to see a preview.'
                : 'Preview unavailable.'}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
