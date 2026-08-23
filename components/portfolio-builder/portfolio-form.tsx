'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { submissionSchema, type SubmissionInput } from '@/lib/schemas/submission'
import { saveSubmission, autoSaveSubmissionDraft } from '@/app/actions/submission'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { SaveIndicator } from '@/components/ui/save-indicator'
import { ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Submission } from '@/lib/supabase/types'
import { describeActionError } from '@/lib/client-errors'

import { LIMITS } from '@/lib/schemas/limits'
const AUTOSAVE_DELAY_MS = 2000

type Sponsor = { id: string; company_name: string; status: string; funding_cap_cents: number; funding_used_cents: number }

type Props = {
  initialSubmission?: Pick<
    Submission,
    'id' | 'sponsor_id' | 'custom_pitch_alignment' | 'specific_needs_statement' | 'local_connection_notes' | 'status'
  >
  initialValues?: Partial<SubmissionInput>
  sponsors?: Sponsor[]
  preselectedSponsorId?: string
}

export function PortfolioForm({ initialSubmission, initialValues, sponsors = [], preselectedSponsorId }: Props) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [isPending, setIsPending] = useState(false)
  const [submissionId, setSubmissionId] = useState<string | undefined>(initialSubmission?.id)
  
  const [autosaveState, setAutosaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSerialized = useRef<string>('')

  const editableStatuses = ['draft', 'declined', 'changes_requested'] as const
  const readOnly = initialSubmission
    ? !editableStatuses.includes(initialSubmission.status as typeof editableStatuses[number])
    : false

  const form = useForm<SubmissionInput>({
    resolver: zodResolver(submissionSchema),
    defaultValues: {
      sponsorId: initialValues?.sponsorId ?? initialSubmission?.sponsor_id ?? preselectedSponsorId ?? '',
      customPitchAlignment: initialValues?.customPitchAlignment ?? initialSubmission?.custom_pitch_alignment ?? '',
      specificNeedsStatement: initialValues?.specificNeedsStatement ?? initialSubmission?.specific_needs_statement ?? '',
      localConnectionNotes: initialValues?.localConnectionNotes ?? initialSubmission?.local_connection_notes ?? '',
    },
  })

  // Debounced autosave on form changes
  useEffect(() => {
    if (readOnly) return
    const subscription = form.watch((values) => {
      const serialized = JSON.stringify(values)
      if (serialized === lastSerialized.current) return
      lastSerialized.current = serialized

      if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
      autosaveTimer.current = setTimeout(async () => {
        setAutosaveState('saving')
        const current = form.getValues()
        if (!current.sponsorId) {
            setAutosaveState('idle')
            return
        }
        const result = await autoSaveSubmissionDraft(current, submissionId)
        if (result.error) {
          setAutosaveState('error')
        } else {
          if (result.id && !submissionId) setSubmissionId(result.id)
          setAutosaveState('saved')
        }
      }, AUTOSAVE_DELAY_MS)
    })
    return () => {
      subscription.unsubscribe()
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
    }
  }, [form, submissionId, readOnly])

  async function onSubmit(values: SubmissionInput, status: 'draft' | 'pending') {
    setIsPending(true)
    setError(null)
    try {
      const result = await saveSubmission(values, status, submissionId)
      if (result?.error) {
        const msg = result.error === 'rate_limited' && 'message' in result
          ? (result as { message: string }).message
          : result.error
        setError(msg)
        setIsPending(false)
        return
      }
      if (status === 'draft') {
        setIsPending(false)
        setAutosaveState('saved')
      }
    } catch (e) {
      // Without this the form stayed disabled forever on any thrown error, with no
      // message — and the retry button discards the rejection too.
      setError(describeActionError(e, 'saveSubmission'))
      setIsPending(false)
    }
  }

  return (
    <Card className="w-full max-w-4xl mx-auto">
      <CardHeader>
        <div className="flex justify-between items-start">
          <div>
            <CardTitle>{initialSubmission ? 'Edit Submission' : 'Create Submission'}</CardTitle>
            <CardDescription>
              Draft your sponsor-specific submission.
            </CardDescription>
          </div>
          {!readOnly && <SaveIndicator state={autosaveState} />}
        </div>
      </CardHeader>
      <CardContent>
        {readOnly && (
          <Alert className="mb-6">
            <AlertDescription>
              This submission is {initialSubmission?.status} and can no longer be edited.
            </AlertDescription>
          </Alert>
        )}
        <Form {...form}>
          <form className="space-y-8">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}


            <div className="space-y-4">
              <FormField
                control={form.control}
                name="sponsorId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Select Sponsor</FormLabel>
                    <FormControl>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild disabled={readOnly || !!initialSubmission}>
                        <FormControl>
                          <Button variant="outline" className="w-full justify-between font-normal">
                            {sponsors.find(s => s.id === field.value)?.company_name ?? 'Select a sponsor'}
                            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </FormControl>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-full min-w-[300px] max-h-[300px] overflow-y-auto">
                        {sponsors.map(s => (
                          <DropdownMenuItem key={s.id} onClick={() => field.onChange(s.id)}>
                            {s.company_name}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="customPitchAlignment"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Custom Pitch Alignment</FormLabel>
                    <FormControl>
                      {/* A-07-02. No maxLength, so a coach could type past the schema's
                          cap and only discover it when the save was rejected — after the
                          writing was done. maxLength comes from LIMITS rather than a
                          literal, per conventions.md, so the input and the Zod field
                          cannot drift apart. */}
                      <Textarea
                        placeholder="Explain why your team aligns with this company..."
                        className="min-h-[140px]"
                        maxLength={LIMITS.customPitchAlignment}
                        disabled={readOnly}
                        value={field.value ?? ''}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        name={field.name}
                        ref={field.ref}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="specificNeedsStatement"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Specific Needs Statement</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Detail your specific financial or material needs..."
                        className="min-h-[140px]"
                        maxLength={LIMITS.specificNeeds}
                        disabled={readOnly}
                        value={field.value ?? ''}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        name={field.name}
                        ref={field.ref}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="localConnectionNotes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Local Connection Notes (Optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Any local connections to this sponsor?"
                        className="min-h-[80px]"
                        maxLength={LIMITS.localConnection}
                        disabled={readOnly}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {!readOnly && (
              <div className="flex flex-col items-end gap-4 pt-6 border-t">
                {Object.keys(form.formState.errors).length > 0 && (
                  <p className="text-xs text-destructive font-medium animate-pulse">
                    Please fix {Object.keys(form.formState.errors).length} validation error{Object.keys(form.formState.errors).length > 1 ? 's' : ''} below
                  </p>
                )}
                <div className="flex justify-end gap-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => router.push('/dashboard')}
                    disabled={isPending}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={form.handleSubmit((v) => onSubmit(v, 'draft'))}
                    disabled={isPending}
                  >
                    Save as Draft
                  </Button>
                  <Button
                    type="button"
                    onClick={form.handleSubmit((v) => onSubmit(v, 'pending'))}
                    disabled={isPending}
                  >
                    {isPending ? 'Submitting...' : 'Submit for Review'}
                  </Button>
                </div>
              </div>
            )}
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
