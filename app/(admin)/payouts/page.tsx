import { createAdminClient } from '@/lib/supabase/admin'
import { Receipt } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { PayoutReviewCard, PayoutData } from '@/components/admin/payout-review-card'

export default async function PayoutsPage() {
  const adminClient = createAdminClient()

  // Read team payout profiles along with the team name
  const { data: payouts } = await (adminClient as any)
    .from('team_payout_profiles')
    .select(`
      id,
      team_id,
      legal_payee_name,
      tax_classification,
      is_fiscally_sponsored,
      fiscal_sponsor_name,
      w9_document_path,
      w9_uploaded_at,
      w9_verified_at,
      w9_verified_by,
      w9_rejected_at,
      w9_rejected_reason,
      w9_expires_at,
      teams (
        team_name,
        ftc_team_number
      )
    `)
    .order('updated_at', { ascending: false })

  const needsReview = (p: { w9_uploaded_at: string | null; w9_verified_at: string | null; w9_rejected_at: string | null }) =>
    !!p.w9_uploaded_at && !p.w9_verified_at && !p.w9_rejected_at

  const payoutsWithSignedUrls = await Promise.all(
    (payouts ?? []).map(async (payout: any) => {
      let signedUrl: string | null = null
      if (needsReview(payout) && payout.w9_document_path) {
        const { data } = await adminClient.storage
          .from('tax-documents')
          .createSignedUrl(payout.w9_document_path, 1800)
        signedUrl = data?.signedUrl ?? null
      }
      const teamArr = payout.teams as any
      const team = Array.isArray(teamArr) ? teamArr[0] ?? null : teamArr ?? null
      return { ...payout, signedUrl, team } as PayoutData
    })
  )

  const pending = payoutsWithSignedUrls.filter(needsReview)
  const verified = payoutsWithSignedUrls.filter(p => !!p.w9_verified_at)
  const waiting = payoutsWithSignedUrls.filter(p => !needsReview(p) && !p.w9_verified_at)

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        title="Payout Profiles & W-9s"
        subtitle="Verify team W-9s and tax information. Sponsors cannot see payout details until a W-9 is verified."
      />

      <section className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-widest font-mono">
            In Review
          </h2>
          {pending.length > 0 && (
            <span className="inline-flex items-center rounded-full bg-[var(--badge-warning-bg)] border border-[var(--badge-warning-text)]/25 text-[var(--badge-warning-text)] text-xs font-semibold px-2 py-0.5">
              {pending.length}
            </span>
          )}
        </div>
        {pending.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="Nothing awaiting review"
            description="When teams upload their W-9s, they will appear here."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {pending.map(payout => (
              <PayoutReviewCard key={payout.id} payout={payout} />
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest font-mono">
          Verified
        </h2>
        {verified.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No verified W-9s yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {verified.map(payout => (
              <PayoutReviewCard key={payout.id} payout={payout} />
            ))}
          </div>
        )}
      </section>

      {waiting.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest font-mono">
            Awaiting Upload / Rejected
          </h2>
          <div className="flex flex-col gap-3">
            {waiting.map(payout => (
              <PayoutReviewCard key={payout.id} payout={payout} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
