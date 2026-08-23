'use client'

import { useState, useTransition, useCallback, useEffect, type ReactNode } from 'react'
import { formatMoneyAmount } from '@/lib/format-money'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { teamOnboardingSchema, type TeamOnboardingInput } from '@/lib/schemas/team'
import { updateTeam } from '@/app/actions/team'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Trash, Image as ImageIcon, Upload, Plus, Sparkles, Trophy, X, ChevronDown, Wrench } from 'lucide-react'
import { toast } from 'sonner'
import Image from 'next/image'
import Link from 'next/link'
import type { Team, TeamAchievement } from '@/lib/supabase/types'
import { resolveW9Status, type W9Status } from '@/lib/w9-status'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@clerk/nextjs'
import { cn } from '@/lib/utils'
import { MediaAffirmation } from './media-affirmation'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { ImageCropperDialog, getCroppedBlob, computeCenterCrop } from '@/components/ui/image-cropper-dialog'

// ── Section scaffolding ──────────────────────────────────────────────────────

function SectionCard({
  id,
  title,
  description,
  action,
  children,
  className,
}: {
  id: string
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div id={id} className={cn('scroll-mt-28 rounded-xl border border-border bg-card p-6 space-y-5', className)}>
      <div className="flex items-start justify-between gap-4 border-b border-border pb-3">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">{title}</h3>
          {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

// ── Chip input for past sponsors ─────────────────────────────────────────────

function ChipInput({
  value,
  onChange,
  placeholder,
  maxItems = 25,
}: {
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  maxItems?: number
}) {
  const [draft, setDraft] = useState('')

  const commit = () => {
    const name = draft.trim()
    if (!name) return
    if (value.includes(name)) { setDraft(''); return }
    if (value.length >= maxItems) {
      toast.error(`Please limit to ${maxItems} entries`)
      return
    }
    onChange([...value, name])
    setDraft('')
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={draft}
          placeholder={placeholder}
          maxLength={120}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              commit()
            }
          }}
          onBlur={commit}
        />
        <Button type="button" variant="outline" size="sm" className="h-9 shrink-0" onClick={commit}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add
        </Button>
      </div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-accent/60 px-2.5 py-1 text-xs font-medium text-foreground"
            >
              {name}
              <button
                type="button"
                aria-label={`Remove ${name}`}
                className="text-muted-foreground hover:text-destructive-text transition-colors"
                onClick={() => onChange(value.filter((n) => n !== name))}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main editor ──────────────────────────────────────────────────────────────

export function PortfolioTab({ team, achievements }: { team: Team, achievements: TeamAchievement[] }) {
  const [isPending, startTransition] = useTransition()
  const [draggingOver, setDraggingOver] = useState(false)
  const [, setUploadingDrop] = useState(false)
  const [pendingPitchFile, setPendingPitchFile] = useState<File | null>(null)
  const [pitchCropperOpen, setPitchCropperOpen] = useState(false)
  const [engineeringOpen, setEngineeringOpen] = useState(false)
  const { userId } = useAuth()

  const isIncubator = team.status === 'incubator'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = team as any

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const form = useForm<any>({
    resolver: zodResolver(teamOnboardingSchema) as never,
    defaultValues: {
      status: team.status,
      ftcTeamNumber: team.ftc_team_number ?? undefined,
      teamName: team.team_name,
      tagline: team.tagline || '',
      organization: team.organization || '',
      city: team.city || '',
      state: team.state || '',
      missionStatement: team.mission_statement || '',
      taxStatus: team.tax_status,
      communityInterestText: team.community_interest_text || '',
      studentInterestCount: t.student_interest_count ?? 0,
      sustainabilityPlan: t.sustainability_plan || '',
      seedFundingGoalsCents: team.seed_funding_goals_cents ?? 0,
      technicalSummary: team.technical_summary || '',
      outreachSummary: team.outreach_summary || '',
      mediaUrls: team.media_urls || [],
      youtubeUrl: team.youtube_url || '',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      budgetItems: (team.budget_items as any[] | null)?.map((item) => ({
        label: item.label,
        qty: item.qty,
        unitCostCents: item.unit_cost_cents,
        totalCents: item.total_cents,
      })) || [],
      financialAskCents: team.financial_ask_cents || 0,
      githubLink: t.github_link || '',
      visualPitchItems: t.visual_pitch_items || [],
      achievements: achievements.map(a => ({
        season: a.season || '',
        eventName: a.event_name,
        award: a.award || '',
        description: a.description || '',
      })),
      coachPhotoUrl: t.coach_photo_url || '',
      subteamBreakdown: t.subteam_breakdown || '',
      // Team Story & People
      foundedYear: t.founded_year ?? undefined,
      teamSize: t.team_size ?? undefined,
      seasonsCompeted: t.seasons_competed ?? undefined,
      coachExperience: t.coach_experience || '',
      // Credibility
      pastSponsors: (t.past_sponsors as string[] | null) ?? [],
      pressLinks: (t.press_links as { label: string; url: string }[] | null) ?? [],
      communityEndorsements: t.community_endorsements || '',
      // Community & Ethics Impact
      studentsReached: t.students_reached ?? undefined,
      eventsHosted: t.events_hosted ?? undefined,
      volunteerHours: t.volunteer_hours ?? undefined,
    } as TeamOnboardingInput,
  })

  const { fields: visualItems, append: appendVisual, remove: removeVisual } = useFieldArray({
    control: form.control,
    name: 'visualPitchItems',
  })

  const { fields: achItems, append: appendAch, remove: removeAch } = useFieldArray({
    control: form.control,
    name: 'achievements',
  })

  const { fields: pressItems, append: appendPress, remove: removePress } = useFieldArray({
    control: form.control,
    name: 'pressLinks',
  })

  async function uploadFile(file: File) {
    if (!userId) {
      toast.error('Not authenticated')
      return
    }
    const supabase = createClient()

    const ext = file.name.split('.').pop()?.toLowerCase()
    if (!ext || !['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) {
      toast.error('Only JPG, PNG, WebP, or GIF files are supported')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File must be under 5 MB')
      return
    }

    const filePath = `${userId}/${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('pitch-storage').upload(filePath, file)
    if (error) { toast.error(error.message); return }
    const { data: urlData } = supabase.storage.from('pitch-storage').getPublicUrl(filePath)
    appendVisual({ url: urlData.publicUrl, caption: '' })
    return urlData.publicUrl
  }

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setPendingPitchFile(file)
    setPitchCropperOpen(true)
    e.target.value = ''
  }

  const handlePitchCropConfirm = async (blob: Blob) => {
    toast.loading('Uploading…', { id: 'upload' })
    const croppedFile = new File([blob], `pitch-${Date.now()}.webp`, { type: 'image/webp' })
    await uploadFile(croppedFile)
    toast.success('Uploaded!', { id: 'upload' })
  }

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    setDraggingOver(false)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const files = Array.from(e.dataTransfer.files).filter((f: any) =>
      ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(f.type)
    )
    if (files.length === 0) return
    setUploadingDrop(true)
    toast.loading(`Uploading ${files.length} image${files.length > 1 ? 's' : ''}…`, { id: 'drop-upload' })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await Promise.all(files.map(async (file: any) => {
      const url1 = URL.createObjectURL(file)
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new window.Image()
        el.onload = () => resolve(el)
        el.onerror = reject
        el.src = url1
      })
      const cropArea = computeCenterCrop(img.naturalWidth, img.naturalHeight, 16 / 9)
      URL.revokeObjectURL(url1)
      const url2 = URL.createObjectURL(file)
      const blob = await getCroppedBlob(url2, cropArea)
      URL.revokeObjectURL(url2)
      await uploadFile(new File([blob], `pitch-${Date.now()}.webp`, { type: 'image/webp' }))
    }))
    toast.success('All images uploaded!', { id: 'drop-upload' })
    setUploadingDrop(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const subscription = form.watch((value, { name }) => {
      if (name?.startsWith('budgetItems')) {
        const items = value.budgetItems || []
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const total = items.reduce((sum: number, item: any) => sum + (item.totalCents || 0), 0)
        if (form.getValues('financialAskCents') !== total) {
          form.setValue('financialAskCents', total)
        }
      }
    })
    return () => subscription.unsubscribe()
  }, [form])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function onSubmit(values: any) {
    startTransition(async () => {
      const result = await updateTeam(team.id, values)
      if (result.error) toast.error('Failed to update: ' + result.error)
      else toast.success('Portfolio updated!')
    })
  }

  // Section nav — mirrors the sponsor-facing information architecture.
  const NAV = [
    ...(!isIncubator ? [{ id: 'section-achievements', label: 'Achievements' }] : []),
    { id: 'section-story', label: 'Story & People' },
    { id: 'section-credibility', label: 'Credibility' },
    { id: 'section-impact', label: 'Impact' },
    { id: 'section-goals', label: 'Goals & Funding' },
    { id: 'section-media', label: 'Media' },
    { id: 'section-engineering', label: 'Engineering' },
  ]

  const intInput = (field: { value?: number | null; onChange: (v?: number) => void }) => ({
    value: field.value ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value
      field.onChange(raw === '' ? undefined : Math.max(0, parseInt(raw, 10) || 0))
    },
  })

  const errorCount = Object.keys(form.formState.errors).length

  // B-03-13. This local ladder keyed on w9_document_path FIRST, so a verified team whose
  // document had been purged under retention read as "Awaiting W-9" here while the funding
  // tab called it verified. resolveW9Status is now the only place that decision is made.
  const [payoutStatus, setPayoutStatus] = useState<W9Status>('not_started')

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('team_payout_profiles')
      .select('legal_payee_name, w9_document_path, w9_uploaded_at, w9_verified_at, w9_rejected_at, w9_purged_at')
      .eq('team_id', team.id)
      // P3: .single() throws a console 406 on every load for a team with no payout
      // profile; the absence of a row is the expected state here, not an error.
      .maybeSingle()
      .then(({ data }) => setPayoutStatus(resolveW9Status(data)))
  }, [team.id])

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8 max-w-4xl">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-medium text-foreground">
              {isIncubator ? "Founder's Portfolio" : 'Team Portfolio'}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              {isIncubator
                ? 'Manage your vision, community evidence, and startup plan.'
                : 'Sponsors look at your achievements, story, and community impact first — lead with those.'}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <Button type="submit" disabled={isPending}>
                {isPending ? 'Saving…' : 'Save Changes'}
              </Button>
            </div>
            {errorCount > 0 && (
              <p className="text-[10px] text-destructive-text font-medium animate-pulse">
                Please fix {errorCount} error{errorCount > 1 ? 's' : ''} above
              </p>
            )}
          </div>
        </div>

        {/* Payout & Tax Details Status Card */}
        <div className="rounded-xl border border-border bg-card p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Payout &amp; tax details</h3>
              {/* B-04-11. These five were hand-rolled with raw Tailwind palette classes
                  while every other status badge in the app uses the --badge-* tokens.
                  Measured over --bg-surface #FFFCF7: amber-600 3.11:1 and emerald-600
                  3.68:1 both fail AA for this 12px text (and the finding measured the
                  amber one at ~2.8:1 over the composited tint). The token pairs measure
                  warning 6.32:1, success 5.24:1, pending 4.84:1, rejected 7.06:1.

                  The finding named only the amber badge; the other four are the same
                  defect in the same element and are fixed together rather than left to be
                  refiled. */}
              {payoutStatus === 'not_started' && (
                <span className="rounded-full bg-muted border border-border px-2.5 py-0.5 text-xs font-medium text-muted-foreground">Not started</span>
              )}
              {payoutStatus === 'awaiting_upload' && (
                <span className="rounded-full border px-2.5 py-0.5 text-xs font-medium bg-[var(--badge-warning-bg)] border-[var(--badge-warning-text)]/25 text-[var(--badge-warning-text)]">Awaiting W-9</span>
              )}
              {/* B-03-13. Verified, document purged. Success, not warning: the verification
                  stands and no payment is blocked — only the copy asks for a re-upload. */}
              {payoutStatus === 'verified_purged' && (
                <span className="rounded-full border px-2.5 py-0.5 text-xs font-medium bg-[var(--badge-success-bg)] border-[var(--badge-success-text)]/25 text-[var(--badge-success-text)]">Verified · re-upload requested</span>
              )}
              {payoutStatus === 'in_review' && (
                <span className="rounded-full border px-2.5 py-0.5 text-xs font-medium bg-[var(--badge-pending-bg)] border-[var(--badge-pending-text)]/25 text-[var(--badge-pending-text)]">In review</span>
              )}
              {payoutStatus === 'verified' && (
                <span className="rounded-full border px-2.5 py-0.5 text-xs font-medium bg-[var(--badge-success-bg)] border-[var(--badge-success-text)]/25 text-[var(--badge-success-text)]">Verified</span>
              )}
              {payoutStatus === 'rejected' && (
                <span className="rounded-full border px-2.5 py-0.5 text-xs font-medium bg-[var(--badge-rejected-bg)] border-[var(--badge-rejected-text)]/25 text-[var(--badge-rejected-text)]">Needs attention (rejected)</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Sponsors release funds to a verified legal payee and W-9. Keep your payee identity and W-9 up to date.
            </p>
          </div>
          <Button asChild variant="outline" size="sm" className="shrink-0">
            <Link href="/team/payout">Manage Payout Details</Link>
          </Button>
        </div>

        {/* Section navigation */}
        <nav className="sticky top-0 z-20 -mx-2 flex flex-wrap gap-1.5 rounded-xl border border-border bg-background/90 px-2 py-2 backdrop-blur-sm">
          {NAV.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="rounded-full border border-transparent px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:bg-accent hover:text-foreground"
            >
              {s.label}
            </a>
          ))}
        </nav>

        {/* Team Identity (hero data) */}
        <SectionCard id="section-identity" title="Team Identity">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <FormField control={form.control} name="teamName" render={({ field }) => (
              <FormItem>
                <FormLabel>Team Name</FormLabel>
                <FormControl><Input placeholder="e.g. Robot Knights" {...field} value={field.value ?? ''} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="organization" render={({ field }) => (
              <FormItem>
                <FormLabel>Organization / School</FormLabel>
                <FormControl><Input placeholder="e.g. Oak High School" {...field} value={field.value ?? ''} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="city" render={({ field }) => (
              <FormItem>
                <FormLabel>City</FormLabel>
                <FormControl><Input placeholder="e.g. San Jose" {...field} value={field.value ?? ''} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="state" render={({ field }) => (
              <FormItem>
                <FormLabel>State</FormLabel>
                <FormControl><Input placeholder="e.g. California" {...field} value={field.value ?? ''} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="tagline" render={({ field }) => (
              <FormItem className="col-span-1 md:col-span-2">
                <FormLabel>Tagline / Motto</FormLabel>
                <FormControl><Input placeholder="Building the future, one bolt at a time." {...field} value={field.value ?? ''} /></FormControl>
                <FormDescription>A short phrase that captures your team&apos;s spirit.</FormDescription>
                <FormMessage />
              </FormItem>
            )} />
          </div>
        </SectionCard>

        {/* 1. Achievements & Awards */}
        {!isIncubator && (
          <SectionCard
            id="section-achievements"
            title="Achievements & Awards"
            description="The first thing sponsors see. Lead with your strongest awards."
            action={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => appendAch({ season: '', eventName: '', award: '', description: '' })}
                className="h-8 text-xs gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" /> Add Achievement
              </Button>
            }
          >
            <div className="space-y-4">
              {achItems.map((field, index) => (
                <div key={field.id} className="relative grid grid-cols-1 md:grid-cols-[120px,1fr,1fr,auto] gap-3 items-end border border-border/50 rounded-lg p-4 bg-accent/5">
                  <FormField control={form.control} name={`achievements.${index}.season`} render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">Season</FormLabel>
                      <FormControl><Input placeholder="2024-25" {...field} value={field.value ?? ''} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name={`achievements.${index}.eventName`} render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">Event Name</FormLabel>
                      <FormControl><Input placeholder="Qualifying Tournament" {...field} value={field.value ?? ''} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name={`achievements.${index}.award`} render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">Award (Optional)</FormLabel>
                      <FormControl><Input placeholder="Inspire Award" {...field} value={field.value ?? ''} /></FormControl>
                    </FormItem>
                  )} />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-muted-foreground hover:text-destructive-text transition-colors"
                    onClick={() => removeAch(index)}
                  >
                    <Trash aria-hidden="true" className="h-4 w-4" />
                    <span className="sr-only">Remove budget line item</span>
                  </Button>
                  <FormField control={form.control} name={`achievements.${index}.description`} render={({ field }) => (
                    <FormItem className="col-span-1 md:col-span-3">
                      <FormLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">Description / Context</FormLabel>
                      <FormControl><Input placeholder="Briefly describe the significance…" {...field} value={field.value ?? ''} /></FormControl>
                    </FormItem>
                  )} />
                </div>
              ))}
              {achItems.length === 0 && (
                <div className="text-center py-8 border border-dashed border-border rounded-lg bg-accent/5">
                  <Trophy className="mx-auto h-6 w-6 mb-2 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground italic">No achievements listed yet. Add your first award or event experience!</p>
                </div>
              )}
            </div>
          </SectionCard>
        )}

        {/* 2. Team Story & People */}
        <SectionCard
          id="section-story"
          title="Team Story & People"
          description="Who you are, how long you've been at it, and who leads the team."
        >
          <FormField control={form.control} name="missionStatement" render={({ field }) => (
            <FormItem>
              <FormLabel>{isIncubator ? 'The "Why": Motivation' : 'Mission Statement'}</FormLabel>
              {isIncubator && (
                <FormDescription>Explain why you want to start a team in your specific community.</FormDescription>
              )}
              <FormControl>
                <RichTextEditor
                  value={field.value ?? ''}
                  onChange={field.onChange}
                  placeholder={isIncubator ? 'Our motivation is to bring STEM access to…' : 'Our objective is…'}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            <FormField control={form.control} name="foundedYear" render={({ field }) => (
              <FormItem>
                <FormLabel>Founded (year)</FormLabel>
                <FormControl><Input type="number" min={1992} max={2100} step={1} placeholder="2019" {...intInput(field)} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="teamSize" render={({ field }) => (
              <FormItem>
                <FormLabel>Team Size (students)</FormLabel>
                <FormControl><Input type="number" min={0} max={200} step={1} placeholder="12" {...intInput(field)} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="seasonsCompeted" render={({ field }) => (
              <FormItem>
                <FormLabel>Seasons Competed</FormLabel>
                <FormControl><Input type="number" min={0} max={50} step={1} placeholder="4" {...intInput(field)} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </div>
          <FormField control={form.control} name="coachExperience" render={({ field }) => (
            <FormItem>
              <FormLabel>Coach Experience</FormLabel>
              <FormDescription>Your background as a mentor — sponsors fund people they trust.</FormDescription>
              <FormControl><Textarea maxLength={1000} placeholder="e.g. 6th season mentoring FTC; mechanical engineer at…" {...field} value={field.value ?? ''} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="subteamBreakdown" render={({ field }) => (
            <FormItem>
              <FormLabel>{isIncubator ? 'Proposed Roles' : 'Subteam Breakdown'}</FormLabel>
              <FormControl><Textarea maxLength={1000} placeholder={isIncubator ? 'How will you organize your initial members?' : 'Describe your team structure…'} {...field} value={field.value ?? ''} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </SectionCard>

        {/* 3. Credibility */}
        <SectionCard
          id="section-credibility"
          title="Credibility"
          description="Proof that funding you is a safe bet: registrations, past sponsors, press, endorsements."
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <FormField control={form.control} name="taxStatus" render={({ field }) => (
              <FormItem>
                <FormLabel>Tax Status</FormLabel>
                <FormControl>
                  <select
                    {...field}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="501c3">501(c)(3) Non-profit</option>
                    <option value="School">School-based Team</option>
                    <option value="None">None / Other</option>
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div>
              <p className="text-sm font-medium text-foreground mb-1.5">FTC Registration</p>
              <p className="flex h-9 items-center rounded-md border border-border bg-accent/40 px-3 text-sm text-muted-foreground">
                {team.ftc_team_number ? `FIRST Tech Challenge Team #${team.ftc_team_number}` : 'Incubator — not yet registered'}
              </p>
            </div>
          </div>
          <FormField control={form.control} name="pastSponsors" render={({ field }) => (
            <FormItem>
              <FormLabel>Past Sponsors</FormLabel>
              <FormDescription>Companies that have backed you before. Press Enter to add each one.</FormDescription>
              <FormControl>
                <ChipInput
                  value={field.value ?? []}
                  onChange={field.onChange}
                  placeholder="e.g. Acme Robotics"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <FormLabel>Press & Recognition Links</FormLabel>
                <p className="text-[0.8rem] text-muted-foreground mt-1">News articles, school features, FIRST spotlights.</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5"
                onClick={() => appendPress({ label: '', url: '' })}
              >
                <Plus className="h-3.5 w-3.5" /> Add Link
              </Button>
            </div>
            {pressItems.map((row, index) => (
              <div key={row.id} className="grid grid-cols-1 md:grid-cols-[1fr,1.4fr,auto] gap-3 items-end border border-border/50 rounded-lg p-3 bg-accent/5">
                <FormField control={form.control} name={`pressLinks.${index}.label`} render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">Label</FormLabel>
                    <FormControl><Input placeholder="Local news feature" {...field} value={field.value ?? ''} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name={`pressLinks.${index}.url`} render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">URL</FormLabel>
                    <FormControl><Input placeholder="https://…" {...field} value={field.value ?? ''} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 text-muted-foreground hover:text-destructive-text transition-colors"
                  onClick={() => removePress(index)}
                >
                  <Trash aria-hidden="true" className="h-4 w-4" />
                  <span className="sr-only">Remove press link</span>
                </Button>
              </div>
            ))}
            {pressItems.length === 0 && (
              <div className="text-center py-5 border border-dashed border-border rounded-lg text-xs text-muted-foreground">
                No press links yet — even a school newsletter mention builds trust.
              </div>
            )}
          </div>
          <FormField control={form.control} name="communityEndorsements" render={({ field }) => (
            <FormItem>
              <FormLabel>Community Endorsements</FormLabel>
              <FormDescription>Quotes or support from principals, mentors, partner organizations.</FormDescription>
              <FormControl>
                <RichTextEditor value={field.value ?? ''} onChange={field.onChange} placeholder="&ldquo;This team transformed our after-school program…&rdquo; — Principal, Oak High" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </SectionCard>

        {/* 4. Community & Ethics Impact */}
        <SectionCard
          id="section-impact"
          title="Community & Ethics Impact"
          description="Sponsors fund outcomes. Quantify who you reach beyond the competition field."
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            <FormField control={form.control} name="studentsReached" render={({ field }) => (
              <FormItem>
                <FormLabel>Students Reached</FormLabel>
                <FormControl><Input type="number" min={0} step={1} placeholder="350" {...intInput(field)} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="eventsHosted" render={({ field }) => (
              <FormItem>
                <FormLabel>Events Hosted</FormLabel>
                <FormControl><Input type="number" min={0} step={1} placeholder="6" {...intInput(field)} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="volunteerHours" render={({ field }) => (
              <FormItem>
                <FormLabel>Volunteer Hours</FormLabel>
                <FormControl><Input type="number" min={0} step={1} placeholder="240" {...intInput(field)} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </div>
          <FormField control={form.control} name="outreachSummary" render={({ field }) => (
            <FormItem>
              <FormLabel>Outreach Summary</FormLabel>
              <FormControl><RichTextEditor value={field.value ?? ''} onChange={field.onChange} placeholder="Workshops run, teams mentored, communities served…" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          {isIncubator && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-5">
              <div className="flex items-center gap-2 text-primary">
                <Sparkles className="h-4 w-4" />
                <p className="text-xs font-semibold uppercase tracking-widest">Incubator evidence</p>
              </div>
              <FormField control={form.control} name="communityInterestText" render={({ field }) => (
                <FormItem>
                  <FormLabel>Evidence of Community Interest</FormLabel>
                  <FormDescription>Describe local support, waitlists, or school buy-in.</FormDescription>
                  <FormControl>
                    <Textarea className="min-h-[100px]" placeholder="We have local parents and the PTA supportive of…" {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="studentInterestCount" render={({ field }) => (
                <FormItem>
                  <FormLabel>Student Interest Count</FormLabel>
                  <FormDescription>How many students are committed to joining?</FormDescription>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      {...field}
                      value={field.value === 0 ? '' : field.value}
                      onChange={e => field.onChange(e.target.value === '' ? 0 : parseInt(e.target.value) || 0)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
          )}
        </SectionCard>

        {/* 5. Goals & Funding Ask */}
        <SectionCard
          id="section-goals"
          title="Goals & Funding Ask"
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => {
                const current = form.getValues('budgetItems') || []
                form.setValue('budgetItems', [...current, { label: '', qty: 1, unitCostCents: 0, totalCents: 0 }])
              }}
            >
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              Add Item
            </Button>
          }
        >
          <div className="space-y-4">
            <FormField control={form.control} name="budgetItems" render={({ field }) => (
              <div className="space-y-3">
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {(field.value || []).map((item: any, index: number) => (
                  <div key={index} className="grid grid-cols-12 gap-3 items-end bg-accent/50 p-3 rounded-lg border border-border/50">
                    <div className="col-span-6">
                      <FormLabel className="text-[10px] uppercase text-muted-foreground">Item</FormLabel>
                      <Input
                        placeholder="e.g. REV Control Hub"
                        className="h-8 text-sm"
                        value={item.label}
                        onChange={e => {
                          const newItems = [...field.value]
                          newItems[index].label = e.target.value
                          field.onChange(newItems)
                        }}
                      />
                    </div>
                    <div className="col-span-2">
                      <FormLabel className="text-[10px] uppercase text-muted-foreground">Qty</FormLabel>
                      <Input
                        type="number"
                        className="h-8 text-sm"
                        value={item.qty === 0 ? '' : item.qty}
                        onChange={e => {
                          const newItems = [...field.value]
                          const qty = e.target.value === '' ? 0 : parseInt(e.target.value) || 0
                          newItems[index].qty = qty
                          newItems[index].totalCents = qty * newItems[index].unitCostCents
                          field.onChange(newItems)
                        }}
                      />
                    </div>
                    <div className="col-span-3">
                      <FormLabel className="text-[10px] uppercase text-muted-foreground">Cost ($)</FormLabel>
                      <Input
                        type="number"
                        className="h-8 text-sm"
                        value={item.unitCostCents === 0 ? '' : item.unitCostCents / 100}
                        onChange={e => {
                          const newItems = [...field.value]
                          const cost = e.target.value === '' ? 0 : Math.round(parseFloat(e.target.value) * 100) || 0
                          newItems[index].unitCostCents = cost
                          newItems[index].totalCents = newItems[index].qty * cost
                          field.onChange(newItems)
                        }}
                      />
                    </div>
                    <div className="col-span-1 flex justify-center">
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-destructive-text transition-colors"
                        onClick={() => {
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          const newItems = field.value.filter((_: any, i: number) => i !== index)
                          field.onChange(newItems)
                        }}
                      >
                        <Trash aria-hidden="true" className="h-4 w-4" />
                        <span className="sr-only">Remove image</span>
                      </button>
                    </div>
                  </div>
                ))}
                {(!field.value || field.value.length === 0) && (
                  <div className="text-center py-6 border border-dashed border-border rounded-lg text-xs text-muted-foreground">
                    No budget items yet. Add one to request funding.
                  </div>
                )}
              </div>
            )} />

            <div className="flex items-center justify-between pt-2 border-t border-border">
              <span className="text-sm font-medium text-foreground">Total Request</span>
              <span className="text-lg font-bold text-foreground">
                ${formatMoneyAmount((form.watch('financialAskCents') || 0))}
              </span>
            </div>
          </div>

          <FormField control={form.control} name="sustainabilityPlan" render={({ field }) => (
            <FormItem>
              <FormLabel>Sustainability Plan{isIncubator ? '' : ' (Optional)'}</FormLabel>
              <FormDescription>How the team keeps running after this season&apos;s funding.</FormDescription>
              <FormControl>
                <Textarea className="min-h-[100px]" placeholder="Our plan for year 2 and beyond is…" {...field} value={field.value ?? ''} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />

          {isIncubator && (
            <FormField control={form.control} name="seedFundingGoalsCents" render={({ field }) => (
              <FormItem>
                <FormLabel>Seed Funding Goal ($)</FormLabel>
                <FormDescription>How much total funding do you need to launch?</FormDescription>
                <FormControl>
                  <Input
                    type="number"
                    min={0}
                    {...field}
                    value={field.value === 0 ? '' : field.value / 100}
                    onChange={e => {
                      const val = e.target.value === '' ? 0 : Math.round(parseFloat(e.target.value) * 100) || 0
                      field.onChange(val)
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
          )}
        </SectionCard>

        {/* 6. Media */}
        <SectionCard
          id="section-media"
          title={isIncubator ? 'Concept & Community Media' : 'Media'}
          action={
            <label className="cursor-pointer inline-flex items-center gap-2 rounded-md border border-border bg-accent px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent/80 transition-colors">
              <Upload className="h-3.5 w-3.5" /> Browse
              <input type="file" className="hidden" accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={handleUpload} />
            </label>
          }
        >
          <div
            onDragOver={e => { e.preventDefault(); setDraggingOver(true) }}
            onDragLeave={() => setDraggingOver(false)}
            onDrop={handleDrop}
            className={cn(
              'relative rounded-xl border-2 border-dashed transition-all duration-200 overflow-hidden',
              draggingOver ? 'border-primary bg-primary/5 scale-[1.01]' : 'border-border bg-background/40',
              visualItems.length === 0 ? 'min-h-[160px] flex items-center justify-center' : ''
            )}
          >
            {visualItems.length === 0 ? (
              <div className="text-center py-12 px-6 pointer-events-none">
                <ImageIcon className="mx-auto h-8 w-8 mb-3 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">Drop images here or click Browse above</p>
                <p className="text-xs text-muted-foreground mt-1">PNG, JPG, WebP, GIF up to 5 MB each</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3">
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {visualItems.map((item: any, index) => (
                  <div key={item.id} className="relative rounded-lg overflow-hidden border border-border bg-accent/50 aspect-video group">
                    <Image src={item.url} alt={`Slide ${index + 1}`} fill className="object-cover" />
                    <div className="absolute inset-0 bg-black/60 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 flex flex-col justify-between p-2.5">
                      <button type="button" onClick={() => removeVisual(index)} className="self-end p-1.5 bg-red-500/20 text-red-300 rounded hover:bg-red-500/40 transition-colors">
                        <Trash aria-hidden="true" className="h-3.5 w-3.5" />
                        <span className="sr-only">Remove visual pitch item</span>
                      </button>
                      <FormField control={form.control} name={`visualPitchItems.${index}.caption`} render={({ field }) => (
                        <FormControl><Input className="bg-background/80 border-none text-xs h-8 placeholder:text-muted-foreground text-foreground" placeholder="Add caption…" {...field} value={field.value ?? ''} /></FormControl>
                      )} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* Gates these photos into sponsor CSR impact reports. Fail closed: without the
              affirmation they appear in no report. */}
          <MediaAffirmation
            teamId={team.id}
            confirmedAt={(team as { media_no_minors_confirmed_at?: string | null }).media_no_minors_confirmed_at ?? null}
          />
          <FormField control={form.control} name="youtubeUrl" render={({ field }) => (
            <FormItem>
              <FormLabel>YouTube Video (Optional)</FormLabel>
              <FormDescription>A team intro or season recap video on youtube.com or youtu.be.</FormDescription>
              <FormControl><Input placeholder="https://youtube.com/watch?v=…" {...field} value={field.value ?? ''} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </SectionCard>

        {/* 7. Robot & Engineering — slim, optional, collapsed */}
        <div id="section-engineering" className="scroll-mt-28 rounded-xl border border-border/70 bg-card/60 p-6">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-4 text-left"
            onClick={() => setEngineeringOpen(o => !o)}
            aria-expanded={engineeringOpen}
          >
            <div className="flex items-start gap-3">
              <Wrench className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                  Robot &amp; Engineering <span className="ml-1 font-normal normal-case tracking-normal text-muted-foreground">(optional)</span>
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Sponsors rarely ask — add it if you&apos;re proud of it.
                </p>
              </div>
            </div>
            <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', engineeringOpen && 'rotate-180')} />
          </button>
          {engineeringOpen && (
            <div className="mt-5 space-y-5 border-t border-border pt-5">
              <FormField control={form.control} name="technicalSummary" render={({ field }) => (
                <FormItem>
                  <FormLabel>Technical Summary</FormLabel>
                  <FormDescription>One short overview of your robot and engineering approach.</FormDescription>
                  <FormControl><RichTextEditor value={field.value ?? ''} onChange={field.onChange} placeholder="An overview of your technical strategy…" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="githubLink" render={({ field }) => (
                <FormItem>
                  <FormLabel>GitHub Link</FormLabel>
                  <FormControl><Input placeholder="https://github.com/your-team" {...field} value={field.value ?? ''} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
          )}
        </div>

        <div className="flex justify-end pt-4">
          <Button type="submit" disabled={isPending} className="px-8 h-11 bg-primary hover:bg-primary-hover text-primary-foreground font-semibold shadow-sm">
            {isPending ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
        <ImageCropperDialog
          open={pitchCropperOpen}
          onOpenChange={setPitchCropperOpen}
          file={pendingPitchFile}
          aspect={16 / 9}
          onConfirm={handlePitchCropConfirm}
        />
      </form>
    </Form>
  )
}
