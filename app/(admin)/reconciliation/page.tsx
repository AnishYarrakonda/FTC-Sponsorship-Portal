import { getAuthedProfile } from '@/lib/actions-utils'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ReconciliationTable } from '@/components/admin/reconciliation-table'
import { ageInDays, agingBucket } from '@/lib/fulfillment-aging'
import { FULFILLMENT_STATUSES, FulfillmentStatus } from '@/lib/fulfillment-status'
import { Card, CardContent } from '@/components/ui/card'

export const dynamic = 'force-dynamic'

export default async function ReconciliationPage() {
  const authed = await getAuthedProfile()
  if (!authed) redirect('/login')

  if (authed.user.role !== 'admin') {
    if (authed.user.role === 'coach') redirect('/dashboard?redirected=admin')
    if (authed.user.role === 'sponsor') redirect('/sponsor/dashboard?redirected=admin')
    redirect('/')
  }

  // Use the RLS-respecting server client so preview mode works and Guardrail 4 is honoured
  const supabase = await createClient()

  // If this ever exceeds a few thousand rows, move the totals into a view.
  const { data: fulfillments } = await supabase
    .from('funding_fulfillments')
    .select(`
      *,
      sponsors(company_name),
      teams(team_name, ftc_team_number),
      funding_fulfillment_events(*)
    `)
    .order('pledged_at', { ascending: true })

  const allFulfillments = fulfillments || []

  // Per-status aggregations
  const statsByStatus: Record<FulfillmentStatus, { count: number; sumCents: number }> = {
    pledged: { count: 0, sumCents: 0 },
    agreement_signed: { count: 0, sumCents: 0 },
    payment_sent: { count: 0, sumCents: 0 },
    payment_received: { count: 0, sumCents: 0 },
    receipted: { count: 0, sumCents: 0 },
    cancelled: { count: 0, sumCents: 0 },
  }

  let totalPledgedCents = 0 // Everything ever committed, excluding cancelled
  let totalReceivedCents = 0 // payment_received + receipted
  let totalReceiptedCents = 0 // receipted only

  const buckets = {
    on_track: [] as any[],
    aging: [] as any[],
    stale: [] as any[],
    escalate: [] as any[],
  }

  allFulfillments.forEach((f: any) => {
    const status = f.status as FulfillmentStatus
    if (statsByStatus[status]) {
      statsByStatus[status].count++
      statsByStatus[status].sumCents += f.amount_cents
    }

    if (status !== 'cancelled') {
      totalPledgedCents += f.amount_cents
    }
    if (status === 'payment_received' || status === 'receipted') {
      totalReceivedCents += f.amount_cents
    }
    if (status === 'receipted') {
      totalReceiptedCents += f.amount_cents
    }

    // Aging report: open fulfillments sorted oldest first
    if (status !== 'cancelled' && status !== 'receipted') {
      const age = ageInDays(f)
      const b = agingBucket(age)
      buckets[b].push(f)
    }
  })

  // Sort open rows within buckets oldest first
  Object.values(buckets).forEach(arr => {
    arr.sort((a, b) => ageInDays(b) - ageInDays(a))
  })

  const receivedPct = totalPledgedCents > 0 ? Math.round((totalReceivedCents / totalPledgedCents) * 100) : 0

  return (
    <div className="space-y-8 p-6 md:p-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Fulfillment Reconciliation</h1>
        <p className="text-muted-foreground mt-1">Monitor money movement between sponsors and teams.</p>
      </div>

      {/* Headline Triple */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="p-6">
            <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Pledged Volume (Excl. Cancelled)</div>
            <div className="text-3xl font-bold mt-2">${(totalPledgedCents / 100).toLocaleString()}</div>
            <div className="text-xs text-muted-foreground mt-1">Total money committed by sponsors</div>
          </CardContent>
        </Card>
        <Card className="bg-emerald-500/5 border-emerald-500/20">
          <CardContent className="p-6">
            <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Received Volume</div>
            <div className="text-3xl font-bold text-emerald-600 dark:text-emerald-400 mt-2">${(totalReceivedCents / 100).toLocaleString()}</div>
            <div className="text-xs text-muted-foreground mt-1">{receivedPct}% of total pledged</div>
          </CardContent>
        </Card>
        <Card className="bg-blue-500/5 border-blue-500/20">
          <CardContent className="p-6">
            <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Receipted Volume</div>
            <div className="text-3xl font-bold text-blue-600 dark:text-blue-400 mt-2">${(totalReceiptedCents / 100).toLocaleString()}</div>
            <div className="text-xs text-muted-foreground mt-1">Official acknowledgment issued</div>
          </CardContent>
        </Card>
      </div>

      {/* Breakdown per Status */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        {FULFILLMENT_STATUSES.map(s => (
          <Card key={s} className="shadow-xs">
            <CardContent className="p-4">
              <div className="text-[11px] font-mono uppercase text-muted-foreground truncate">{s.replace('_', ' ')}</div>
              <div className="text-xl font-semibold mt-1">${(statsByStatus[s].sumCents / 100).toLocaleString()}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{statsByStatus[s].count} item{statsByStatus[s].count !== 1 ? 's' : ''}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Aging Report Sections */}
      <div className="space-y-6">
        <h2 className="text-xl font-semibold tracking-tight">Aging Report</h2>
        <ReconciliationTable title="Escalate (60+ days)" fulfillments={buckets.escalate} tone="destructive" />
        <ReconciliationTable title="Stale (30–59 days)" fulfillments={buckets.stale} tone="warning" />
        <ReconciliationTable title="Aging (14–29 days)" fulfillments={buckets.aging} tone="warning" />
        <ReconciliationTable title="On Track (0–13 days)" fulfillments={buckets.on_track} tone="success" />
      </div>
    </div>
  )
}

