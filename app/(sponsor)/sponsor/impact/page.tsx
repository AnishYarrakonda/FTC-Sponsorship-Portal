import { getAuthedProfile } from '@/lib/actions-utils'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { FileBarChart } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatTransactionDate } from '@/lib/format-dates'
import type { SponsorImpactPayload } from '@/lib/impact-report/build'

/**
 * Year index. Reads stored snapshots only — opening this page must never regenerate one.
 * A GET that mutates turns every crawler into a rewrite of the record.
 *
 * No sponsor_id filter: impact_snapshots_select_sponsor scopes by current_sponsor_ids(),
 * so a member of two sponsor orgs correctly sees both.
 */
export const dynamic = 'force-dynamic'

export default async function SponsorImpactIndexPage() {
  const authed = await getAuthedProfile()
  if (!authed) redirect('/login')
  const { supabase, user } = authed

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'sponsor') redirect('/dashboard')

  const { data: snapshots } = await supabase
    .from('impact_report_snapshots')
    .select('id, report_year, status, generated_at, payload')
    .eq('scope', 'sponsor')
    .order('report_year', { ascending: false })

  const rows = (snapshots ?? []) as any[]

  if (rows.length === 0) {
    return (
      <EmptyState
        className="py-20"
        icon={FileBarChart}
        title="No impact report yet"
        description="A report is generated for each year in which you commit funding. The first one appears the night after your first sponsorship settles."
        action={
          <Link href="/sponsor/submissions" className={cn(buttonVariants({ variant: 'outline' }))}>
            Review pitches
          </Link>
        }
      />
    )
  }

  const money = (cents: number) =>
    `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Impact reports</h1>
        <p className="text-sm text-muted-foreground">
          A year-by-year record of what you funded and what reached the teams. Open a report to
          print it or save it as a PDF.
        </p>
      </div>

      {rows.map((row) => {
        const payload = row.payload as SponsorImpactPayload
        return (
          <Card key={row.id}>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle className="text-base">{row.report_year}</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  {payload?.totals?.teams_supported ?? 0} team
                  {(payload?.totals?.teams_supported ?? 0) === 1 ? '' : 's'} ·{' '}
                  {money(payload?.totals?.pledged_cents ?? 0)} pledged ·{' '}
                  {money(payload?.totals?.received_cents ?? 0)} received
                </p>
              </div>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[11px]',
                  row.status === 'closed'
                    ? 'bg-muted text-muted-foreground'
                    : 'bg-blue-500/10 text-blue-700 dark:text-blue-300'
                )}
              >
                {row.status === 'closed' ? 'Final' : 'Open'}
              </span>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              <Link
                href={`/sponsor/impact/${row.report_year}`}
                className={cn(buttonVariants({ variant: 'default', size: 'sm' }))}
              >
                View report
              </Link>
              <a
                href={`/api/sponsor/impact-report?year=${row.report_year}&format=csv`}
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
              >
                Download CSV
              </a>
              {/* A-12-06. The raw, COPPA-cleared assets behind the report, so a marketing
                  team can build their own materials instead of cropping a rendered page.
                  Ships a manifest.csv naming the team behind each file and restating the
                  no-identifiable-minors affirmation the images were cleared under. */}
              <a
                href={`/api/sponsor/impact-report?year=${row.report_year}&format=assets`}
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
              >
                Download assets (ZIP)
              </a>
              <span className="text-xs text-muted-foreground">
                Figures as of {formatTransactionDate(row.generated_at)}
              </span>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
