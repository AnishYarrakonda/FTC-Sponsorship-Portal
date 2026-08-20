import { PageHeader } from '@/components/page-header'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { requireAdmin } from '@/lib/actions-utils'
import { RecognitionTierEditor, type AdminTierRow } from '@/components/admin/recognition-tier-form'
import { ProofReviewQueue, type ProofRow } from '@/components/admin/proof-review-queue'

// Configuration plus a moderation queue: never serve either from the full-route cache.
export const dynamic = 'force-dynamic'

export default async function AdminRecognitionPage() {
  let adminClient
  try {
    ;({ adminClient } = await requireAdmin())
  } catch {
    return (
      <Alert variant="destructive">
        <AlertDescription>You do not have permission to view this page.</AlertDescription>
      </Alert>
    )
  }

  // The tier table includes archived rows here — recognition_tiers_select_admin exists
  // precisely so an admin can see what was retired. The admin client is used because this
  // page also joins across sponsors and teams for the proof queue, which no single
  // caller-scoped policy covers.
  const [{ data: tiers }, { data: proofs }] = await Promise.all([
    adminClient
      .from('recognition_tiers')
      .select('id, name, rank, min_amount_cents, max_amount_cents, benefits, description, archived_at')
      .order('rank', { ascending: true }),
    adminClient
      .from('recognition_benefit_deliveries')
      .select(
        'id, benefit_type, status, proof_url, proof_uploaded_at, ' +
        'sponsor_recognition_awards!inner(sponsors(company_name), teams(team_name))'
      )
      .not('proof_url', 'is', null)
      .order('proof_uploaded_at', { ascending: false })
      .limit(100),
  ])

  const proofRows: ProofRow[] = ((proofs ?? []) as any[]).map((p) => ({
    id: p.id,
    benefit_type: p.benefit_type,
    status: p.status,
    proof_url: p.proof_url,
    proof_uploaded_at: p.proof_uploaded_at,
    team_name: p.sponsor_recognition_awards?.teams?.team_name ?? null,
    company_name: p.sponsor_recognition_awards?.sponsors?.company_name ?? null,
  }))

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Recognition"
        subtitle="What a sponsorship earns, and the photo evidence teams have supplied for it."
      />

      <RecognitionTierEditor tiers={(tiers ?? []) as AdminTierRow[]} />

      <ProofReviewQueue rows={proofRows} />
    </div>
  )
}
