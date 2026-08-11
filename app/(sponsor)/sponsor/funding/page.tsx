import { getAuthedProfile } from '@/lib/actions-utils'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { TrendingUp, Wallet, Building2, FileText } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { fulfillmentStatusLabel, canTransition } from '@/lib/fulfillment-status'
import { StatusBadge } from '@/components/ui/status-badge'
import { MarkPaymentSentDialog } from '@/components/sponsor/mark-payment-sent-dialog'
import { SponsorFulfillmentRow } from '@/components/sponsor/sponsor-fulfillment-row'
import { ageInDays } from '@/lib/fulfillment-aging'

export default async function SponsorFundingPage() {
  const authed = await getAuthedProfile()
  if (!authed) redirect('/login')
  const { supabase, user } = authed

  const { data: profile } = await supabase
    .from('profiles')
    .select('sponsor_id, sponsors(*)')
    .eq('id', user.id)
    .single()

  if (!profile?.sponsor_id) redirect('/dashboard')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sponsor = (profile as any)?.sponsors ?? null

  if (!sponsor) {
    return (
      <EmptyState
        className="py-20"
        icon={Building2}
        title="No funding account"
        description="Could not find a linked sponsor record for your account. Please contact an administrator."
      />
    )
  }

  const { data: fulfillments } = await supabase
    .from('funding_fulfillments')
    .select('*, teams(team_name, ftc_team_number), funding_receipts(receipt_number)')
    .eq('sponsor_id', profile.sponsor_id)
    .order('pledged_at', { ascending: false })

  const { data: receipts } = await supabase
    .from('funding_receipts')
    .select('*, teams(team_name)')
    .eq('sponsor_id', profile.sponsor_id)
    .order('issued_at', { ascending: false })

  let totalCommitted = 0
  let awaitingPaymentCount = 0
  let awaitingPaymentSum = 0
  let inTransitCount = 0
  let inTransitSum = 0
  let confirmedCount = 0
  let confirmedSum = 0

  fulfillments?.forEach(f => {
    if (f.status !== 'cancelled') {
      totalCommitted += f.amount_cents
    }
    if (f.status === 'pledged' || f.status === 'agreement_signed') {
      awaitingPaymentCount++
      awaitingPaymentSum += f.amount_cents
    }
    if (f.status === 'payment_sent') {
      inTransitCount++
      inTransitSum += f.amount_cents
    }
    if (f.status === 'payment_received' || f.status === 'receipted') {
      confirmedCount++
      confirmedSum += f.amount_cents
    }
  })

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Funding</h1>
        <p className="text-muted-foreground mt-1">Track your approved sponsorships and disbursements.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-widest">Total Committed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">${(totalCommitted / 100).toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">Across all teams, all time</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-widest">Awaiting Your Payment</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">${(awaitingPaymentSum / 100).toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">{awaitingPaymentCount} commitment{awaitingPaymentCount !== 1 ? 's' : ''}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-widest">In Transit</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">${(inTransitSum / 100).toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">{inTransitCount} commitment{inTransitCount !== 1 ? 's' : ''}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-widest">Confirmed Received</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">${(confirmedSum / 100).toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">{confirmedCount} commitment{confirmedCount !== 1 ? 's' : ''}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Transaction History</CardTitle>
          <CardDescription>Sponsorships you have committed to. Payment status is tracked per commitment.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {fulfillments?.map((f: any) => (
              <SponsorFulfillmentRow key={f.id} fulfillment={f} />
            ))}
            {(!fulfillments || fulfillments.length === 0) && (
              <EmptyState
                className="border-0 bg-transparent"
                icon={Wallet}
                title="No commitments yet"
                description="When you fund a team's pitch it appears here and you can track the payment through to confirmation."
                action={
                  <Link href="/sponsor/submissions" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
                    Review pending pitches
                  </Link>
                }
              />
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tax Receipts & Acknowledgments</CardTitle>
          <CardDescription>Official written contribution receipts for your completed sponsorships.</CardDescription>
        </CardHeader>
        <CardContent>
          {receipts && receipts.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-muted-foreground uppercase bg-muted/50 border-b">
                  <tr>
                    <th className="px-4 py-3">Receipt Number</th>
                    <th className="px-4 py-3">Issued Date</th>
                    <th className="px-4 py-3">Contribution Date</th>
                    <th className="px-4 py-3">Team</th>
                    <th className="px-4 py-3">Amount</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {receipts.map((r: any) => (
                    <tr key={r.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3 font-mono font-medium">
                        <Link href={`/receipts/${r.receipt_number}`} className="text-primary hover:underline">
                          {r.receipt_number}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {new Date(r.issued_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {r.contribution_date}
                      </td>
                      <td className="px-4 py-3 font-medium">
                        {r.payee_legal_name || r.teams?.team_name || 'Team'}
                      </td>
                      <td className="px-4 py-3 font-semibold">
                        ${(r.amount_cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize',
                            r.status === 'issued'
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                              : 'bg-destructive/10 text-destructive'
                          )}
                        >
                          {r.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              className="border-0 bg-transparent"
              icon={FileText}
              title="No receipts yet"
              description="One is issued automatically when a team confirms it received your payment."
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
