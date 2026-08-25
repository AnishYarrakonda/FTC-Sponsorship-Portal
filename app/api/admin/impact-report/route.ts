import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/actions-utils'
import { rowToCsv } from '@/lib/csv'
import type { PlatformImpactPayload } from '@/lib/impact-report/build'
import { writeAudit } from '@/lib/audit'

/**
 * GET /api/admin/impact-report?year=YYYY&format=json|csv
 *
 * The PLATFORM aggregate, for grant applications. It carries no per-sponsor and no
 * per-team detail by construction — buildPlatformImpactPayload emits totals only — so
 * unlike the submissions export this file contains no contact details of any kind.
 *
 * A sibling route rather than a branch inside app/api/admin/export/route.ts: that route's
 * security model is positional (requireSuperAdmin, then everything below assumes admin and
 * queries with no owner filter), and threading a second scope through it is how a missing
 * .eq() becomes a cross-tenant dump.
 *
 * WHY requireAdmin() AND NOT requireSuperAdmin(), given the sibling export is super-admin
 * only. The two gates protect different things, not different ranks of the same thing.
 * /api/admin/export emits every sponsor contact email and the full text of every pitch —
 * super_admin because it is a bulk PII dump. This route emits `impact_report_snapshots`
 * rows scoped to `platform`, which buildPlatformImpactPayload constructs as counts and
 * cent totals with no sponsor, team, or person named. Raising it would also be internally
 * inconsistent: the entire impact feature — /impact (the page), generation, and publishing
 * (app/actions/impact.ts) — is requireAdmin(), so a reviewer would read the exact same
 * numbers on screen and be refused the download of them. The exemption is the aggregate
 * shape of the payload; if a per-sponsor or per-team breakdown is ever added here, this
 * gate must go to requireSuperAdmin() with it.
 */
export async function GET(req: Request) {
  let user, adminClient
  try {
    ;({ user, adminClient } = await requireAdmin())
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const yearParam = Number(url.searchParams.get('year'))
  const year = Number.isInteger(yearParam) ? yearParam : new Date().getUTCFullYear()
  const format = url.searchParams.get('format') === 'csv' ? 'csv' : 'json'

  const { data: snapshot } = await adminClient
    .from('impact_report_snapshots')
    .select('id, report_year, status, generated_at, payload')
    .eq('scope', 'platform')
    .eq('report_year', year)
    .maybeSingle()

  if (!snapshot) {
    return NextResponse.json(
      { error: `No platform impact report exists for ${year}. Generate it from /impact.` },
      { status: 404 }
    )
  }

  await writeAudit(adminClient, {
    actor_id: user.id,
    action: 'export_platform_impact_report',
    entity_type: 'impact_report_snapshots',
    entity_id: snapshot.id as string,
    metadata: { report_year: year, format, snapshot_id: snapshot.id },
  })

  const payload = snapshot.payload as unknown as PlatformImpactPayload

  if (format === 'json') {
    return NextResponse.json(payload, {
      headers: { 'Content-Disposition': `attachment; filename="platform-impact-${year}.json"` },
    })
  }

  const t = payload.totals
  const lines = [
    rowToCsv(['metric', 'value']),
    rowToCsv(['report_year', payload.year]),
    rowToCsv(['generated_at', payload.generated_at]),
    rowToCsv(['teams_supported', t.teams_supported]),
    rowToCsv(['sponsors_active', payload.sponsors_active]),
    // 0111: one honest figure. Nothing observes whether the money arrived, so a
    // "received" column would be an assertion the platform cannot support.
    rowToCsv(['dollars_matched_cents', t.matched_cents]),
    rowToCsv(['students_reached', t.students_reached]),
    rowToCsv(['events_hosted', t.events_hosted]),
    rowToCsv(['volunteer_hours', t.volunteer_hours]),
    '',
    ...(payload.footnotes ?? []).map((n) => rowToCsv(['NOTE', n])),
  ]

  return new NextResponse(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="platform-impact-${year}.csv"`,
    },
  })
}
