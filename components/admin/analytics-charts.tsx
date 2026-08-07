'use client'

import {
  LineChart, Line, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ScatterChart, Scatter,
} from 'recharts'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { StatCard } from '@/components/ui/stat-card'
import { FileText, CheckCircle2, Clock, Building2 } from 'lucide-react'

export default function AnalyticsCharts() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    const fetchData = async () => {
      const supabase = createClient()

      const [{ data: subs, error: subsError }, { data: sponsors, error: sponsorsError }] =
        await Promise.all([
          supabase.from('submissions').select('*'),
          supabase.from('sponsors').select('*'),
        ])

      // This used to be a bare `if (!subs || !sponsors) return`, which skipped the
      // setLoading(false) at the end of the effect — so any query failure left the page
      // rendering "Loading charts..." forever, with no error and no retry. There is also
      // no try/catch around the effect, so a throw did the same thing.
      if (subsError || sponsorsError || !subs || !sponsors) {
        console.error('[analytics-charts] failed to load', { subsError, sponsorsError })
        setLoadError('Charts could not be loaded. Refresh the page to try again.')
        setLoading(false)
        return
      }

      // Timeline: submissions over time
      const timeline: Record<string, { date: string; submitted: number; approved: number }> = {}
      subs.forEach((s: any) => {
        const date = new Date(s.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        if (!timeline[date]) timeline[date] = { date, submitted: 0, approved: 0 }
        timeline[date].submitted++
        if (s.status === 'approved') timeline[date].approved++
      })
      const timelineData = Object.values(timeline).slice(-30)

      // Sponsor funding utilization
      const sponsorData = sponsors.map((s: any) => ({
        name: s.company_name,
        used: s.funding_used_cents / 100,
        cap: s.funding_cap_cents / 100,
        utilization: Math.round((s.funding_used_cents / s.funding_cap_cents) * 100),
      })).sort((a: any, b: any) => b.utilization - a.utilization).slice(0, 10)

      // Status breakdown. This counted only 4 of the 10 enum values, so every pitch that
      // was actually live with a sponsor (dispatched/delivered/opened) plus every expired,
      // bounced or changes_requested one simply vanished from the chart — and the totals
      // did not add up to totalSubmissions, with nothing to indicate why.
      const countOf = (...statuses: string[]) =>
        subs.filter((s: any) => statuses.includes(s.status)).length

      const statusCounts = {
        approved: countOf('approved'),
        awaiting: countOf('dispatched', 'delivered', 'opened'),
        pending: countOf('pending'),
        declined: countOf('declined', 'changes_requested'),
        closed: countOf('expired', 'bounced'),
        draft: countOf('draft'),
      }
      const statusData = [
        { name: 'Approved', value: statusCounts.approved, color: 'var(--chart-2)' },
        { name: 'With sponsor', value: statusCounts.awaiting, color: 'var(--chart-1)' },
        { name: 'Pending review', value: statusCounts.pending, color: 'var(--chart-3)' },
        { name: 'Declined', value: statusCounts.declined, color: 'var(--chart-4)' },
        { name: 'Expired / undelivered', value: statusCounts.closed, color: 'var(--chart-5)' },
        { name: 'Draft', value: statusCounts.draft, color: 'var(--muted-foreground)' },
      ].filter(s => s.value > 0)

      // Ask size distribution
      const askBuckets: Record<string, number> = {}
      subs.forEach((s: any) => {
        const ask = (s.financial_ask_cents || 0) / 100
        const bucket = ask < 500 ? '<$500' : ask < 1000 ? '$500–$1k' : ask < 3000 ? '$1k–$3k' : ask < 5000 ? '$3k–$5k' : '$5k+'
        askBuckets[bucket] = (askBuckets[bucket] || 0) + 1
      })
      const askData = ['<$500', '$500–$1k', '$1k–$3k', '$3k–$5k', '$5k+'].map(range => ({
        range,
        count: askBuckets[range] || 0,
      }))

      // Average response time (days to decision)
      const responseTimes: number[] = []
      subs.forEach((s: any) => {
        if (s.reviewed_at && s.created_at) {
          const days = Math.round(
            (new Date(s.reviewed_at).getTime() - new Date(s.created_at).getTime()) / (1000 * 60 * 60 * 24)
          )
          if (days >= 0 && days <= 365) responseTimes.push(days)
        }
      })
      const avgResponseTime = responseTimes.length > 0 ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) : 0

      setData({
        timelineData,
        sponsorData,
        statusData,
        askData,
        avgResponseTime,
        totalSubmissions: subs.length,
        approvalRate: subs.length > 0 ? Math.round((statusCounts.approved / subs.length) * 100) : 0,
      })
      setLoading(false)
    }

    fetchData().catch((e) => {
      console.error('[analytics-charts] fetch threw', e)
      setLoadError('Charts could not be loaded. Refresh the page to try again.')
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="text-muted-foreground text-sm py-8">Loading charts...</div>
  if (loadError) return <div className="text-destructive text-sm py-8" role="alert">{loadError}</div>

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null
    return (
      <div className="rounded-lg border border-border bg-card/95 px-3 py-2 shadow-xl text-xs">
        {payload.map((p: any, i: number) => (
          <div key={i} className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full inline-block" style={{ background: p.color || p.fill }} />
            <span className="text-muted-foreground">{p.name}:</span>
            <span className="font-mono text-foreground font-medium">{p.value}</span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-20">
      {/* KPI Summary Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={FileText}
          label="Total Submissions"
          value={data?.totalSubmissions || 0}
          description="All time requests"
        />
        <StatCard
          icon={CheckCircle2}
          label="Approval Rate"
          value={`${data?.approvalRate || 0}%`}
          description="Successful pitches"
          iconContainerClassName="bg-emerald-500/10 text-status-success"
        />
        <StatCard
          icon={Clock}
          label="Avg Response Time"
          value={`${data?.avgResponseTime || 0}d`}
          description="Days to decision"
        />
        <StatCard
          icon={Building2}
          label="Active Sponsors"
          value={data?.sponsorData?.length || 0}
          description="In portal"
        />
      </div>

      {/* Row 1: Timeline + Status */}
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <h3 className="text-[15px] font-medium text-foreground tracking-tight mb-1">Submissions Over Time</h3>
          <p className="text-sm text-muted-foreground mb-6">Last 30 days</p>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data?.timelineData || []} margin={{ left: -20, right: 10, bottom: 0, top: 10 }}>
                <defs>
                  <linearGradient id="grad1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="grad2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--chart-2)" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="var(--chart-2)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--chart-grid)" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: 'var(--chart-tick)', fontSize: 11 }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--chart-tick)', fontSize: 11 }} dx={-10} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="submitted" name="Submitted" stroke="var(--chart-1)" strokeWidth={2} fill="url(#grad1)" />
                <Area type="monotone" dataKey="approved" name="Approved" stroke="var(--chart-2)" strokeWidth={2} fill="url(#grad2)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <h3 className="text-[15px] font-medium text-foreground tracking-tight mb-1">Status Distribution</h3>
          <p className="text-sm text-muted-foreground mb-6">All submissions</p>
          <div className="h-[260px] flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data?.statusData || []} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={2} dataKey="value" stroke="none">
                  {(data?.statusData || []).map((entry: any, i: number) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Row 2: Ask Size + Sponsor Utilization */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <h3 className="text-[15px] font-medium text-foreground tracking-tight mb-1">Funding Ask Distribution</h3>
          <p className="text-sm text-muted-foreground mb-6">By request amount</p>
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.askData || []} margin={{ left: -20, right: 10, bottom: 0, top: 10 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--chart-grid)" />
                <XAxis dataKey="range" axisLine={false} tickLine={false} tick={{ fill: 'var(--chart-tick)', fontSize: 11 }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--chart-tick)', fontSize: 11 }} dx={-10} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="count" name="Submissions" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={50} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <h3 className="text-[15px] font-medium text-foreground tracking-tight mb-1">Top Sponsors by Utilization</h3>
          <p className="text-sm text-muted-foreground mb-6">Funding cap usage</p>
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.sponsorData?.slice(0, 8) || []} layout="vertical" margin={{ left: 0, right: 10, bottom: 0, top: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--chart-grid)" />
                <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: 'var(--chart-tick)', fontSize: 11 }} dx={-5} />
                <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fill: 'var(--chart-tick)', fontSize: 11 }} width={110} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="utilization" name="Utilization %" fill="var(--chart-5)" radius={[0, 4, 4, 0]} barSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Row 3: Detailed Sponsor Table */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm overflow-hidden">
        <h3 className="text-[15px] font-medium text-foreground tracking-tight mb-4">Sponsor Funding Breakdown</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-3 px-4 text-xs uppercase tracking-widest font-medium text-muted-foreground">Sponsor</th>
                <th className="text-right py-3 px-4 text-xs uppercase tracking-widest font-medium text-muted-foreground">Cap</th>
                <th className="text-right py-3 px-4 text-xs uppercase tracking-widest font-medium text-muted-foreground">Used</th>
                <th className="text-right py-3 px-4 text-xs uppercase tracking-widest font-medium text-muted-foreground">Remaining</th>
                <th className="text-right py-3 px-4 text-xs uppercase tracking-widest font-medium text-muted-foreground">Utilization</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(data?.sponsorData || []).slice(0, 10).map((s: any, i: number) => (
                <tr key={i} className="hover:bg-accent/40 transition-colors">
                  <td className="py-3 px-4 text-sm font-medium text-foreground">{s.name}</td>
                  <td className="text-right py-3 px-4 font-mono text-sm text-muted-foreground">${s.cap.toLocaleString()}</td>
                  <td className="text-right py-3 px-4 font-mono text-sm text-muted-foreground">${s.used.toLocaleString()}</td>
                  <td className="text-right py-3 px-4 font-mono text-sm text-foreground font-medium">${(s.cap - s.used).toLocaleString()}</td>
                  <td className="text-right py-3 px-4">
                    <div className="flex items-center justify-end gap-3">
                      <div className="w-20 h-1.5 bg-border rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500" style={{ width: `${Math.min(s.utilization, 100)}%` }} />
                      </div>
                      <span className="text-xs font-mono font-medium w-10 text-right">{s.utilization}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
