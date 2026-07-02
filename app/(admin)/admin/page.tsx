import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/page-header'
import { StatusBadge } from '@/components/ui/status-badge'
import { Inbox, Users, Building2, AlertCircle, CheckCircle2, Clock, ArrowUpRight } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function AdminDashboardPage() {
  const supabase = await createClient()

  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const [
    { data: pendingSubmissions, count: pendingCount },
    { data: pendingCoaches, count: pendingCoachesCount },
    { count: submissionsTodayCount },
    { count: approvedWeekCount },
    { count: declinedWeekCount },
    { data: recentActivity },
    { data: sponsorsNearCap },
  ] = await Promise.all([
    supabase
      .from('submissions')
      .select('id, updated_at, team_id, sponsor_id, teams:team_id(team_name), sponsors:sponsor_id(company_name)', { count: 'exact' })
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(5),
    supabase
      .from('profiles')
      .select('id, full_name, email, created_at', { count: 'exact' })
      .eq('role', 'coach')
      .eq('coach_verified', false)
      .not('coach_credentials_url', 'is', null)
      .order('created_at', { ascending: true })
      .limit(5),
    supabase.from('submissions').select('id', { count: 'exact', head: true }).gte('created_at', startOfToday),
    supabase.from('submissions').select('id', { count: 'exact', head: true }).eq('status', 'approved').gte('updated_at', sevenDaysAgo),
    supabase.from('submissions').select('id', { count: 'exact', head: true }).eq('status', 'declined').gte('updated_at', sevenDaysAgo),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from('v_submission_summary').select('*').order('updated_at', { ascending: false }).limit(8),
    supabase.from('v_sponsor_capacity').select('id, company_name, utilization_pct, funding_cap_cents, funding_used_cents').eq('status', 'active').gte('utilization_pct', 80).order('utilization_pct', { ascending: false }).limit(5),
  ])

  const needsAttention = (pendingCount ?? 0) + (pendingCoachesCount ?? 0) + (sponsorsNearCap?.length ?? 0)

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Admin Dashboard"
        subtitle="Operational overview — queue health, pending actions, and today's activity."
      />

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <ActionCard icon={<AlertCircle className="h-4 w-4" strokeWidth={1.5} />} label="Needs Attention" value={String(needsAttention)} sub={needsAttention > 0 ? 'Items waiting on admin' : 'All clear'} highlight={needsAttention > 0} />
        <ActionCard icon={<Inbox className="h-4 w-4" strokeWidth={1.5} />} label="Pending Review" value={String(pendingCount ?? 0)} sub="Submissions awaiting moderation" href="/moderation" />
        <ActionCard icon={<Users className="h-4 w-4" strokeWidth={1.5} />} label="Coach Verifications" value={String(pendingCoachesCount ?? 0)} sub="Credentials uploaded" href="/coaches" />
        <ActionCard icon={<Clock className="h-4 w-4" strokeWidth={1.5} />} label="Submitted Today" value={String(submissionsTodayCount ?? 0)} sub="New submissions in last 24h" />
      </div>

      {/* Two-column ops */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Moderation Queue</CardTitle>
              <Link href="/moderation" className={cn(buttonVariants({ size: 'sm' }))}>Open queue</Link>
            </div>
          </CardHeader>
          <CardContent>
            {pendingSubmissions && pendingSubmissions.length > 0 ? (
              <div className="flex flex-col gap-2">
                {pendingSubmissions.map((s) => {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const team = (s.teams as any)
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const sponsor = (s.sponsors as any)
                  return (
                    <div key={s.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {team?.team_name ?? 'Unknown'} → {sponsor?.company_name ?? 'Unknown'}
                        </p>
                        <p className="text-xs text-muted-foreground" suppressHydrationWarning>
                          {new Date(s.updated_at).toLocaleDateString()}
                        </p>
                      </div>
                      <Link href="/moderation" className={cn(buttonVariants({ size: 'sm', variant: 'ghost' }))}>
                        Review <ArrowUpRight className="ml-1 h-3 w-3" strokeWidth={1.5} />
                      </Link>
                    </div>
                  )
                })}
              </div>
            ) : (
              <EmptyState text="Queue is empty. Nothing to review right now." />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Coaches Awaiting Verification</CardTitle>
              <Link href="/coaches" className={cn(buttonVariants({ size: 'sm' }))}>Manage coaches</Link>
            </div>
          </CardHeader>
          <CardContent>
            {pendingCoaches && pendingCoaches.length > 0 ? (
              <div className="flex flex-col gap-2">
                {pendingCoaches.map((c) => (
                  <div key={c.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{c.full_name}</p>
                      <p className="text-xs text-muted-foreground">{c.email}</p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground" suppressHydrationWarning>
                      {new Date(c.created_at).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState text="No coaches waiting for verification." />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Week-at-a-glance + sponsors near cap */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>This Week</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <WeekStat icon={<CheckCircle2 className="h-4 w-4 text-emerald-400" strokeWidth={1.5} />} label="Approved" value={approvedWeekCount ?? 0} />
              <WeekStat icon={<AlertCircle className="h-4 w-4 text-rose-400" strokeWidth={1.5} />} label="Declined" value={declinedWeekCount ?? 0} />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Rolling 7-day window. See Analytics for deeper trends.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Sponsors Near Capacity</CardTitle></CardHeader>
          <CardContent>
            {sponsorsNearCap && sponsorsNearCap.length > 0 ? (
              <div className="flex flex-col gap-3">
                {sponsorsNearCap.map((s) => {
                  const pct = Math.min(Number(s.utilization_pct ?? 0), 100)
                  return (
                    <div key={s.id}>
                      <div className="mb-1 flex justify-between text-sm">
                        <span className="font-medium text-foreground">{s.company_name}</span>
                        <span className={pct >= 95 ? 'text-destructive' : 'text-amber-500'}>{pct}%</span>
                      </div>
                      <div className="h-1 w-full rounded-full bg-muted">
                        <div className={cn('h-1 rounded-full transition-all', pct >= 95 ? 'bg-destructive' : 'bg-amber-500')} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <EmptyState text="No sponsors are near their funding cap." />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent activity */}
      <Card>
        <CardHeader><CardTitle>Recent Activity</CardTitle></CardHeader>
        <CardContent>
          {recentActivity && recentActivity.length > 0 ? (
            <div className="divide-y divide-border">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {(recentActivity as any[]).map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-foreground">
                      <span className="font-medium">{a.team_name}</span>
                      {' → '}
                      <span className="text-muted-foreground">{a.company_name}</span>
                    </p>
                    <div className="mt-1">
                      <StatusBadge status={a.status} />
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground" suppressHydrationWarning>
                    {new Date(a.updated_at).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState text="No activity yet." />
          )}
        </CardContent>
      </Card>

      {/* Quick links */}
      <div className="grid gap-4 sm:grid-cols-3">
        <QuickLink href="/sponsors/new" icon={<Building2 className="h-4 w-4" strokeWidth={1.5} />} label="Add Sponsor" sub="Register a new funding partner" />
        <QuickLink href="/applications" icon={<Inbox className="h-4 w-4" strokeWidth={1.5} />} label="Sponsor Applications" sub="Incoming interest from companies" />
        <QuickLink href="/analytics" icon={<ArrowUpRight className="h-4 w-4" strokeWidth={1.5} />} label="Open Analytics" sub="Platform-wide trends and charts" />
      </div>
    </div>
  )
}

function ActionCard({ icon, label, value, sub, highlight, href }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; highlight?: boolean; href?: string
}) {
  const inner = (
    <Card className="h-full">
      <CardContent className="pt-5">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          {icon}
          <p className="text-xs font-mono uppercase tracking-widest">{label}</p>
        </div>
        <p className={cn('mt-1 text-3xl font-semibold tabular-nums tracking-tight', highlight ? 'text-amber-500' : 'text-foreground')} suppressHydrationWarning>
          {value}
        </p>
        {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  )
  return href ? <Link href={href} className="block no-underline">{inner}</Link> : inner
}

function WeekStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        <span className="font-mono uppercase tracking-widest">{label}</span>
      </div>
      <p className="mt-1 text-2xl font-semibold text-foreground" suppressHydrationWarning>{value}</p>
    </div>
  )
}

function QuickLink({ href, icon, label, sub }: { href: string; icon: React.ReactNode; label: string; sub: string }) {
  return (
    <Link href={href} className="block rounded-xl border border-border p-4 no-underline transition-colors hover:bg-accent/50">
      <div className="flex items-center gap-2 text-foreground">
        {icon}
        <span className="text-sm font-medium">{label}</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
    </Link>
  )
}

function EmptyState({ text }: { text: string }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{text}</p>
}
