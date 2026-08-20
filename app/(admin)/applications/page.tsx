import { createClient } from '@/lib/supabase/server'
import { getAuthedProfile } from '@/lib/actions-utils'
import Link from 'next/link'
import { Inbox, AlertTriangle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/status-badge'
import { EmptyState } from '@/components/ui/empty-state'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ApplicationActions } from '@/components/admin/application-actions'

export default async function ApplicationsPage() {
  const supabase = await createClient()

  // Reviewers see the pipeline (the admin SELECT policy is unchanged) but cannot decide
  // an application — approving one mints a capped sponsor company (0084).
  const authed = await getAuthedProfile()
  const isSuperAdmin = authed?.user.admin_level === 'super_admin'

  const { data: applications } = await supabase
    .from('sponsor_applications')
    .select('*')
    .order('created_at', { ascending: false })

  const pending  = applications?.filter(a => a.status === 'pending') ?? []
  const reviewed = applications?.filter(a => a.status !== 'pending') ?? []

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Sponsor Applications</h1>
        <p className="text-muted-foreground mt-1">
          Companies who applied via the public form. Approve to add them to the sponsor directory.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          Pending Review
          {pending.length > 0 && (
            <span className="rounded-full bg-[var(--badge-warning-bg)] px-2 py-0.5 text-xs font-semibold text-[var(--badge-warning-text)]">
              {pending.length}
            </span>
          )}
        </h2>
        {pending.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="No pending applications"
            description="New sponsor applications from the public form will appear here for review."
            action={
              <Link href="/sponsors/new" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
                Add a sponsor manually
              </Link>
            }
          />
        ) : (
          <div className="space-y-3">
            {pending.map(app => (
              <Card key={app.id}>
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="text-lg">{app.company_name}</CardTitle>
                      <CardDescription suppressHydrationWarning>
                        {app.contact_name} ({app.contact_email}) · Applied {new Date(app.created_at).toLocaleDateString()}
                      </CardDescription>
                      {app.website && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          <a
                            href={app.website.startsWith('http') ? app.website : `https://${app.website}`}
                            target="_blank"
                            rel="noreferrer"
                            className="underline underline-offset-2 hover:text-foreground"
                          >
                            {app.website}
                          </a>
                        </p>
                      )}
                      {/* Advisory only — a mismatch is never an auto-rejection (0090). */}
                      {app.domain_match === 'mismatch' && (
                        <p className="mt-2 inline-flex flex-wrap items-center gap-1.5 rounded-full bg-[var(--badge-warning-bg)] px-2.5 py-1 text-xs font-medium text-[var(--badge-warning-text)]">
                          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                          Email domain doesn&apos;t match company website
                          <span className="font-normal">
                            ({app.email_domain ?? 'unknown'} vs {app.website_domain ?? 'unknown'})
                          </span>
                        </p>
                      )}
                    </div>
                    <StatusBadge status={app.status} />
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex gap-6 text-sm">
                    <div>
                      <p className="text-muted-foreground text-xs">Proposed Cap</p>
                      <p className="font-medium">
                        ${(app.proposed_cap_cents / 100).toLocaleString('en-US')}
                      </p>
                    </div>
                  </div>
                  {app.message && (
                    <p className="text-sm text-muted-foreground bg-muted/30 rounded p-3">
                      {app.message}
                    </p>
                  )}
                  <div className="flex justify-end pt-1">
                    {isSuperAdmin ? (
                      <ApplicationActions applicationId={app.id} />
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Only a super admin can approve or reject an application.
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {reviewed.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-muted-foreground">Reviewed</h2>
          <div className="space-y-2">
            {reviewed.map(app => (
              <div key={app.id} className="flex items-center justify-between border rounded p-3">
                <div>
                  <p className="font-medium text-sm">{app.company_name}</p>
                  <p className="text-xs text-muted-foreground">{app.contact_email}</p>
                </div>
                <StatusBadge status={app.status} />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
