'use client'

import { useState } from 'react'
import { TrendingUp, Eye, EyeOff } from 'lucide-react'
import { StatusBadge } from '@/components/ui/status-badge'
import { MarkPaymentSentDialog } from '@/components/sponsor/mark-payment-sent-dialog'
import { ageInDays } from '@/lib/fulfillment-aging'
import { canTransition } from '@/lib/fulfillment-status'

export function SponsorFulfillmentRow({ fulfillment: f }: { fulfillment: any }) {
  const [showRef, setShowRef] = useState(false)
  const teamName = (f.teams as any)?.team_name ?? 'Team no longer on the platform'
  const isTerminal = f.status === 'receipted' || f.status === 'cancelled'
  const age = isTerminal ? null : ageInDays(f)

  const rawRef = f.payment_reference || ''
  const maskedRef = rawRef.length > 4 ? `•••• ${rawRef.slice(-4)}` : '••••'

  let timeline = ''
  if (f.pledged_at) timeline += `Pledged ${new Date(f.pledged_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
  if (f.payment_sent_at) timeline += ` · Sent ${new Date(f.payment_sent_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
  if (f.payment_received_at) timeline += ` · Received ${new Date(f.payment_received_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
  if (f.cancelled_at) timeline += ` · Cancelled ${new Date(f.cancelled_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`

  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 py-4 border-b border-border last:border-0">
      <div className="flex items-start gap-4 min-w-0">
        <div className="h-10 w-10 shrink-0 rounded-lg bg-primary/10 flex items-center justify-center">
          <TrendingUp className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0">
          <div className="font-medium text-foreground flex items-center gap-2">
            {teamName}
            {(f.teams as any)?.ftc_team_number && (
              <span className="text-muted-foreground font-mono text-xs">{(f.teams as any).ftc_team_number}</span>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-1 truncate">{timeline}</div>

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

          {age !== null && (
            <div className="text-xs text-muted-foreground mt-0.5">
              {age} day{age !== 1 ? 's' : ''} in current status
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-4 text-right shrink-0">
        <div>
          <div className="font-bold text-emerald-500">${(f.amount_cents / 100).toLocaleString()}</div>
          <div className="mt-1 flex justify-end">
            <StatusBadge status={f.status} />
          </div>
        </div>
        {canTransition(f.status, 'payment_sent', 'sponsor') && (
          <MarkPaymentSentDialog fulfillmentId={f.id} />
        )}
      </div>
    </div>
  )
}
