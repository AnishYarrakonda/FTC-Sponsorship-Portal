import { PageHeader } from '@/components/page-header'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { requireAdmin } from '@/lib/actions-utils'
import { ImpactConsole, type AdminSnapshotRow } from '@/components/admin/impact-console'

export const dynamic = 'force-dynamic'

export default async function AdminImpactPage() {
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

  const currentYear = new Date().getUTCFullYear()

  const [{ data: snapshots }, { data: sponsors }] = await Promise.all([
    adminClient
      .from('impact_report_snapshots')
      .select('id, scope, sponsor_id, report_year, status, generated_at, payload')
      .order('report_year', { ascending: false })
      .order('scope', { ascending: true }),
    adminClient.from('sponsors').select('id, company_name'),
  ])

  const nameById = new Map(
    ((sponsors ?? []) as any[]).map((s) => [s.id as string, s.company_name as string])
  )

  const rows: AdminSnapshotRow[] = ((snapshots ?? []) as any[]).map((s) => ({
    id: s.id,
    scope: s.scope,
    sponsor_id: s.sponsor_id,
    company_name: s.sponsor_id ? (nameById.get(s.sponsor_id) ?? 'Unknown sponsor') : null,
    report_year: s.report_year,
    status: s.status,
    generated_at: s.generated_at,
    teams: s.payload?.totals?.teams_supported ?? 0,
    pledged_cents: s.payload?.totals?.pledged_cents ?? 0,
    received_cents: s.payload?.totals?.received_cents ?? 0,
  }))

  const years = Array.from(new Set(rows.map((r) => r.report_year))).sort((a, b) => b - a)

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Impact reports"
        subtitle="Per-sponsor CSR reports and the platform aggregate used for grant applications."
      />

      <ImpactConsole rows={rows} years={years} currentYear={currentYear} />

      <div className="rounded-xl border border-border bg-card/50 px-5 py-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">What is in a report</p>
        <p className="mt-2">
          Team facts, aggregate reach numbers, awards, funding status and delivered recognition —
          nothing from <code>profiles</code>, no coach name or contact detail, and no free-text
          field that in practice names a student. The allowlist is enforced in code
          (<code>lib/impact-report/projection.ts</code>) and drives both the database query and the
          output object, so a column added next season cannot reach a report by accident.
        </p>
        <p className="mt-2">
          Portfolio photographs are excluded until a coach affirms the images contain no
          identifiable students, and that affirmation is cleared automatically whenever the photos
          change. We do not screen images automatically and the UI does not claim we do.
        </p>
      </div>
    </div>
  )
}
