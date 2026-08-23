'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import {
  closeImpactYear,
  regenerateImpactSnapshot,
  reopenImpactYear,
} from '@/app/actions/impact'

export interface AdminSnapshotRow {
  id: string
  scope: string
  sponsor_id: string | null
  company_name: string | null
  report_year: number
  status: string
  generated_at: string
  teams: number
  pledged_cents: number
  received_cents: number
}

export function ImpactConsole({
  rows,
  years,
  currentYear,
}: {
  rows: AdminSnapshotRow[]
  years: number[]
  currentYear: number
}) {
  const [pending, startTransition] = useTransition()
  const [reopenReason, setReopenReason] = useState('')
  const [reopenYear, setReopenYear] = useState(String(currentYear - 1))

  const money = (cents: number) =>
    `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`

  const run = (fn: () => Promise<{ success?: true; error?: string }>, ok: string) =>
    startTransition(async () => {
      const res = await fn()
      if (res.error) toast.error(res.error)
      else toast.success(ok)
    })

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Year controls</CardTitle>
          <p className="text-sm text-muted-foreground">
            Closing a year freezes every snapshot in it. A closed report never changes underneath
            the person who downloaded it — regeneration is refused at the database, not just here.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                run(
                  () => regenerateImpactSnapshot({ scope: 'platform', year: currentYear }),
                  `Platform aggregate for ${currentYear} regenerated.`
                )
              }
            >
              Regenerate {currentYear} platform aggregate
            </Button>
            <a
              href={`/api/admin/impact-report?year=${currentYear}&format=csv`}
              className="text-sm underline underline-offset-4"
            >
              Download platform CSV
            </a>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            {years.map((y) => (
              <Button
                key={y}
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => run(() => closeImpactYear({ year: y }), `${y} closed.`)}
              >
                Close {y}
              </Button>
            ))}
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <div className="w-28">
              <label className="text-xs text-muted-foreground" htmlFor="reopen-year">
                Reopen year
              </label>
              <Input
                id="reopen-year"
                type="number"
                value={reopenYear}
                onChange={(e) => setReopenYear(e.target.value)}
              />
            </div>
            {/* A-08-03: placeholder-only, and it sits beside a labelled year field, so
                a screen reader announced two adjacent inputs with only one name. */}
            <Input
              className="max-w-sm"
              aria-label="Reason for reopening the year (recorded in the audit log)"
              placeholder="Reason (min 10 characters) — recorded in the audit log"
              value={reopenReason}
              onChange={(e) => setReopenReason(e.target.value)}
            />
            <Button
              size="sm"
              variant="destructive"
              disabled={pending || reopenReason.trim().length < 10}
              onClick={() =>
                run(
                  () => reopenImpactYear({ year: Number(reopenYear), reason: reopenReason }),
                  `${reopenYear} reopened.`
                )
              }
            >
              Reopen
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Snapshots</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No snapshots yet. The nightly rollup creates one per sponsor with funding in the
              year, or regenerate the platform aggregate above.
            </p>
          ) : (
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-widest text-muted-foreground">
                  <th className="pb-2 pr-3 font-medium">Year</th>
                  <th className="pb-2 pr-3 font-medium">Scope</th>
                  <th className="pb-2 pr-3 font-medium">Teams</th>
                  <th className="pb-2 pr-3 font-medium">Pledged</th>
                  <th className="pb-2 pr-3 font-medium">Received</th>
                  <th className="pb-2 pr-3 font-medium">Generated</th>
                  <th className="pb-2 pr-3 font-medium">State</th>
                  <th className="pb-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-border/60">
                    <td className="py-3 pr-3 tabular-nums">{row.report_year}</td>
                    <td className="py-3 pr-3">{row.company_name ?? 'Platform aggregate'}</td>
                    <td className="py-3 pr-3 tabular-nums">{row.teams}</td>
                    <td className="py-3 pr-3 tabular-nums">{money(row.pledged_cents)}</td>
                    <td className="py-3 pr-3 tabular-nums">{money(row.received_cents)}</td>
                    <td className="py-3 pr-3 text-muted-foreground">
                      {new Date(row.generated_at).toLocaleDateString('en-US')}
                    </td>
                    <td className="py-3 pr-3">
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[11px]',
                          row.status === 'closed'
                            ? 'bg-muted text-muted-foreground'
                            : 'bg-blue-500/10 text-blue-700 dark:text-blue-300'
                        )}
                      >
                        {row.status === 'closed' ? 'Closed' : 'Open'}
                      </span>
                    </td>
                    <td className="py-3 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending || row.status === 'closed'}
                        onClick={() =>
                          run(
                            () =>
                              regenerateImpactSnapshot({
                                scope: row.scope === 'sponsor' ? 'sponsor' : 'platform',
                                sponsorId: row.sponsor_id ?? undefined,
                                year: row.report_year,
                              }),
                            'Snapshot regenerated.'
                          )
                        }
                      >
                        Regenerate
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
