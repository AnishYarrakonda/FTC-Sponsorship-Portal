import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/page-header'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  EmailDomainRules,
  type EmailDomainRuleRow,
} from '@/components/admin/email-domain-rules'
import { SUPPORT_EMAIL } from '@/lib/site-config'

// The lists are edited in place and read on every sponsor application, so a cached page
// would show an admin a stale answer to "did my allowlist entry take effect?".
export const dynamic = 'force-dynamic'

export default async function EmailDomainRulesPage() {
  // Server client, so the admin-only SELECT policy (edr_select_admin, 0090) is what
  // authorizes this read. Both write actions re-check with requireAdmin() regardless of
  // what this page renders, and the route already sits inside the authenticated (admin)
  // group — no middleware change is needed for it.
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('email_domain_rules')
    .select('domain, rule, category, reason, updated_at')
    .order('domain', { ascending: true })

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Email domains"
        subtitle="Which mail domains may open a sponsor account. Coach signup is never gated on this list."
      />

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>
            Could not load the domain lists. Refresh the page, and if it keeps failing email{' '}
            {SUPPORT_EMAIL}.
          </AlertDescription>
        </Alert>
      ) : (
        <EmailDomainRules rows={(data ?? []) as EmailDomainRuleRow[]} />
      )}

      <div className="rounded-xl border border-border bg-card/50 px-5 py-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">How the gate behaves</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>A domain with an <strong>allow</strong> rule always wins, even over a block.</li>
          <li>A domain with no rule at all is treated as corporate and passes.</li>
          <li>
            If this table cannot be read, the gate <strong>fails open</strong> and reports to
            Sentry — a database hiccup must never close the sponsor funnel.
          </li>
          <li>
            Removing every <strong>block</strong> row disables the gate entirely, with no deploy.
          </li>
          <li>
            <strong>Coaches are out of scope.</strong> Volunteers legitimately sign up with
            personal email; the coach path never reads this table.
          </li>
        </ul>
      </div>
    </div>
  )
}
