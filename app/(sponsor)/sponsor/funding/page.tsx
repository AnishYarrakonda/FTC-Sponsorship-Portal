import { requireSponsorRole } from '@/lib/actions-utils'
import type { SponsorRole } from '@/lib/sponsor-roles'
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
import { formatTransactionDate } from '@/lib/format-dates'

export default async function SponsorFundingPage() {
  /**
   * Company membership comes from requireSponsor (profiles.sponsor_id + sponsor_members),
   * never from `profiles.sponsor_id` alone. That column is null for anyone invited through a
   * Clerk Organization, and the old guard bounced them to /dashboard — which the coach
   * layout bounces straight back here, producing an infinite redirect loop.
   */
  let supabase: Awaited<ReturnType<typeof requireSponsorRole>>['supabase']
  let adminClient: Awaited<ReturnType<typeof requireSponsorRole>>['adminClient']
  let sponsorId: string
  let sponsorIds: string[]
  let memberRole: SponsorRole
  try {
    // 'viewer' is the floor — everyone in the org may look at funding. The rank is read
    // here only so the row can tell a viewer WHO can sign rather than offering them a
    // link that will bounce them (B-03-05 + B-02-01).
    ;({ supabase, adminClient, sponsorId, sponsorIds, memberRole } = await requireSponsorRole('viewer'))
  } catch {
    redirect('/login')
  }

  const { data: sponsor } = await supabase.from('sponsors').select('*').eq('id', sponsorId).single()

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
    .in('sponsor_id', sponsorIds)
    .order('pledged_at', { ascending: false })

  const { data: receipts } = await supabase
    .from('funding_receipts')
    .select('*, teams(team_name)')
    .in('sponsor_id', sponsorIds)
    .order('issued_at', { ascending: false })

  /**
   * B-03-05: which of these pledges is blocked on a signature, and whose.
   *
   * record_fulfillment_transition refuses `payment_sent` until agreement_is_signed()
   * is true, and that needs BOTH the sponsor's and the coach's signature. The page used
   * to render an enabled "Mark Payment Sent" for every pledged row regardless, so the
   * sponsor was offered an action the database had already decided to refuse — and the
   * refusal came back as the literal string `agreement_not_signed`.
   *
   * Read through the ADMIN client on purpose: agreement_signatures_select_sponsor scopes
   * to the sponsor's own rows, so the sponsor cannot see whether the COACH has signed,
   * and "waiting on the coach" would be indistinguishable from "you have not signed".
   * Only submission_id and signer_role are selected — no signature payload, no PII.
   */
  const submissionIds = Array.from(
    new Set((fulfillments ?? []).map((f: any) => f.submission_id).filter(Boolean))
  ) as string[]

  const signedBySubmission = new Map<string, { sponsor: boolean; coach: boolean }>()
  if (submissionIds.length > 0) {
    const { data: signatures } = await adminClient
      .from('agreement_signatures')
      .select('submission_id, signer_role')
      .in('submission_id', submissionIds)

    for (const row of (signatures ?? []) as { submission_id: string; signer_role: string }[]) {
      const entry = signedBySubmission.get(row.submission_id) ?? { sponsor: false, coach: false }
      if (row.signer_role === 'sponsor') entry.sponsor = true
      if (row.signer_role === 'coach') entry.coach = true
      signedBySubmission.set(row.submission_id, entry)
    }
  }

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
              <SponsorFulfillmentRow
                key={f.id}
                fulfillment={f}
                signatures={signedBySubmission.get(f.submission_id) ?? { sponsor: false, coach: false }}
                memberRole={memberRole}
              />
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
                      {/* B-03-14. Both columns through the one UTC formatter: `issued_at`
                          used to be converted to the viewer's timezone (so it disagreed
                          with the document it links to) and `contribution_date` was
                          printed raw, so the two columns were also in two different
                          formats. */}
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatTransactionDate(r.issued_at)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatTransactionDate(r.contribution_date)}
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
