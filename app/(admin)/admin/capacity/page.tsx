import { PageHeader } from '@/components/page-header'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { runCapacityAudit } from '@/app/actions/capacity-audit'
import { CapacityDriftTable } from '@/components/admin/capacity-drift-table'
import { LiveMatches } from './live-matches'

// The audit reads live rows and writes an audit_log entry each time it runs, so it must
// never be served from the full-route cache.
export const dynamic = 'force-dynamic'

export default async function CapacityAuditPage() {
  const result = await runCapacityAudit()

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Capacity audit"
        subtitle="Checks that every sponsor's recorded usage equals their open reservations plus their settled ledger."
      />

      {'error' in result ? (
        <Alert variant="destructive">
          <AlertDescription>{result.error}</AlertDescription>
        </Alert>
      ) : (
        <CapacityDriftTable rows={result.rows} sponsorCount={result.sponsorCount} />
      )}

      {/* Called as a function, not rendered as <LiveMatches />: both are Server Components
          and awaiting it here keeps the Supabase client out of a serialized prop boundary. */}
      {await LiveMatches()}

      <div className="rounded-xl border border-border bg-card/50 px-5 py-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">The invariant</p>
        {/* B-04-09. The drift formula is wider than the card on every viewport the audit
            tested (1024, 768, 375), so a keyboard user could not read past the clip. */}
        <pre className="mt-2 overflow-x-auto text-xs leading-relaxed" tabIndex={0} role="region" aria-label="The capacity invariant formula, scrollable">
{`sponsors.funding_used_cents
  = SUM(submissions.reserved_amount_cents WHERE status IN ('dispatched','delivered','opened'))
  + SUM(transactions_ledger.amount_cents)`}
        </pre>
        <p className="mt-3">
          Reserving happens at admin approval, settling at the sponsor&apos;s decision, and releasing on
          decline, partial fund, expiry, bounce, account deletion, or an admin voiding a match above.
          A void is a negative <code>transactions_ledger</code> row rather than a deletion, so the sum
          on the right stays correct without rewriting history. The same check runs nightly with the
          02:00 UTC cron and reports to Sentry.
        </p>
      </div>
    </div>
  )
}
