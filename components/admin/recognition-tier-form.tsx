'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import {
  adminArchiveRecognitionTier,
  adminUpsertRecognitionTier,
} from '@/app/actions/recognition'
import {
  RECOGNITION_BENEFIT_TYPES,
  formatTierRange,
  recognitionBenefitLabel,
  type RecognitionBenefitType,
} from '@/lib/recognition'

export interface AdminTierRow {
  id: string
  name: string
  rank: number
  min_amount_cents: number
  max_amount_cents: number | null
  benefits: string[]
  description: string | null
  archived_at: string | null
}

/** Dollars in the form, cents on the wire — every money column in this schema is cents. */
function toCents(dollars: string): number {
  return Math.round(Number(dollars || '0') * 100)
}
function toDollars(cents: number | null): string {
  return cents == null ? '' : String(cents / 100)
}

function blankDraft(nextRank: number) {
  return {
    tierId: undefined as string | undefined,
    name: '',
    rank: String(nextRank),
    min: '',
    max: '',
    benefits: [] as RecognitionBenefitType[],
    description: '',
  }
}

export function RecognitionTierEditor({ tiers }: { tiers: AdminTierRow[] }) {
  const live = tiers.filter((t) => !t.archived_at)
  const [draft, setDraft] = useState(() => blankDraft(live.length))
  const [pending, startTransition] = useTransition()

  const edit = (t: AdminTierRow) =>
    setDraft({
      tierId: t.id,
      name: t.name,
      rank: String(t.rank),
      min: toDollars(t.min_amount_cents),
      max: toDollars(t.max_amount_cents),
      benefits: t.benefits.filter((b): b is RecognitionBenefitType =>
        (RECOGNITION_BENEFIT_TYPES as readonly string[]).includes(b)
      ),
      description: t.description ?? '',
    })

  const save = () =>
    startTransition(async () => {
      const res = await adminUpsertRecognitionTier({
        tierId: draft.tierId,
        name: draft.name.trim(),
        rank: Number(draft.rank || '0'),
        minAmountCents: toCents(draft.min),
        // An empty upper bound means open-ended, not zero.
        maxAmountCents: draft.max.trim() === '' ? null : toCents(draft.max),
        benefits: draft.benefits,
        description: draft.description.trim() || undefined,
      })
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success(draft.tierId ? 'Tier updated.' : 'Tier created.')
      setDraft(blankDraft(live.length + (draft.tierId ? 0 : 1)))
    })

  const archive = (id: string) =>
    startTransition(async () => {
      const res = await adminArchiveRecognitionTier({ tierId: id })
      if (res.error) toast.error(res.error)
      else toast.success('Tier archived. Recognition already promised is unaffected.')
    })

  return (
    <div className="space-y-6">
      {/* This sentence is the user-visible contract for the snapshot design. Do not
          remove it: it is the only place the product explains why editing a threshold is
          safe. */}
      <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm">
        <p className="font-medium">Editing a tier changes what future sponsorships earn.</p>
        <p className="mt-1 text-muted-foreground">
          Recognition already promised to a sponsor is frozen at the moment their sponsorship
          settled and will not change.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ladder</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-widest text-muted-foreground">
                <th className="pb-2 pr-3 font-medium">Rank</th>
                <th className="pb-2 pr-3 font-medium">Name</th>
                <th className="pb-2 pr-3 font-medium">Range</th>
                <th className="pb-2 pr-3 font-medium">Benefits</th>
                <th className="pb-2 pr-3 font-medium">State</th>
                <th className="pb-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {tiers.map((t) => (
                <tr key={t.id} className="border-b border-border/60 align-top">
                  <td className="py-3 pr-3 tabular-nums">{t.rank}</td>
                  <td className="py-3 pr-3 font-medium">{t.name}</td>
                  <td className="py-3 pr-3 tabular-nums">
                    {formatTierRange(t.min_amount_cents, t.max_amount_cents)}
                  </td>
                  <td className="py-3 pr-3">
                    <div className="flex flex-wrap gap-1">
                      {t.benefits.map((b) => (
                        <span key={b} className="rounded-full bg-muted px-2 py-0.5 text-[11px]">
                          {(RECOGNITION_BENEFIT_TYPES as readonly string[]).includes(b)
                            ? recognitionBenefitLabel(b as RecognitionBenefitType)
                            : b}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-3 pr-3">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[11px]',
                        t.archived_at
                          ? 'bg-muted text-muted-foreground'
                          : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      )}
                    >
                      {t.archived_at ? 'Archived' : 'Live'}
                    </span>
                  </td>
                  <td className="py-3 text-right whitespace-nowrap">
                    {!t.archived_at && (
                      <>
                        <Button size="sm" variant="ghost" disabled={pending} onClick={() => edit(t)}>
                          Edit
                        </Button>
                        <Button size="sm" variant="ghost" disabled={pending} onClick={() => archive(t.id)}>
                          Archive
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{draft.tierId ? 'Edit tier' : 'New tier'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tier-name">Name</Label>
              <Input
                id="tier-name"
                value={draft.name}
                maxLength={60}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tier-rank">Rank</Label>
              <Input
                id="tier-rank"
                type="number"
                min={0}
                value={draft.rank}
                onChange={(e) => setDraft({ ...draft, rank: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tier-min">Minimum ($)</Label>
              <Input
                id="tier-min"
                type="number"
                min={0}
                value={draft.min}
                onChange={(e) => setDraft({ ...draft, min: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tier-max">Upper bound ($)</Label>
              <Input
                id="tier-max"
                type="number"
                min={0}
                placeholder="Leave blank for the top tier"
                value={draft.max}
                onChange={(e) => setDraft({ ...draft, max: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Exclusive: a sponsorship at exactly this amount lands in the next tier up.
              </p>
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Benefits</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {RECOGNITION_BENEFIT_TYPES.map((b) => (
                <label key={b} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-border"
                    checked={draft.benefits.includes(b)}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        benefits: e.target.checked
                          ? [...draft.benefits, b]
                          : draft.benefits.filter((x) => x !== b),
                      })
                    }
                  />
                  {recognitionBenefitLabel(b)}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="tier-desc">Description</Label>
            <Input
              id="tier-desc"
              value={draft.description}
              maxLength={500}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </div>

          <div className="flex gap-2">
            <Button disabled={pending || !draft.name.trim()} onClick={save}>
              {pending ? 'Saving…' : draft.tierId ? 'Save tier' : 'Create tier'}
            </Button>
            {draft.tierId && (
              <Button variant="ghost" disabled={pending} onClick={() => setDraft(blankDraft(live.length))}>
                Cancel
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
