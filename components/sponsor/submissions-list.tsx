'use client'

import { useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { FileText, Search, Filter, ArrowUpRight, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { StatusBadge } from '@/components/ui/status-badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { isAwaitingSponsor } from '@/lib/submission-status'

/**
 * "New Request" is a GROUP, not a single status. A dispatched pitch moves to `delivered`
 * within seconds of the Resend webhook firing, and to `opened` when the sponsor reads the
 * email — so it spends nearly its entire decidable life in a state this list could not
 * filter for. Selecting "New Request" therefore HID the very pitches awaiting a decision,
 * while the sidebar badge (corrected to count AWAITING_SPONSOR_STATUSES) said there were
 * three. `bounced` had no entry at all.
 */
const STATUS_FILTERS = [
  { value: 'all', label: 'All statuses' },
  { value: 'awaiting', label: 'Awaiting your decision' },
  { value: 'approved', label: 'Approved' },
  { value: 'declined', label: 'Declined' },
  { value: 'changes_requested', label: 'Changes Requested' },
  { value: 'expired', label: 'Expired' },
  { value: 'bounced', label: 'Undelivered' },
] as const

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function SponsorSubmissionsList({ submissions }: { submissions: any[] }) {
  // Seed the search box from ?q= (set by the dashboard "Team Search" card)
  const searchParams = useSearchParams()
  const [query, setQuery] = useState(searchParams?.get('q') ?? '')
  const [status, setStatus] = useState<string>('all')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return submissions.filter((s) => {
      const matchesStatus =
        status === 'all' ||
        (status === 'awaiting' ? isAwaitingSponsor(s.status) : s.status === status)
      const name = String(s.teams?.team_name ?? '').toLowerCase()
      const num = String(s.teams?.ftc_team_number ?? '')
      const matchesQuery = q === '' || name.includes(q) || num.includes(q)
      return matchesStatus && matchesQuery
    })
  }, [submissions, query, status])

  const activeLabel = STATUS_FILTERS.find((f) => f.value === status)?.label ?? 'All statuses'

  return (
    <>
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search teams by name or number"
            placeholder="Search teams..."
            className="w-full bg-card border border-border rounded-md pl-9 py-2 text-sm outline-none focus:ring-1 focus:ring-primary/50 transition-shadow"
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2 border-border shadow-sm">
              <Filter className="h-4 w-4" />
              {activeLabel}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {STATUS_FILTERS.map((f) => (
              <DropdownMenuItem key={f.value} onClick={() => setStatus(f.value)} className="gap-2">
                <Check className={cn('h-3.5 w-3.5', status === f.value ? 'opacity-100' : 'opacity-0')} />
                {f.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="grid gap-4">
        {filtered.map((s) => (
          <SubmissionRow key={s.id} submission={s} />
        ))}
        {filtered.length === 0 && (
          submissions.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No sponsorship requests yet"
              description="Approved team pitches will appear here as soon as an admin dispatches them to you — you'll also get an email."
            />
          ) : (
            <EmptyState
              icon={Search}
              title="No requests match your search"
              description="Try a different team name or number, or reset the status filter."
              action={
                <Button variant="outline" size="sm" onClick={() => { setQuery(''); setStatus('all') }}>
                  Clear search & filters
                </Button>
              }
            />
          )
        )}
      </div>
    </>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function SubmissionRow({ submission }: { submission: any }) {
  return (
    <Link href={`/sponsor/submissions/${submission.id}`}>
      <Card className="hover:border-border/80 hover:shadow-sm transition-all cursor-pointer group shadow-sm bg-card border-border">
        <CardContent className="p-4 flex items-center justify-between gap-6">
          <div className="flex items-center gap-4 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/5 border border-primary/10 text-primary font-medium tabular-nums shadow-sm transition-colors group-hover:bg-primary group-hover:text-primary-foreground text-sm">
              {submission.teams?.ftc_team_number || '??'}
            </div>
            <div className="min-w-0">
              <div className="text-[15px] font-medium truncate group-hover:text-primary transition-colors text-foreground">{submission.teams?.team_name || 'Unknown Team'}</div>
              <div className="text-sm text-muted-foreground mt-0.5">
                {submission.teams?.city || 'Unknown'}, {submission.teams?.state || 'Unknown'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            <StatusBadge status={submission.status} label={submission.status === 'dispatched' ? 'New Request' : undefined} />
            <div className="text-xs text-muted-foreground tabular-nums">
              {new Date(submission.created_at).toLocaleDateString()}
            </div>
            <ArrowUpRight aria-hidden="true" className="h-4 w-4 text-muted-foreground/40 group-hover:text-foreground group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all" />
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}
