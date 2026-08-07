import { getAuthedProfile } from '@/lib/actions-utils'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { TrendingUp, Wallet, Building2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export default async function SponsorFundingPage() {
  const authed = await getAuthedProfile()
  if (!authed) redirect('/login')
  const { supabase, user } = authed

  const { data: profile } = await supabase
    .from('profiles')
    .select('sponsor_id, sponsors(*)')
    .eq('id', user.id)
    .single()

  if (!profile?.sponsor_id) redirect('/dashboard')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sponsor = (profile as any)?.sponsors ?? null

  if (!sponsor) {
    return (
      <EmptyState
        className="py-20"
        icon={Building2}
        title="No funding account"
        description="Could not find a linked sponsor record for your account. Please contact an administrator."
      />
    )
  }

  const { data: transactions } = await supabase
    .from('transactions_ledger')
    .select('*, teams(team_name)')
    .eq('sponsor_id', profile.sponsor_id)
    .order('created_at', { ascending: false })

  const totalApproved = transactions?.reduce((s, t) => s + t.amount_cents, 0) ?? 0

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Funding</h1>
        <p className="text-muted-foreground mt-1">Track your approved sponsorships and disbursements.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-widest">Total Approved</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">${(totalApproved / 100).toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">Across all teams, all time</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-widest">Transactions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{transactions?.length || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">Confirmed disbursements</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Transaction History</CardTitle>
          <CardDescription>Funding disbursements to teams.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {transactions?.map((t: any) => (
              <div key={t.id} className="flex items-center justify-between py-3 border-b border-border last:border-0">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded bg-primary/10 flex items-center justify-center">
                    <TrendingUp className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    {/*
                      transactions_ledger.team_id has been nullable ON DELETE SET NULL
                      since 0061, so `t.teams` is null for any ledger row whose team was
                      deleted — exactly the state 0061 exists to create. Without the
                      optional chain this threw and took down the entire Funding page,
                      hiding every other transaction with it.
                    */}
                    <div className="font-medium">{(t.teams as any)?.team_name ?? 'Team no longer on the platform'}</div>
                    <div className="text-xs text-muted-foreground">{new Date(t.created_at).toLocaleDateString()}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-emerald-500">+${(t.amount_cents / 100).toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wider">Confirmed</div>
                </div>
              </div>
            ))}
            {(!transactions || transactions.length === 0) && (
              <EmptyState
                className="border-0 bg-transparent"
                icon={Wallet}
                title="No transactions yet"
                description="When you approve a team's pitch, the disbursement is recorded here against your funding cap."
                action={
                  <Link href="/sponsor/submissions" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
                    Review pending pitches
                  </Link>
                }
              />
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
