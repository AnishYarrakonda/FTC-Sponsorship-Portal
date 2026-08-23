'use client'

import { useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface AuditEntry {
  id: string
  action: string
  actor_id: string | null
  actor: { full_name: string; role: string } | null
  entity_type: string
  entity_id: string | null
  metadata: Record<string, unknown>
  created_at: string
}

const ACTION_COLORS: Record<string, string> = {
  approve_submission:           'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  decline_submission:           'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  request_edit_submission:      'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  create_sponsor:               'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  update_sponsor:               'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  delete_sponsor:               'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  approve_sponsor_application:  'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  toggle_sponsor_status:        'bg-slate-100 text-slate-800 dark:bg-slate-900/40 dark:text-slate-300',
  sponsor_accept:               'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  sponsor_decline:              'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
}

function ActionChip({ action }: { action: string }) {
  const color = ACTION_COLORS[action] ?? 'bg-muted text-muted-foreground'
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', color)}>
      {action.replace(/_/g, ' ')}
    </span>
  )
}

function RelativeTime({ iso }: { iso: string }) {
  const date = new Date(iso)
  const diff = Date.now() - date.getTime()
  const mins = Math.floor(diff / 60000)
  const hrs = Math.floor(mins / 60)
  const days = Math.floor(hrs / 24)
  let label = 'just now'
  if (days > 0) label = `${days}d ago`
  else if (hrs > 0) label = `${hrs}h ago`
  else if (mins > 0) label = `${mins}m ago`
  return (
    <time dateTime={iso} title={date.toLocaleString()} className="text-xs text-muted-foreground tabular-nums">
      {label}
    </time>
  )
}

function MetaRow({ entry }: { entry: AuditEntry }) {
  const [open, setOpen] = useState(false)
  const hasMeta = Object.keys(entry.metadata ?? {}).length > 0
  return (
    <>
      <tr className="border-b border-border hover:bg-accent/30 transition-colors">
        <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
          {entry.actor?.full_name ?? entry.actor_id?.slice(0, 8) ?? '—'}
          {entry.actor?.role && (
            <span className="ml-1 opacity-50">({entry.actor.role})</span>
          )}
        </td>
        <td className="px-4 py-3"><ActionChip action={entry.action} /></td>
        <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
          {entry.entity_type}
          {entry.entity_id && (
            <span className="ml-1 opacity-50">·{entry.entity_id.slice(0, 8)}</span>
          )}
        </td>
        <td className="px-4 py-3">
          <RelativeTime iso={entry.created_at} />
        </td>
        <td className="px-4 py-3">
          {hasMeta && (
            <button
              onClick={() => setOpen((o) => !o)}
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Toggle metadata"
            >
              {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          )}
        </td>
      </tr>
      {open && hasMeta && (
        <tr className="border-b border-border bg-muted/30">
          <td colSpan={5} className="px-4 py-3">
            <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-all">
              {JSON.stringify(entry.metadata, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
  )
}

interface Props {
  logs: AuditEntry[]
  uniqueActions: string[]
  currentAction?: string
  page: number
  pageSize: number
  total: number
}

export function AuditLogTable({ logs, uniqueActions, currentAction, page, pageSize, total }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const totalPages = Math.ceil(total / pageSize)

  const navigate = (updates: Record<string, string | undefined>) => {
    const sp = new URLSearchParams(searchParams)
    for (const [k, v] of Object.entries(updates)) {
      if (v === undefined) sp.delete(k)
      else sp.set(k, v)
    }
    router.replace(`${pathname}?${sp}`)
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {/* B-04-04. The select had no id, no label and no aria-label, so its accessible
            name was whatever option happened to be selected — "All actions" one moment
            and "sponsor decide submission" the next. A control whose name changes when
            you use it cannot be found again. A visible label also tells sighted users
            what the dropdown filters, which was equally unstated. */}
        <label htmlFor="audit-action-filter" className="text-xs text-muted-foreground">
          Filter by action
        </label>
        <select
          id="audit-action-filter"
          value={currentAction ?? ''}
          onChange={(e) => navigate({ action: e.target.value || undefined, page: undefined })}
          className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">All actions</option>
          {uniqueActions.map((a) => (
            <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>
          ))}
        </select>
        {currentAction && (
          <Button variant="ghost" size="sm" onClick={() => navigate({ action: undefined, page: undefined })}>
            Clear filter
          </Button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">{total} events</span>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full">
          <thead className="border-b border-border bg-muted/40">
            <tr>
              {/* P3. The fifth header was an empty string — a column with no name at all,
                  which a screen reader reads as a blank header for whatever the cells
                  below it contain. `scope="col"` added throughout at the same time. */}
              {[
                { label: 'Actor', visible: true },
                { label: 'Action', visible: true },
                { label: 'Entity', visible: true },
                { label: 'Time', visible: true },
                { label: 'Details', visible: false },
              ].map((h) => (
                <th
                  key={h.label}
                  scope="col"
                  className="px-4 py-2.5 text-left text-xs font-mono uppercase tracking-widest text-muted-foreground"
                >
                  {h.visible ? h.label : <span className="sr-only">{h.label}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-sm text-muted-foreground">
                  No audit events found.
                </td>
              </tr>
            ) : (
              logs.map((log) => <MetaRow key={log.id} entry={log} />)
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline" size="sm"
              disabled={page <= 1}
              onClick={() => navigate({ page: String(page - 1) })}
            >
              Previous
            </Button>
            <Button
              variant="outline" size="sm"
              disabled={page >= totalPages}
              onClick={() => navigate({ page: String(page + 1) })}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
