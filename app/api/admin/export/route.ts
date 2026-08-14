import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/actions-utils'
import { htmlToPlainText } from '@/lib/utils'
// Lifted into lib/csv.ts so the impact-report routes share this exact escaping. Pure move.
import { escapeCell, rowToCsv, CSV_PAGE_SIZE as PAGE_SIZE } from '@/lib/csv'

const CSV_HEADERS = [
  'submission_id',
  'submission_status',
  'submission_created_at',
  'requested_amount_cents',
  'custom_pitch_alignment',
  'specific_needs_statement',
  'team_id',
  'team_name',
  'ftc_team_number',
  'team_state',
  'tax_status',
  'financial_ask_cents',
  'sponsor_id',
  'company_name',
  'contact_name',
  'contact_email',
  'funding_cap_cents',
  'funding_used_cents',
]


export async function GET() {
  let adminClient: Awaited<ReturnType<typeof requireSuperAdmin>>['adminClient']
  let actorId: string

  // Super admin (0084): this file contains every sponsor contact email and the full text
  // of every pitch. A reviewer gets JSON 403 — API routes are never redirected.
  try {
    const auth = await requireSuperAdmin()
    adminClient = auth.adminClient
    actorId = auth.user.id
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const buildQuery = () =>
    adminClient
    .from('submissions')
    .select(`
      id,
      status,
      created_at,
      requested_amount_cents,
      custom_pitch_alignment,
      specific_needs_statement,
      teams:team_id (
        id,
        team_name,
        ftc_team_number,
        state,
        tax_status,
        financial_ask_cents
      ),
      sponsors:sponsor_id (
        id,
        company_name,
        contact_name,
        contact_email,
        funding_cap_cents,
        funding_used_cents
      )
    `)
    // 'delivered' and 'opened' were missing. They are the states a submission enters the
    // moment Resend reports delivery, so a LIVE submission silently vanished from every
    // report the admin ran — the export looked complete and was not.
    .in('status', ['approved', 'dispatched', 'delivered', 'opened'])
    // A deterministic total order is REQUIRED for .range() paging below. Without an
    // ORDER BY, Postgres may return rows in a different order per page, so pages can
    // both duplicate and omit rows — silently, in a financial export. `id` is the PK,
    // so this is a total order.
    .order('id', { ascending: true })

  // Paginate. The original query had no .range(), and PostgREST silently truncates at
  // 1000 rows — the export would have quietly started omitting data with no error and
  // no visible sign, which is the worst possible failure mode for a financial report.
  const submissions: Awaited<ReturnType<typeof buildQuery>>['data'] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: page, error } = await buildQuery().range(from, from + PAGE_SIZE - 1)
    if (error) {
      console.error('[export] Query failed', error)
      return NextResponse.json({ error: 'Export failed' }, { status: 500 })
    }
    if (!page || page.length === 0) break
    submissions.push(...page)
    if (page.length < PAGE_SIZE) break
  }

  const lines: string[] = [rowToCsv(CSV_HEADERS)]

  for (const s of submissions) {
    const team = s.teams as unknown as Record<string, unknown> | null
    const sponsor = s.sponsors as unknown as Record<string, unknown> | null

    lines.push(
      rowToCsv([
        s.id,
        s.status,
        s.created_at,
        s.requested_amount_cents,
        htmlToPlainText(s.custom_pitch_alignment),
        htmlToPlainText(s.specific_needs_statement),
        team?.id,
        team?.team_name,
        team?.ftc_team_number,
        team?.state,
        team?.tax_status,
        team?.financial_ask_cents,
        sponsor?.id,
        sponsor?.company_name,
        sponsor?.contact_name,
        sponsor?.contact_email,
        sponsor?.funding_cap_cents,
        sponsor?.funding_used_cents,
      ])
    )
  }

  const csv = lines.join('\n')

  // This file contains every sponsor contact email and the full text of every pitch —
  // the single most sensitive artifact the product can emit — and it left no trace at
  // all. Every other privileged path in the codebase writes audit_log; this one did not.
  const { error: auditError } = await adminClient.from('audit_log').insert({
    actor_id: actorId,
    action: 'export_submissions_csv',
    entity_type: 'submissions',
    entity_id: null,
    metadata: {
      row_count: submissions.length,
      statuses: ['approved', 'dispatched', 'delivered', 'opened'],
      includes_sponsor_contact_emails: true,
    },
  })
  if (auditError) {
    console.error('[export] failed to write audit row', auditError)
  }

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="sponsorship_export_2026.csv"',
    },
  })
}
