import { redirect } from 'next/navigation'
import { History } from 'lucide-react'
import { listSponsorAuditLog } from '@/app/actions/sponsor-audit'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { formatTransactionDate } from '@/lib/format-dates'
import { formatMoney } from '@/lib/format-money'

export const dynamic = 'force-dynamic'

/**
 * A-12-05. "Who in my organisation did what, and when."
 *
 * Read-only by design and by construction: there is no mutation on this page and no action
 * imported that could become one. The scoping, the action allowlist and the actor-naming
 * rule are all enforced in `sponsor_audit_log()` (migration 0109), not here — see the note
 * in app/actions/sponsor-audit.ts for why that split matters.
 */

/** Human labels for the allowlisted actions. Anything unmapped falls back to the raw id. */
const ACTION_LABELS: Record<string, string> = {
  propose_sponsor_funding: 'Proposed a funding decision',
  confirm_sponsor_funding: 'Confirmed a funding decision',
  withdraw_sponsor_funding: 'Withdrew a funding proposal',
  sponsor_approve_submission: 'Approved a pitch',
  sponsor_decline_submission: 'Declined a pitch',
  invite_sponsor_member: 'Invited a teammate',
  remove_sponsor_member: 'Removed a teammate',
  update_sponsor_member_role: 'Changed a teammate’s role',
  update_org_approval_settings: 'Changed the approval policy',
  fulfillment_transition: 'Moved a payment forward',
  export_impact_report: 'Exported the impact report',
  proposal_no_eligible_approver: 'A proposal had no eligible approver',
}

export default async function SponsorActivityPage() {
  const result = await listSponsorAuditLog({ limit: 200 })

  if ('error' in result) {
    if (result.error === 'Unauthorized') redirect('/login')
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Activity</h1>
        </div>
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            {result.error === 'Forbidden'
              ? 'Only an organization admin can view your company’s activity log. Ask a teammate with that access.'
              : result.error}
          </CardContent>
        </Card>
      </div>
    )
  }

  const { entries } = result

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Activity</h1>
        <p className="text-muted-foreground mt-1">
          Who in your organization did what, and when. Read-only.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Organization activity</CardTitle>
          <CardDescription>
            Funding decisions, membership changes and policy changes made by your team. Actions
            taken by platform staff or by the teams you sponsor are shown by role rather than by
            name, and their details are not included.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {entries.length === 0 ? (
            <EmptyState
              className="py-16"
              icon={History}
              title="No activity yet"
              description="Funding decisions, teammate invitations and policy changes will appear here."
            />
          ) : (
            /* B-04-09. A scrollable region must be keyboard operable. */
            <div
              className="overflow-x-auto"
              tabIndex={0}
              role="region"
              aria-label="Organization activity log, scrollable"
            >
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b border-border">
                  <tr>
                    {['When', 'Who', 'What', 'Amount'].map((h) => (
                      <th
                        key={h}
                        scope="col"
                        className="px-4 py-3 text-left text-xs font-mono uppercase tracking-wider text-muted-foreground"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {entries.map((e) => (
                    <tr key={e.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                        {formatTransactionDate(e.created_at)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">{e.actor_label}</td>
                      <td className="px-4 py-3">{ACTION_LABELS[e.action] ?? e.action}</td>
                      <td className="px-4 py-3 whitespace-nowrap font-medium tabular-nums">
                        {e.amount_cents === null ? '—' : formatMoney(e.amount_cents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
