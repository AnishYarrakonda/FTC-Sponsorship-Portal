'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CalendarRange } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { setFiscalYearStartMonth } from '@/app/actions/sponsor-finance'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/**
 * A-12-04. When this company's fiscal year begins.
 *
 * The copy is explicit that this is a reporting boundary and NOT a budget reset, because
 * "fiscal year" in a finance UI strongly implies the latter. Migration 0110 explains why a
 * second per-year budget was deliberately not introduced: `funding_cap_cents` is the
 * enforcement point for capacity integrity, and two numbers that can disagree is worse
 * than one number that is plainly labelled.
 */
export function FiscalYearCard({ fiscalYearStartMonth }: { fiscalYearStartMonth: number }) {
  const router = useRouter()
  const [month, setMonth] = useState(fiscalYearStartMonth)
  const [isPending, startTransition] = useTransition()

  function handleSave() {
    startTransition(async () => {
      const result = await setFiscalYearStartMonth({ fiscalYearStartMonth: month })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Fiscal year updated')
      router.refresh()
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarRange className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Fiscal year
        </CardTitle>
        <CardDescription>
          Groups your CSR impact reporting into your company&apos;s financial year rather than the
          calendar year. This does <strong>not</strong> reset your funding budget — your cap is
          managed with your platform administrator.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="fiscal-year-start">Our fiscal year starts in</Label>
          <select
            id="fiscal-year-start"
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {MONTHS.map((label, i) => (
              <option key={label} value={i + 1}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {/*
          Named, not just "Save". This card landed on /sponsor/settings next to the approval
          policy card, which already had a "Save" — leaving both generic gives a screen-reader
          user two identical button names on one page with nothing to tell them apart, and the
          visible label no longer matches the accessible name for voice control (WCAG 2.4.6,
          2.5.3). The visible text stays short; the accessible name carries the distinction.
        */}
        <Button
          onClick={handleSave}
          disabled={isPending || month === fiscalYearStartMonth}
          aria-label="Save fiscal year"
        >
          {isPending ? 'Saving…' : 'Save'}
        </Button>
      </CardContent>
    </Card>
  )
}
