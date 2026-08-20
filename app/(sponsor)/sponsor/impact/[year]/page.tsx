import { getAuthedProfile } from '@/lib/actions-utils'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ImpactReportView } from '@/components/impact/impact-report-view'
import { PrintButton } from '@/components/impact/print-button'
import type { SponsorImpactPayload } from '@/lib/impact-report/build'

/** Renders the STORED snapshot. It does not regenerate — a page view is never a write. */
export const dynamic = 'force-dynamic'

export default async function SponsorImpactReportPage({
  params,
}: {
  params: Promise<{ year: string }>
}) {
  const { year: yearParam } = await params
  const year = Number(yearParam)
  if (!Number.isInteger(year) || year < 2000 || year > 2100) notFound()

  const authed = await getAuthedProfile()
  if (!authed) redirect('/login')
  const { supabase, user } = authed

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'sponsor') redirect('/dashboard')

  const { data: snapshot } = await supabase
    .from('impact_report_snapshots')
    .select('id, report_year, status, generated_at, payload')
    .eq('scope', 'sponsor')
    .eq('report_year', year)
    .maybeSingle()

  if (!snapshot) notFound()

  const payload = snapshot.payload as unknown as SponsorImpactPayload

  return (
    <div className="space-y-6">
      <div data-print-hide className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/sponsor/impact"
          className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
        >
          ← All reports
        </Link>
        <div className="flex items-center gap-2">
          <a
            href={`/api/sponsor/impact-report?year=${year}&format=csv`}
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
          >
            Download CSV
          </a>
          <PrintButton />
        </div>
      </div>

      {snapshot.status === 'open' && (
        <p data-print-hide className="text-sm text-muted-foreground">
          Figures as of {new Date(snapshot.generated_at as string).toLocaleString('en-US')}. This
          year is still open and will be finalised in January.
        </p>
      )}

      <ImpactReportView payload={payload} />
    </div>
  )
}
