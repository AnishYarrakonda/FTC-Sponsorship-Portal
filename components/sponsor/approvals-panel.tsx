'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { ShieldCheck, Clock, Settings } from 'lucide-react'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { EmptyState } from '@/components/ui/empty-state'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  confirmFundingProposal,
  rejectFundingProposal,
  withdrawFundingProposal,
} from '@/app/actions/sponsor-approvals'
import type { SponsorRole } from '@/lib/sponsor-roles'

type Proposal = {
  id: string
  submission_id: string
  amount_cents: number
  feedback: string | null
  status: string
  origin: string
  proposed_by: string | null
  proposed_at: string
  decided_by: string | null
  decided_at: string | null
  decision_note: string | null
  closed_reason: string | null
  settled_amount_cents: number | null
  expires_at: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  submissions?: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  proposer?: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  approver?: any
}

function money(cents: number) {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
}

function timeLeft(expiresAt: string): { label: string; urgent: boolean } {
  const ms = new Date(expiresAt).getTime() - Date.now()
  if (ms <= 0) return { label: 'Expiring now', urgent: true }
  const hours = Math.floor(ms / 3_600_000)
  if (hours < 24) return { label: `${hours}h left`, urgent: true }
  const days = Math.floor(hours / 24)
  return { label: `${days}d left`, urgent: days <= 1 }
}

function teamLabel(proposal: Proposal): string {
  const team = proposal.submissions?.teams
  if (!team) return 'Unknown team'
  return team.ftc_team_number ? `${team.team_name} (#${team.ftc_team_number})` : team.team_name
}

const CLOSED_REASON_LABELS: Record<string, string> = {
  already_decided: 'Settled through another link before this was confirmed',
  invalid_status: 'The pitch moved to a state that can no longer be decided',
  window_elapsed: 'Nobody confirmed it within the approval window',
  self_approval: 'Blocked — the proposer cannot approve their own request',
  submission_declined: 'The pitch was declined',
  submission_changes_requested: 'Changes were requested on the pitch',
  submission_expired: 'The underlying request expired',
  submission_bounced: "The pitch's email could not be delivered",
}

