import Link from 'next/link'
import { ShieldAlert } from 'lucide-react'
import { requireSuperAdmin } from '@/lib/actions-utils'
import { PageHeader } from '@/components/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { AdminLevelControls, ProvisionAdminForm } from '@/components/admin/admin-level-controls'
import { ADMIN_LEVEL_DESCRIPTIONS, ADMIN_LEVEL_LABELS, type AdminLevel } from '@/lib/schemas/admin'

export default async function AdminTeamPage() {
  // A reviewer reaching this URL gets an explanation, not a crash and not a silent
  // redirect. The server actions behind the controls below are the real gate.
  let supabase, currentUserId: string
  try {
    const auth = await requireSuperAdmin()
    supabase = auth.supabase
    currentUserId = auth.user.id
  } catch {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader title="Admin team" subtitle="Who can do what in the admin portal." />
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert aria-hidden="true" className="h-5 w-5 text-muted-foreground" />
              Super admin access required
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Managing the admin team — promoting accounts, changing levels, removing access — is
              restricted to super admins. Your reviewer access covers the moderation queue and coach
              verification.
            </p>
            <Link href="/moderation" className={buttonVariants({ variant: 'outline' })}>
              Go to the review queue
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  const { data: admins } = await supabase
    .from('profiles')
    .select('id, full_name, email, admin_level, created_at')
    .eq('role', 'admin')
    .order('created_at', { ascending: true })

  const rows = admins ?? []
  const superAdminCount = rows.filter((a) => a.admin_level === 'super_admin').length

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Admin team"
        subtitle="Reviewers work the queue. Super admins additionally control funding caps, sponsor applications, exports, and this page."
      />

      <Card>
        <CardHeader>
          <CardTitle>Add an admin</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            The person must already have an account — Clerk owns sign-up. Enter the email they signed
            up with.
          </p>
          <ProvisionAdminForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {rows.length} admin{rows.length === 1 ? '' : 's'}
            {superAdminCount > 0 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                · {superAdminCount} super admin{superAdminCount === 1 ? '' : 's'}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {rows.length <= 1 && (
            <p className="text-sm text-muted-foreground">
              Only you. Add a reviewer above to hand off the moderation queue without handing over the
              funding caps.
            </p>
          )}

          <ul className="divide-y divide-border">
            {rows.map((admin) => (
              <li key={admin.id} className="flex flex-wrap items-center justify-between gap-4 py-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {admin.full_name ?? admin.email}
                    {admin.id === currentUserId && (
                      <Badge variant="outline" className="ml-2 align-middle">
                        You
                      </Badge>
                    )}
                  </p>
                  <p className="truncate text-sm text-muted-foreground">{admin.email}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {admin.admin_level
                      ? ADMIN_LEVEL_DESCRIPTIONS[admin.admin_level as AdminLevel]
                      : 'No level set — treated as a reviewer until one is assigned.'}
                    {' · Admin since '}
                    {new Date(admin.created_at).toLocaleDateString()}
                  </p>
                </div>
                <AdminLevelControls
                  profileId={admin.id}
                  level={(admin.admin_level as AdminLevel | null) ?? null}
                  isSelf={admin.id === currentUserId}
                />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        The database refuses any transaction that would leave zero super admins, so the last one
        cannot be demoted or deleted — by this page, by a script, or by direct SQL. Levels are:{' '}
        {ADMIN_LEVEL_LABELS.reviewer} and {ADMIN_LEVEL_LABELS.super_admin}.
      </p>
    </div>
  )
}
