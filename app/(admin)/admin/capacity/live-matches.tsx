import { createAdminClient } from '@/lib/supabase/admin'
import { VoidMatchDialog } from '@/components/admin/void-match-dialog'

/**
 * Every match currently holding sponsor capacity, with the control to release it.
 *
 * This lives on the capacity page rather than anywhere else because voiding a match is a
 * capacity operation: it is the ONLY way, since 0111 removed the fulfillment layer, to give
 * a sponsor back money they committed to a deal that then fell through. Putting it beside
 * the drift table means the admin who notices a sponsor pinned at their cap finds the fix in
 * the same place.
 *
 * "Live" is defined by the ledger, netted per submission: a void writes a negative row, so a
 * match that has already been reversed sums to zero and drops out on its own.
 */
export async function LiveMatches() {
  const adminClient = createAdminClient()

  const { data: ledgerRows } = await adminClient
    .from('transactions_ledger')
    .select('submission_id, sponsor_id, team_id, amount_cents, created_at')
    .order('created_at', { ascending: false })

  type Match = {
    submissionId: string
    sponsorId: string
    teamId: string
    amountCents: number
    createdAt: string
  }

  const bySubmission = new Map<string, Match>()
  for (const row of ledgerRows ?? []) {
    if (!row.submission_id || !row.sponsor_id || !row.team_id) continue
    const existing = bySubmission.get(row.submission_id)
    if (existing) {
      existing.amountCents += row.amount_cents ?? 0
    } else {
      bySubmission.set(row.submission_id, {
        submissionId: row.submission_id,
        sponsorId: row.sponsor_id,
        teamId: row.team_id,
        amountCents: row.amount_cents ?? 0,
        createdAt: row.created_at as string,
      })
    }
  }

  const live = Array.from(bySubmission.values()).filter((m) => m.amountCents > 0)

  if (live.length === 0) {
    return (
      <section className="rounded-xl border border-border bg-card/50 px-5 py-4">
        <h2 className="text-sm font-medium text-foreground">Live matches</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          No sponsor is currently holding capacity against an accepted pitch.
        </p>
      </section>
    )
  }

  // Only matches whose submission is still `approved` can be voided -- void_match_atomic
  // refuses anything else, so offering the control would be a lie.
  const { data: submissions } = await adminClient
    .from('submissions')
    .select('id, status')
    .in('id', live.map((m) => m.submissionId))
  const statusById = new Map((submissions ?? []).map((s) => [s.id, s.status as string]))

  const [{ data: sponsors }, { data: teams }] = await Promise.all([
    adminClient.from('sponsors').select('id, company_name').in('id', live.map((m) => m.sponsorId)),
    adminClient.from('teams').select('id, team_name').in('id', live.map((m) => m.teamId)),
  ])
  const sponsorName = new Map((sponsors ?? []).map((s) => [s.id, s.company_name as string]))
  const teamName = new Map((teams ?? []).map((t) => [t.id, t.team_name as string]))

  const money = (cents: number) =>
    (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium text-foreground">Live matches</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Accepted pitches still holding capacity. Voiding one releases that amount back to the
          sponsor&apos;s cap &mdash; it is the only way to do so, and it does not move money.
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">Sponsor</th>
              <th scope="col" className="px-4 py-2 font-medium">Team</th>
              <th scope="col" className="px-4 py-2 font-medium text-right">Amount</th>
              <th scope="col" className="px-4 py-2 font-medium">Matched</th>
              <th scope="col" className="px-4 py-2 font-medium">Status</th>
              <th scope="col" className="px-4 py-2 font-medium"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {live.map((m) => {
              const status = statusById.get(m.submissionId) ?? 'unknown'
              const sponsor = sponsorName.get(m.sponsorId) ?? 'Unknown sponsor'
              const team = teamName.get(m.teamId) ?? 'Unknown team'
              return (
                <tr key={m.submissionId}>
                  <td className="px-4 py-3">{sponsor}</td>
                  <td className="px-4 py-3">{team}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(m.amountCents)}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(m.createdAt).toLocaleDateString('en-US', {
                      year: 'numeric', month: 'short', day: 'numeric',
                    })}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{status.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-3 text-right">
                    {status === 'approved' ? (
                      <VoidMatchDialog
                        submissionId={m.submissionId}
                        teamName={team}
                        sponsorName={sponsor}
                        amountCents={m.amountCents}
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">&mdash;</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