export function ApprovalsPanel({
  proposals,
  memberRole,
  currentProfileId,
  canAct,
  approvalsEnabled,
  isOrgAdmin,
}: {
  proposals: Proposal[]
  memberRole: SponsorRole
  currentProfileId: string
  canAct: boolean
  approvalsEnabled: boolean
  isOrgAdmin: boolean
}) {
  const pending = proposals.filter((p) => p.status === 'pending')
  const closed = proposals.filter((p) => p.status !== 'pending')

  if (memberRole === 'viewer') {
    return (
      <div className="space-y-4">
        <Alert>
          <AlertDescription>
            Your role is view-only. You can see the approvals queue, but only an Approver or Admin can act on it.
          </AlertDescription>
        </Alert>
        <ApprovalsTable proposals={pending} canAct={false} currentProfileId={currentProfileId} isOrgAdmin={false} />
        {closed.length > 0 && <ClosedProposals proposals={closed} />}
      </div>
    )
  }

  if (pending.length === 0) {
    return (
      <div className="space-y-8">
        <EmptyState
          icon={ShieldCheck}
          title="Nothing is waiting on you."
          description="Funding requests that need a second approver will show up here."
          action={
            isOrgAdmin && !approvalsEnabled ? (
              <Link href="/sponsor/settings" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
                <Settings className="h-3.5 w-3.5" />
                Turn on two-step approval in Settings
              </Link>
            ) : undefined
          }
        />
        {closed.length > 0 && <ClosedProposals proposals={closed} />}
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <ApprovalsTable proposals={pending} canAct={canAct} currentProfileId={currentProfileId} isOrgAdmin={isOrgAdmin} />
      {closed.length > 0 && <ClosedProposals proposals={closed} />}
    </div>
  )
}

function ApprovalsTable({
  proposals,
  canAct,
  currentProfileId,
  isOrgAdmin,
}: {
  proposals: Proposal[]
  canAct: boolean
  currentProfileId: string
  isOrgAdmin: boolean
}) {
  if (proposals.length === 0) {
    return <EmptyState icon={ShieldCheck} title="Nothing is waiting on you." />
  }
  return (
    <div className="rounded-xl border bg-card overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Team</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Proposed by</TableHead>
            <TableHead>Time left</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {proposals.map((proposal) => (
            <ProposalRow
              key={proposal.id}
              proposal={proposal}
              canAct={canAct}
              canWithdraw={isOrgAdmin || proposal.proposed_by === currentProfileId}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function ProposalRow({ proposal, canAct, canWithdraw }: { proposal: Proposal; canAct: boolean; canWithdraw: boolean }) {
  const [isPending, startTransition] = useTransition()
  const [rejectOpen, setRejectOpen] = useState(false)
  const [note, setNote] = useState('')
  const router = useRouter()
  const left = timeLeft(proposal.expires_at)

  function handleConfirm() {
    startTransition(async () => {
      const res = await confirmFundingProposal({ proposalId: proposal.id })
      if (res.error) toast.error(res.error)
      else {
        toast.success('Funding confirmed')
        if (res.warning) toast.warning(res.warning, { duration: 10000 })
        router.refresh()
      }
    })
  }

  function handleReject() {
    startTransition(async () => {
      const res = await rejectFundingProposal({ proposalId: proposal.id, note })
      if (res.error) toast.error(res.error)
      else {
        toast.success('Proposal rejected')
        setRejectOpen(false)
        setNote('')
        router.refresh()
      }
    })
  }

  function handleWithdraw() {
    startTransition(async () => {
      const res = await withdrawFundingProposal({ proposalId: proposal.id })
      if (res.error) toast.error(res.error)
      else {
        toast.success('Proposal withdrawn')
        router.refresh()
      }
    })
  }

  return (
    <TableRow>
      <TableCell>
        <Link href={`/sponsor/submissions/${proposal.submission_id}`} className="hover:underline">
          {teamLabel(proposal)}
        </Link>
        {proposal.feedback && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{proposal.feedback}</p>}
      </TableCell>
      <TableCell className="font-medium">{money(proposal.amount_cents)}</TableCell>
      <TableCell>{proposal.proposer?.full_name ?? proposal.proposer?.email ?? (proposal.origin === 'token' ? 'Emailed link' : '—')}</TableCell>
      <TableCell>
        <span className={left.urgent ? 'text-status-warning font-medium' : 'text-muted-foreground'}>
          <Clock className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />
          {left.label}
        </span>
      </TableCell>
      <TableCell className="text-right space-x-2">
        {canAct && (
          <>
            <Button size="sm" disabled={isPending} onClick={handleConfirm}>
              Confirm
            </Button>
            <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
              <DialogTrigger render={<Button size="sm" variant="outline" disabled={isPending}>Reject</Button>} />
              <DialogContent className="sm:max-w-[420px]">
                <DialogHeader>
                  <DialogTitle>Reject this funding request</DialogTitle>
                  <DialogDescription>Tell the proposer why — this note is sent to them.</DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                  <Label htmlFor="reject-note">Reason</Label>
                  <Textarea id="reject-note" value={note} onChange={(e) => setNote(e.target.value)} className="min-h-[100px]" />
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setRejectOpen(false)} disabled={isPending}>Cancel</Button>
                  <Button variant="destructive" disabled={isPending || !note.trim()} onClick={handleReject}>
                    {isPending ? 'Rejecting…' : 'Reject'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}
        {canWithdraw && (
          <Button size="sm" variant="ghost" disabled={isPending} onClick={handleWithdraw}>
            Withdraw
          </Button>
        )}
      </TableCell>
    </TableRow>
  )
}

function ClosedProposals({ proposals }: { proposals: Proposal[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium">Recently closed</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="rounded-xl border bg-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Team</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Why</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {proposals.map((proposal) => (
                <TableRow key={proposal.id}>
                  <TableCell>
                    <Link href={`/sponsor/submissions/${proposal.submission_id}`} className="hover:underline">
                      {teamLabel(proposal)}
                    </Link>
                  </TableCell>
                  <TableCell>{money(proposal.settled_amount_cents ?? proposal.amount_cents)}</TableCell>
                  <TableCell>
                    <Badge
                      variant={proposal.status === 'confirmed' ? 'default' : proposal.status === 'rejected' ? 'destructive' : 'secondary'}
                    >
                      {proposal.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {proposal.decision_note ?? CLOSED_REASON_LABELS[proposal.closed_reason ?? ''] ?? proposal.closed_reason ?? '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
