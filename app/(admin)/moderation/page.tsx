import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/page-header'
import { ModerationQueue } from '@/components/admin/moderation-queue'
import { InFlightSubmissions, type InFlightSubmission } from '@/components/admin/in-flight-submissions'

export const dynamic = 'force-dynamic'

export default async function ModerationPage() {
  const supabase = await createClient()

  const { data: submissions } = await supabase
    .from('submissions')
    .select(`
      id,
      updated_at,
      requested_amount_cents,
      custom_pitch_alignment,
      specific_needs_statement,
      teams:team_id (
        team_name,
        ftc_team_number,
        state,
        status,
        mission_statement,
        technical_summary,
        outreach_summary,
        financial_ask_cents,
        budget_items
      ),
      sponsors:sponsor_id (
        company_name
      )
    `)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })

  // Pitches that have left the review queue but not yet reached a sponsor decision.
  // 'dispatched', 'delivered' and 'opened' previously appeared in NO admin view at all,
  // which is why a failed dispatch (P0-11) had nowhere to be seen or retried.
  const { data: inFlight } = await supabase
    .from('submissions')
    .select(`
      id,
      status,
      sent_at,
      expires_at,
      resend_message_id,
      reserved_amount_cents,
      teams:team_id ( team_name, ftc_team_number ),
      sponsors:sponsor_id ( company_name )
    `)
    .in('status', ['dispatched', 'delivered', 'opened'])
    .is('deleted_at', null)
    .order('sent_at', { ascending: false })
    .limit(200)

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Review Queue"
        subtitle="Review submitted portfolios and custom pitches. Approved submissions are dispatched to sponsors with a secure 14-day token link."
      />
      <ModerationQueue initialSubmissions={submissions ?? []} />

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold">Awaiting sponsor decision</h2>
          <p className="text-sm text-muted-foreground">
            Already approved and holding sponsor capacity. Resend if the sponsor never received the pitch.
          </p>
        </div>
        <InFlightSubmissions submissions={(inFlight ?? []) as unknown as InFlightSubmission[]} />
      </section>
    </div>
  )
}
