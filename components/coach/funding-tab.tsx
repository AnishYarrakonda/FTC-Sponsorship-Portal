'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { Wallet, AlertCircle, CheckCircle2, Eye, EyeOff, ChevronDown, ChevronUp } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { StatusBadge } from '@/components/ui/status-badge'
import { ConfirmReceiptDialog } from './confirm-receipt-dialog'
import { ageInDays } from '@/lib/fulfillment-aging'
import { canTransition } from '@/lib/fulfillment-status'
import { formatTransactionDate, formatTransactionDateShort } from '@/lib/format-dates'

export function FundingTab({
  teams,
  fulfillments = [],
  payoutProfiles = []
}: {
  teams: any[]
  fulfillments: any[]
  payoutProfiles: any[]
}) {
  const [activeTeamId, setActiveTeamId] = useState<string>(teams[0]?.id || '')
  const [showCancelled, setShowCancelled] = useState(false)

  const currentFulfillments = fulfillments.filter(f => f.team_id === activeTeamId)
  const currentPayoutProfile = payoutProfiles.find(p => p.team_id === activeTeamId)

  const isVerified = currentPayoutProfile?.w9_verified_at != null

  const inTransit = currentFulfillments.filter(f => f.status === 'payment_sent')
  const awaitingPayment = currentFulfillments.filter(f => f.status === 'pledged' || f.status === 'agreement_signed')
  const received = currentFulfillments.filter(f => f.status === 'payment_received' || f.status === 'receipted')
  const cancelled = currentFulfillments.filter(f => f.status === 'cancelled')

  // Derive Payout Readiness Banner (5 states)
  let banner = null
  if (!currentPayoutProfile) {
    banner = (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Payout Readiness Required</AlertTitle>
        <AlertDescription className="mt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <span>Sponsors cannot pay you yet. Add your legal payee name, address and W-9.</span>
          <Button asChild variant="outline" size="sm" className="shrink-0 bg-background">
            <Link href="/team/payout">Set Up Payout Profile</Link>
          </Button>
        </AlertDescription>
      </Alert>
    )
  } else if (!currentPayoutProfile.w9_uploaded_at) {
    banner = (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>W-9 Missing</AlertTitle>
        <AlertDescription className="mt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <span>Your payee details are saved, but no W-9 is on file. Corporate AP departments will not release funds without a W-9.</span>
          <Button asChild variant="outline" size="sm" className="shrink-0 bg-background">
            <Link href="/team/payout/w9">Upload W-9</Link>
          </Button>
        </AlertDescription>
      </Alert>
    )
  } else if (currentPayoutProfile.w9_rejected_at) {
    banner = (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>W-9 Needs Attention</AlertTitle>
        <AlertDescription className="mt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <span>Your W-9 needs attention: {currentPayoutProfile.w9_rejected_reason || 'Please re-upload a valid form.'}</span>
          <Button asChild variant="outline" size="sm" className="shrink-0 bg-background">
            <Link href="/team/payout/w9">Re-upload W-9</Link>
          </Button>
        </AlertDescription>
      </Alert>
    )
  } else if (!currentPayoutProfile.w9_verified_at) {
    banner = (
      <Alert className="border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-200">
        <AlertCircle className="h-4 w-4 text-amber-500" />
        <AlertTitle>W-9 In Review</AlertTitle>
        <AlertDescription className="mt-1">
          Your W-9 is in review. Sponsors can see your payee name but not yet that a W-9 is on file.
        </AlertDescription>
      </Alert>
    )
  } else {
    // Verified state
    let expMsg = ''
    if (currentPayoutProfile.w9_expires_at) {
      const expDate = new Date(currentPayoutProfile.w9_expires_at)
      const daysUntilExp = Math.floor((expDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
      if (daysUntilExp <= 90) {
        expMsg = ` (Expires ${expDate.toLocaleDateString()})`
      }
    }
    banner = (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
        <span>Payout details verified.{expMsg}</span>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto py-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Funding</h2>
          <p className="text-muted-foreground text-sm mt-0.5">Track incoming sponsor disbursements and confirm receipts.</p>
        </div>
        
        {teams.length > 1 && (
          <select
            value={activeTeamId}
            onChange={(e) => setActiveTeamId(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {teams.map((t) => (
              <option key={t.id} value={t.id}>{t.team_name}</option>
            ))}
          </select>
        )}
      </div>

      {/* 1. Payout readiness banner */}
      {banner}

      {/* 2. In Transit */}
      {inTransit.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-base font-semibold text-foreground">In Transit (Action Required)</h3>
          {inTransit.map(f => (
            <FulfillmentCard key={f.id} fulfillment={f} isVerified={isVerified} />
          ))}
        </div>
      )}

      {/* 3. Awaiting Payment */}
      {awaitingPayment.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
            <h3 className="text-base font-semibold text-foreground">Awaiting Payment</h3>
            <span className="text-xs text-muted-foreground">
              The sponsor sends the money directly to your team via check, ACH, or wire. The platform never holds funds.
            </span>
          </div>
          {awaitingPayment.map(f => (
            <FulfillmentCard key={f.id} fulfillment={f} isVerified={isVerified} />
          ))}
        </div>
      )}

      {/* 4. Received */}
      {received.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-base font-semibold text-foreground">Received</h3>
          {received.map(f => (
            <FulfillmentCard key={f.id} fulfillment={f} isVerified={isVerified} />
          ))}
        </div>
      )}

      {/* Cancelled Collapsed */}
      {cancelled.length > 0 && (
        <div className="pt-2 border-t">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowCancelled(!showCancelled)}
            className="text-xs text-muted-foreground flex items-center gap-1"
          >
            {showCancelled ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {showCancelled ? 'Hide' : 'Show'} Cancelled Commitments ({cancelled.length})
          </Button>
          {showCancelled && (
            <div className="space-y-3 mt-3 opacity-75">
              {cancelled.map(f => (
                <FulfillmentCard key={f.id} fulfillment={f} isVerified={isVerified} />
              ))}
            </div>
          )}
        </div>
      )}

      {currentFulfillments.length === 0 && (
        <EmptyState
          icon={Wallet}
          title="No sponsor commitments yet"
          description="When a sponsor funds one of your pitches it appears here."
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard?tab=pitches">View Pitches</Link>
            </Button>
          }
        />
      )}
    </div>
  )
}

function FulfillmentCard({ fulfillment: f, isVerified }: { fulfillment: any, isVerified: boolean }) {
  const [showRef, setShowRef] = useState(false)
  const isTerminal = f.status === 'receipted' || f.status === 'cancelled'
  const age = isTerminal ? null : ageInDays(f)
  const sponsorName = f.sponsors?.company_name || 'Sponsor'

  const rawRef = f.payment_reference || ''
  const maskedRef = rawRef.length > 4 ? `•••• ${rawRef.slice(-4)}` : '••••'

  let timeline = ''
  if (f.pledged_at) timeline += `Pledged ${formatTransactionDateShort(f.pledged_at)}`
  if (f.payment_sent_at) timeline += ` · Sent ${formatTransactionDateShort(f.payment_sent_at)}`
  if (f.payment_received_at) timeline += ` · Received ${formatTransactionDateShort(f.payment_received_at)}`
  if (f.cancelled_at) timeline += ` · Cancelled ${formatTransactionDateShort(f.cancelled_at)}`

  return (
    <Card className="shadow-xs">
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-lg text-foreground">${(f.amount_cents / 100).toLocaleString()}</span>
              <span className="text-sm font-medium text-muted-foreground">from {sponsorName}</span>
            </div>
            
            <div className="text-xs text-muted-foreground mt-1 truncate">{timeline}</div>

            {f.status === 'payment_sent' && f.payment_method && (
              <div className="text-xs text-muted-foreground mt-1">
                Sent by <span className="font-medium uppercase">{f.payment_method}</span>
                {f.payment_sent_at && ` on ${formatTransactionDate(f.payment_sent_at)}`}
              </div>
            )}

            {f.payment_reference && (
              <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
                <span>Ref: <code className="font-mono bg-muted px-1.5 py-0.5 rounded text-foreground">{showRef ? rawRef : maskedRef}</code></span>
                <button
                  type="button"
                  onClick={() => setShowRef(!showRef)}
                  className="text-muted-foreground hover:text-foreground text-[11px] underline flex items-center gap-1"
                >
                  {showRef ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  {showRef ? 'Hide' : 'Show'}
                </button>
              </div>
            )}

            {f.note && (
              <div className="text-xs italic text-muted-foreground mt-2 border-l-2 pl-2">
                "{f.note}"
              </div>
            )}

            {f.status === 'cancelled' && f.cancelled_reason && (
              <div className="text-xs text-destructive mt-2 border-l-2 border-destructive pl-2">
                Cancelled reason: {f.cancelled_reason}
              </div>
            )}

            {age !== null && (
              <div className="text-xs text-muted-foreground mt-1">
                {age} day{age !== 1 ? 's' : ''} in current status
              </div>
            )}
          </div>

          <div className="flex sm:flex-col items-end justify-between sm:justify-center gap-3 shrink-0">
            <StatusBadge status={f.status} />
            {(f.receipt_number || f.funding_receipts?.[0]?.receipt_number) && (
              <Link
                href={`/receipts/${f.receipt_number || f.funding_receipts?.[0]?.receipt_number}`}
                className="text-xs text-primary font-mono hover:underline"
              >
                {f.receipt_number || f.funding_receipts?.[0]?.receipt_number}
              </Link>
            )}
            {canTransition(f.status, 'payment_received', 'coach') && (
              <ConfirmReceiptDialog fulfillmentId={f.id} isVerified={isVerified} />
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

