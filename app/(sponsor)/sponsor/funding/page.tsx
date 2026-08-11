import { getAuthedProfile } from '@/lib/actions-utils'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { TrendingUp, Wallet, Building2 } from 'lucide-react'
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
    .select('*, teams(team_name, ftc_team_number)')
    .eq('sponsor_id', profile.sponsor_id)
    .order('pledged_at', { ascending: false })

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
    </div>
  )
}
