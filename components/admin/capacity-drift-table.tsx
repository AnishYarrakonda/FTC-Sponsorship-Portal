import { CheckCircle2, AlertTriangle } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import type { CapacityDriftRow } from '@/app/actions/capacity-audit'

function usd(cents: number) {
  const sign = cents < 0 ? '-' : ''
  return `${sign}$${(Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
}

export function CapacityDriftTable({
  rows,
  sponsorCount,
}: {
  rows: CapacityDriftRow[]
  sponsorCount: number
}) {
  // The good empty state. Zero rows means the invariant holds for every sponsor, which is
  // the answer this page exists to give — so say it plainly rather than showing "no data".
  if (rows.length === 0) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-emerald-600/30 bg-emerald-500/5 px-5 py-4">
        <CheckCircle2 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
        <div>
          <p className="text-sm font-medium text-foreground">
            No drift detected across {sponsorCount} sponsor{sponsorCount === 1 ? '' : 's'}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Every sponsor&apos;s <code className="text-xs">funding_used_cents</code> equals their open
            reservations plus their settled ledger.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3 rounded-xl border border-amber-600/30 bg-amber-500/5 px-5 py-4">
        <AlertTriangle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
        <div>
          <p className="text-sm font-medium text-foreground">
            {rows.length} sponsor{rows.length === 1 ? '' : 's'} violate the capacity invariant
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            A positive drift means funding is held that nothing accounts for — the sponsor&apos;s cap is
            under-served. A negative drift means the books under-count and the cap can be overrun.
            Nothing here is repaired automatically; a human decides.
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sponsor</TableHead>
              <TableHead className="text-right">Cap</TableHead>
              <TableHead className="text-right">Recorded used</TableHead>
              <TableHead className="text-right">Open reservations</TableHead>
              <TableHead className="text-right">Settled ledger</TableHead>
              <TableHead className="text-right">Expected used</TableHead>
              <TableHead className="text-right">Drift</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.sponsor_id}>
                <TableCell className="font-medium">{row.company_name}</TableCell>
                <TableCell className="text-right tabular-nums">{usd(row.funding_cap_cents)}</TableCell>
                <TableCell className="text-right tabular-nums">{usd(row.funding_used_cents)}</TableCell>
                <TableCell className="text-right tabular-nums">{usd(row.open_reservations_cents)}</TableCell>
                <TableCell className="text-right tabular-nums">{usd(row.settled_ledger_cents)}</TableCell>
                <TableCell className="text-right tabular-nums">{usd(row.expected_used_cents)}</TableCell>
                <TableCell className="text-right">
                  <Badge variant="destructive" className="tabular-nums">
                    {row.drift_cents > 0 ? '+' : ''}
                    {usd(row.drift_cents)}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
