import { getAuthedProfile } from '@/lib/actions-utils'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { Award } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { WaiveBenefitButton } from '@/components/sponsor/waive-benefit-button'
import {
  deliveryStatusLabel,
  isOpenDelivery,
  isRecognitionBenefitType,
  recognitionBenefitLabel,
  type RecognitionDeliveryStatus,
} from '@/lib/recognition'

/**
 * Owed vs delivered, from the sponsor's side.
 *
 * The read is scoped entirely by RLS — recognition_awards_select_sponsor keys off
 * current_sponsor_ids(), so a member of two sponsor orgs sees both and a member of
 * neither sees nothing. There is no sponsor_id filter in the query on purpose; adding one
 * would silently drop the second org's awards for a multi-org user.
 */
export const dynamic = 'force-dynamic'

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

function label(benefitType: string): string {
  return isRecognitionBenefitType(benefitType) ? recognitionBenefitLabel(benefitType) : benefitType
}

function statusText(status: string): string {
  return (['promised', 'in_progress', 'delivered', 'waived', 'not_applicable'] as const).includes(
    status as RecognitionDeliveryStatus
  )
    ? deliveryStatusLabel(status as RecognitionDeliveryStatus)
    : status
}

export default async function SponsorRecognitionPage() {
  const authed = await getAuthedProfile()
  if (!authed) redirect('/login')
  const { supabase, user } = authed

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'sponsor') redirect('/dashboard')

  const { data: awards } = await supabase
    .from('sponsor_recognition_awards')
    .select(
      'id, amount_cents, awarded_at, tier_name_snapshot, team_id, teams(team_name), ' +
      'recognition_benefit_deliveries(id, benefit_type, status, proof_url, delivered_at)'
    )
    .order('awarded_at', { ascending: false })

  const rows = (awards ?? []) as any[]
  const outstanding = rows.reduce(
    (n, a) => n + ((a.recognition_benefit_deliveries ?? []) as any[]).filter((d) => isOpenDelivery(d.status)).length,
    0
  )

  if (rows.length === 0) {
    return (
      <EmptyState
        className="py-20"
        icon={Award}
        title="No recognition yet"
        description="Recognition appears here once you fund a team. The benefits a team owes you are fixed at the moment the sponsorship settles."
        action={
          <Link href="/sponsor/submissions" className={cn(buttonVariants({ variant: 'outline' }))}>
            Review pitches
          </Link>
        }
      />
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Recognition</h1>
        <p className="text-sm text-muted-foreground">
          {outstanding === 0
            ? 'Every benefit you are owed has been delivered or settled.'
            : `${outstanding} benefit${outstanding === 1 ? '' : 's'} still outstanding across ${rows.length} sponsorship${rows.length === 1 ? '' : 's'}.`}
        </p>
      </div>

      {rows.map((award) => {
        const deliveries = ((award.recognition_benefit_deliveries ?? []) as any[]).slice().sort(
          (a, b) => String(a.benefit_type).localeCompare(String(b.benefit_type))
        )
        const open = deliveries.filter((d) => isOpenDelivery(d.status))
        const closed = deliveries.filter((d) => !isOpenDelivery(d.status))
        // team_id is genuinely nullable — a coach can delete their account after the
        // sponsorship settles, and the FK is ON DELETE SET NULL so nothing is blocked.
        const team = award.teams?.team_name ?? 'Team no longer on the platform'

        return (
          <Card key={award.id}>
            <CardHeader>
              <CardTitle className="text-base">
                {team} · {award.tier_name_snapshot}
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {money(award.amount_cents)} · awarded{' '}
                {new Date(award.awarded_at).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              <section>
                <h2 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  Outstanding
                </h2>
                {open.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">Nothing outstanding.</p>
                ) : (
                  <ul className="mt-2 divide-y divide-border">
                    {open.map((d) => (
                      <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                        <div>
                          <p className="text-sm">{label(d.benefit_type)}</p>
                          <p className="text-xs text-muted-foreground">{statusText(d.status)}</p>
                        </div>
                        <WaiveBenefitButton deliveryId={d.id} label={label(d.benefit_type)} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h2 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  Delivered &amp; settled
                </h2>
                {closed.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">Nothing delivered yet.</p>
                ) : (
                  <ul className="mt-2 divide-y divide-border">
                    {closed.map((d) => (
                      <li key={d.id} className="flex items-center gap-3 py-2">
                        {d.proof_url && (
                          <Image
                            src={d.proof_url}
                            alt={`Proof for ${label(d.benefit_type)}`}
                            width={48}
                            height={48}
                            unoptimized
                            className="h-12 w-12 rounded-md border border-border object-cover"
                          />
                        )}
                        <div>
                          <p className="text-sm">{label(d.benefit_type)}</p>
                          <p className="text-xs text-muted-foreground">
                            {statusText(d.status)}
                            {d.delivered_at
                              ? ` · ${new Date(d.delivered_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                              : ''}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
