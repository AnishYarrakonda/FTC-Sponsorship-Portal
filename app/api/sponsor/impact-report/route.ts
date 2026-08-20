import { NextResponse } from 'next/server'
import { requireSponsor } from '@/lib/actions-utils'
import { createClient } from '@/lib/supabase/server'
import { rowToCsv } from '@/lib/csv'
import type { SponsorImpactPayload } from '@/lib/impact-report/build'

/**
 * GET /api/sponsor/impact-report?year=YYYY&format=json|csv
 *
 * Two independent barriers on the read: the explicit sponsor filter, and RLS underneath
 * it (impact_snapshots_select_sponsor keys off current_sponsor_ids()). The admin client is
 * used ONLY for the audit write — never for the data read.
 *
 * Any sponsorId in the query string is ignored. The sponsor comes from the session, full
 * stop; a caller supplying a different one is attempting a cross-tenant read, so it is a
 * 403 and an audit row rather than a silent shrug.
 *
 * API routes are never redirected — middleware returns JSON 401 for unauthenticated
 * /api/*, and this route matches that contract.
 */
export async function GET(req: Request) {
  let user, sponsorIds, sponsorId, adminClient
  try {
    ;({ user, sponsorIds, sponsorId, adminClient } = await requireSponsor())
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const yearParam = Number(url.searchParams.get('year'))
  const year = Number.isInteger(yearParam) ? yearParam : new Date().getUTCFullYear()
  const format = url.searchParams.get('format') === 'csv' ? 'csv' : 'json'

  const requestedSponsor = url.searchParams.get('sponsorId')
  if (requestedSponsor && !sponsorIds.includes(requestedSponsor)) {
    await adminClient.from('audit_log').insert({
      actor_id: user.id,
      action: 'impact_report_cross_tenant_attempt',
      entity_type: 'impact_report_snapshots',
      entity_id: null,
      metadata: { requested_sponsor_id: requestedSponsor, session_sponsor_ids: sponsorIds, report_year: year },
    })
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const scopedSponsorId = requestedSponsor ?? sponsorId

  const supabase = await createClient()
  const { data: snapshot } = await supabase
    .from('impact_report_snapshots')
    .select('id, report_year, status, generated_at, payload, payload_schema_version')
    .eq('scope', 'sponsor')
    .eq('sponsor_id', scopedSponsorId)
    .eq('report_year', year)
    .maybeSingle()

  if (!snapshot) {
    const { data: available } = await supabase
      .from('impact_report_snapshots')
      .select('report_year')
      .eq('scope', 'sponsor')
      .eq('sponsor_id', scopedSponsorId)
      .order('report_year', { ascending: false })

    return NextResponse.json(
      {
        error: `No impact report exists for ${year}.`,
        available_years: (available ?? []).map((r) => r.report_year),
      },
      { status: 404 }
    )
  }

  await adminClient.from('audit_log').insert({
    actor_id: user.id,
    action: 'export_sponsor_impact_report',
    entity_type: 'impact_report_snapshots',
    entity_id: snapshot.id as string,
    metadata: { sponsor_id: scopedSponsorId, report_year: year, format, snapshot_id: snapshot.id },
  })

  const payload = snapshot.payload as unknown as SponsorImpactPayload

  if (format === 'json') {
    return NextResponse.json(payload, {
      headers: { 'Content-Disposition': `attachment; filename="impact-report-${year}.json"` },
    })
  }

  const lines: string[] = [
    rowToCsv([
      'ftc_team_number',
      'team_name',
      'organization',
      'city',
      'state',
      'tax_status',
      'students_reached',
      'events_hosted',
      'volunteer_hours',
      'pledged_cents',
      'received_cents',
      'recognition_tier',
      'benefits_promised',
      'benefits_delivered',
      'achievements',
    ]),
  ]

  for (const section of payload.teams ?? []) {
    const pledged = section.fulfillments.reduce((n, f) => n + (f.amount_cents ?? 0), 0)
    const received = section.fulfillments
      .filter((f) => f.status === 'payment_received' || f.status === 'receipted')
      .reduce((n, f) => n + (f.amount_cents ?? 0), 0)

    lines.push(
      rowToCsv([
        section.team.ftc_team_number,
        section.team.team_name,
        section.team.organization,
        section.team.city,
        section.team.state,
        section.team.tax_status,
        section.team.students_reached,
        section.team.events_hosted,
        section.team.volunteer_hours,
        pledged,
        received,
        section.recognition.tier_name,
        section.recognition.benefits.length,
        section.recognition.benefits.filter((b) => b.status === 'delivered').length,
        section.achievements.map((a) => `${a.season ?? ''} ${a.award ?? ''}`.trim()).join('; '),
      ])
    )
  }

  lines.push('')
  lines.push(rowToCsv(['TOTAL pledged_cents', payload.totals.pledged_cents]))
  lines.push(rowToCsv(['TOTAL received_cents', payload.totals.received_cents]))
  lines.push(rowToCsv(['TOTAL outstanding_cents', payload.totals.outstanding_cents]))
  for (const note of payload.footnotes ?? []) lines.push(rowToCsv(['NOTE', note]))

  return new NextResponse(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="impact-report-${year}.csv"`,
    },
  })
}
