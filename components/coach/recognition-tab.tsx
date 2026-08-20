'use client'

import { useTransition } from 'react'
import Link from 'next/link'
import { Award, Check, CircleDot, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { cn } from '@/lib/utils'
import { markBenefitDelivered } from '@/app/actions/recognition'
import { BenefitProofUploader } from './benefit-proof-uploader'
import {
  deliveryStatusLabel,
  isOpenDelivery,
  isRecognitionBenefitType,
  recognitionBenefitLabel,
  type RecognitionDeliveryStatus,
} from '@/lib/recognition'

export interface CoachRecognitionDelivery {
  id: string
  benefit_type: string
  status: string
  proof_url: string | null
  admin_void_reason: string | null
  delivered_at: string | null
}

export interface CoachRecognitionAward {
  id: string
  amount_cents: number
  awarded_at: string
  tier_name_snapshot: string
  company_name: string | null
  deliveries: CoachRecognitionDelivery[]
}

const STATUS_TONE: Record<string, string> = {
  promised: 'bg-muted text-muted-foreground',
  in_progress: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
  delivered: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  waived: 'bg-muted text-muted-foreground',
  not_applicable: 'bg-muted text-muted-foreground',
}

function statusLabel(status: string): string {
  return (
    (['promised', 'in_progress', 'delivered', 'waived', 'not_applicable'] as const).includes(
      status as RecognitionDeliveryStatus
    )
      ? deliveryStatusLabel(status as RecognitionDeliveryStatus)
      : status
  )
}

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

function BenefitRow({ delivery }: { delivery: CoachRecognitionDelivery }) {
  const [pending, startTransition] = useTransition()
  const open = isOpenDelivery(delivery.status)
  const label = isRecognitionBenefitType(delivery.benefit_type)
    ? recognitionBenefitLabel(delivery.benefit_type)
    : delivery.benefit_type

  const setStatus = (status: 'in_progress' | 'delivered' | 'promised') => {
    startTransition(async () => {
      const res = await markBenefitDelivered({ deliveryId: delivery.id, status })
      if (res.error) toast.error(res.error)
      else toast.success(`“${label}” marked ${statusLabel(status).toLowerCase()}.`)
    })
  }

  return (
    <div className="space-y-3 border-t border-border py-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{label}</span>
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[11px] font-medium',
              STATUS_TONE[delivery.status] ?? 'bg-muted text-muted-foreground'
            )}
          >
            {statusLabel(delivery.status)}
          </span>
        </div>

        {open && (
          <div className="flex items-center gap-2">
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />}
            {delivery.status === 'promised' && (
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => setStatus('in_progress')}>
                <CircleDot className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Start
              </Button>
            )}
            <Button size="sm" variant="outline" disabled={pending} onClick={() => setStatus('delivered')}>
              <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Mark delivered
            </Button>
          </div>
        )}

        {delivery.status === 'delivered' && (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setStatus('in_progress')}>
            Undo
          </Button>
        )}
      </div>

      {/* A waived or not-applicable benefit needs no proof and no controls — nothing is
          owed, so showing an uploader would only invite a pointless upload. */}
      {(open || delivery.status === 'delivered') && isRecognitionBenefitType(delivery.benefit_type) && (
        <BenefitProofUploader
          deliveryId={delivery.id}
          benefitType={delivery.benefit_type}
          proofUrl={delivery.proof_url}
          voidReason={delivery.admin_void_reason}
        />
      )}
    </div>
  )
}

export function RecognitionTab({ awards }: { awards: CoachRecognitionAward[] }) {
  if (awards.length === 0) {
    return (
      <EmptyState
        icon={Award}
        title="No recognition owed yet"
        description="Recognition appears here once a sponsorship settles. What you owe is set by the tier the sponsorship lands in, and it is frozen at that moment."
        action={
          <Button asChild variant="outline">
            <Link href="/dashboard?tab=sponsors">Find sponsors</Link>
          </Button>
        }
      />
    )
  }

  const outstanding = awards.reduce(
    (n, a) => n + a.deliveries.filter((d) => isOpenDelivery(d.status)).length,
    0
  )

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Recognition</h2>
        <p className="text-sm text-muted-foreground">
          {outstanding === 0
            ? 'Everything you owe has been delivered or settled.'
            : `${outstanding} benefit${outstanding === 1 ? '' : 's'} still to deliver.`}
        </p>
      </div>

      {awards.map((award) => (
        <Card key={award.id}>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base">
                {award.company_name ?? 'A sponsor'} · {award.tier_name_snapshot}
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {money(award.amount_cents)} · awarded{' '}
                {new Date(award.awarded_at).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </p>
            </div>
          </CardHeader>
          <CardContent>
            {award.deliveries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No benefits were attached to this tier.</p>
            ) : (
              award.deliveries.map((d) => <BenefitRow key={d.id} delivery={d} />)
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
