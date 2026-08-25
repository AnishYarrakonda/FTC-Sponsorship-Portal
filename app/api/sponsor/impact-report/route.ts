import { NextResponse } from 'next/server'
import { requireSponsor } from '@/lib/actions-utils'
import { createClient } from '@/lib/supabase/server'
import { rowToCsv } from '@/lib/csv'
import type { SponsorImpactPayload } from '@/lib/impact-report/build'
import { writeAudit } from '@/lib/audit'

/** A-12-04. Label only; the fiscal-year maths itself lives in fiscal_year_of() (0110). */
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
import { createZip, safeZipSegment, type ZipEntry } from '@/lib/zip'
import { safeMediaUrl } from '@/lib/safe-url'

/**
 * GET /api/sponsor/impact-report?year=YYYY&format=json|csv|assets
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
  const formatParam = url.searchParams.get('format')
  const format: 'json' | 'csv' | 'assets' =
    formatParam === 'csv' ? 'csv' : formatParam === 'assets' ? 'assets' : 'json'

  const requestedSponsor = url.searchParams.get('sponsorId')
  if (requestedSponsor && !sponsorIds.includes(requestedSponsor)) {
    await writeAudit(adminClient, {
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

  await writeAudit(adminClient, {
    actor_id: user.id,
    action: 'export_sponsor_impact_report',
    entity_type: 'impact_report_snapshots',
    entity_id: snapshot.id as string,
    metadata: { sponsor_id: scopedSponsorId, report_year: year, format, snapshot_id: snapshot.id },
  })

  const payload = snapshot.payload as unknown as SponsorImpactPayload

  // A-12-04. Read live rather than from the snapshot: the snapshot is an immutable record
  // of the FIGURES, while which fiscal year to label them under is a presentation choice
  // the sponsor can correct without invalidating the report.
  const { data: sponsorRow } = await supabase
    .from('sponsors')
    .select('fiscal_year_start_month')
    .eq('id', scopedSponsorId)
    .maybeSingle()
  const fiscalYearStartMonth = sponsorRow?.fiscal_year_start_month ?? 1

  if (format === 'json') {
    return NextResponse.json(payload, {
      headers: { 'Content-Disposition': `attachment; filename="impact-report-${year}.json"` },
    })
  }

  /**
   * A-12-06. The raw marketing assets behind the report, as a ZIP.
   *
   * A CSR team asked to build corporate materials from this report previously had to crop
   * images out of a rendered page. The assets themselves already exist and are already
   * cleared: `media_urls` on the snapshot is what `projectTeam` emitted, which means it
   * passed the media_no_minors affirmation (COPPA, Core Mandate #1) AND the
   * scheme-and-host allowlist added for A-06-04. This route re-checks the host anyway —
   * the snapshot is an immutable payload that may predate that fix, and fetching an
   * arbitrary URL server-side from a signed-in session is textbook SSRF.
   *
   * A manifest.csv rides along so a designer knows which team each file belongs to and
   * what they are allowed to say about it, which is the actual blocker for using them.
   */
  if (format === 'assets') {
    return buildAssetBundle(payload, year)
  }

  const lines: string[] = [
    rowToCsv([
      'ftc_team_number',
      'team_name',
      'organization',
      'city',
      'state',
      'tax_status',
      // A-12-04
      'fiscal_year',
      'students_reached',
      'events_hosted',
      'volunteer_hours',
      'matched_cents',
      'achievements',
    ]),
  ]

  /**
   * A-12-04. The sponsor's fiscal year, not the calendar year the snapshot is filed under.
   * A reporting label only — see migration 0110 for why it is not a budget.
   */
  const fiscalStartMonth = fiscalYearStartMonth ?? 1
  const fiscalYearLabel =
    fiscalStartMonth === 1 ? String(year) : `FY${year} (starts ${MONTH_NAMES[fiscalStartMonth - 1]})`

  for (const section of payload.teams ?? []) {
    // Net: a 'void' row is negative, so an unwound match reduces the figure rather than
    // needing to be filtered out.
    const matched = section.matches.reduce((n, m) => n + (m.amount_cents ?? 0), 0)

    lines.push(
      rowToCsv([
        section.team.ftc_team_number,
        section.team.team_name,
        section.team.organization,
        section.team.city,
        section.team.state,
        // P3. 'None' is a legitimate enum value meaning "no charitable status", not a
        // label — it was landing literally in the CSR spreadsheet's tax_status column.
        section.team.tax_status === 'None' ? '' : section.team.tax_status,
        fiscalYearLabel,
        section.team.students_reached,
        section.team.events_hosted,
        section.team.volunteer_hours,
        matched,
        section.achievements.map((a) => `${a.season ?? ''} ${a.award ?? ''}`.trim()).join('; '),
      ])
    )
  }

  lines.push('')
  lines.push(rowToCsv(['TOTAL matched_cents', payload.totals.matched_cents]))
  for (const note of payload.footnotes ?? []) lines.push(rowToCsv(['NOTE', note]))

  return new NextResponse(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="impact-report-${year}.csv"`,
    },
  })
}


/** Per-file and total ceilings. A serverless function must not try to buffer a DVD. */
const MAX_ASSET_BYTES = 15 * 1024 * 1024
const MAX_BUNDLE_BYTES = 150 * 1024 * 1024

async function buildAssetBundle(payload: SponsorImpactPayload, year: number): Promise<Response> {
  const entries: ZipEntry[] = []
  const manifest: string[] = [
    rowToCsv(['file', 'ftc_team_number', 'team_name', 'organization', 'city', 'state', 'tagline']),
  ]
  const skipped: string[] = []
  let total = 0

  for (const section of payload.teams ?? []) {
    const team = section.team
    const folder = safeZipSegment(
      `${team.ftc_team_number ?? 'incubator'}-${team.team_name ?? 'team'}`
    )
    const urls = [team.logo_url, ...(team.media_urls ?? [])].filter(
      (u): u is string => typeof u === 'string' && u.length > 0
    )

    let index = 0
    for (const rawUrl of urls) {
      /**
       * SSRF guard. Re-validating against the SAME allowlist the projection uses means an
       * old snapshot written before A-06-04 cannot make this route fetch an attacker's
       * host from inside our network on a signed-in sponsor's behalf.
       */
      const url = safeMediaUrl(rawUrl)
      if (!url) {
        skipped.push(rawUrl)
        continue
      }

      let bytes: Uint8Array
      try {
        const res = await fetch(url, { redirect: 'error' })
        if (!res.ok) {
          skipped.push(url)
          continue
        }
        const buf = new Uint8Array(await res.arrayBuffer())
        if (buf.length > MAX_ASSET_BYTES || total + buf.length > MAX_BUNDLE_BYTES) {
          skipped.push(url)
          continue
        }
        bytes = buf
      } catch {
        // One unreachable asset must not fail the whole export.
        skipped.push(url)
        continue
      }

      const ext = (url.split('?')[0].match(/\.([a-z0-9]{2,5})$/i)?.[1] ?? 'jpg').toLowerCase()
      const name = index === 0 && rawUrl === team.logo_url ? 'logo' : `photo-${index}`
      const path = `${folder}/${name}.${ext}`
      entries.push({ name: path, data: bytes })
      total += bytes.length
      index += 1

      manifest.push(
        rowToCsv([
          path,
          team.ftc_team_number ?? '',
          team.team_name ?? '',
          team.organization ?? '',
          team.city ?? '',
          team.state ?? '',
          team.tagline ?? '',
        ])
      )
    }
  }

  manifest.push('')
  manifest.push(
    rowToCsv([
      'NOTE',
      'These images were supplied by the teams and affirmed by their coach as containing no identifiable minors. Use them in accordance with that affirmation.',
    ])
  )
  for (const s of skipped) manifest.push(rowToCsv(['SKIPPED', s]))

  entries.push({
    name: 'manifest.csv',
    data: new TextEncoder().encode(manifest.join('\n') + '\n'),
  })

  const zip = createZip(entries)
  return new Response(new Uint8Array(zip) as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="impact-assets-${year}.zip"`,
      'Content-Length': String(zip.length),
      'Cache-Control': 'private, no-store',
    },
  })
}
