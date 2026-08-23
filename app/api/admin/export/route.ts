import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireSuperAdmin } from '@/lib/actions-utils'
import { htmlToPlainText } from '@/lib/utils'
// Lifted into lib/csv.ts so the impact-report routes share this exact escaping. Pure move.
import { rowToCsv, CSV_PAGE_SIZE as PAGE_SIZE } from '@/lib/csv'
import { writeAudit } from '@/lib/audit'

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

  /**
   * A-09-04. This used to buffer every page into one `submissions` array, then build a
   * second `lines: string[]`, then `lines.join('\n')` into a third full copy — three
   * simultaneous copies of a file that contains the full text of every pitch and every
   * sponsor contact email. At 10,000+ rows that exceeds the function's memory and the
   * export fails; worse, for a financial report, it fails at size rather than at logic,
   * so it works in testing and stops working exactly when the data matters.
   *
   * Streamed instead: one page in flight at a time, each row serialized and handed off
   * immediately. Memory is now O(page) rather than O(export).
   */

  // The audit row is written BEFORE the first byte, not after the last. This file is the
  // single most sensitive artifact the product can emit, and a client that disconnects
  // mid-download must not also erase the record that the export was run. The completion
  // row below carries the count; this one carries the fact.
  await writeAudit(adminClient, {
    actor_id: actorId,
    action: 'export_submissions_csv',
    entity_type: 'submissions',
    entity_id: null,
    metadata: {
      statuses: ['approved', 'dispatched', 'delivered', 'opened'],
      includes_sponsor_contact_emails: true,
      streamed: true,
    },
  })

  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let rowCount = 0
      try {
        controller.enqueue(encoder.encode(rowToCsv(CSV_HEADERS) + '\n'))

        for (let from = 0; ; from += PAGE_SIZE) {
          const { data: page, error } = await buildQuery().range(from, from + PAGE_SIZE - 1)
          if (error) throw new Error(error.message)
          if (!page || page.length === 0) break

          let chunk = ''
          for (const s of page) {
            const team = s.teams as unknown as Record<string, unknown> | null
            const sponsor = s.sponsors as unknown as Record<string, unknown> | null
            chunk +=
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
              ]) + '\n'
            rowCount++
          }
          controller.enqueue(encoder.encode(chunk))

          if (page.length < PAGE_SIZE) break
        }

        controller.close()

        await writeAudit(adminClient, {
          actor_id: actorId,
          action: 'export_submissions_csv_completed',
          entity_type: 'submissions',
          entity_id: null,
          metadata: { row_count: rowCount },
        })
      } catch (e) {
        console.error('[export] stream failed', e)
        Sentry.captureException(e)
        await writeAudit(adminClient, {
          actor_id: actorId,
          action: 'export_submissions_csv_failed',
          entity_type: 'submissions',
          entity_id: null,
          metadata: { rows_emitted: rowCount, error: e instanceof Error ? e.message : String(e) },
        })
        // Abort rather than close. Headers are already sent so there is no 500 to return,
        // and closing cleanly would hand the admin a SILENTLY TRUNCATED financial export —
        // the one outcome worse than a failed download.
        controller.error(e)
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="sponsorship_export_2026.csv"',
      'Cache-Control': 'no-store',
    },
  })
}
