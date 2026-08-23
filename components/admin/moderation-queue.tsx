'use client'

import { useState, useTransition, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button, buttonVariants } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ModerationActions } from '@/components/admin/moderation-actions'
import { approveSubmission, declineSubmission, requestEdit } from '@/app/actions/moderation'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { CheckCircle2, AlertCircle, CheckSquare, Square, ChevronDown, ChevronUp, Users } from 'lucide-react'
import Link from 'next/link'
import { ActionWarning } from '@/components/ui/action-warning'
import { EmptyState } from '@/components/ui/empty-state'
import { cn, htmlToPlainText } from '@/lib/utils'

interface Submission {
  id: string
  updated_at: string
  requested_amount_cents: number | null
  custom_pitch_alignment: string | null
  specific_needs_statement: string | null
  local_connection_notes: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  teams: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sponsors: any
}

interface BulkResult {
  id: string
  ok: boolean
  error?: string
  /**
   * P0-11: the action committed, but a decision-critical side effect failed — almost
   * always the pitch email to the sponsor, whose capacity is ALREADY reserved by the
   * approval RPC. Previously computed by moderation.ts and read by nothing, so the row
   * silently left the queue and the admin was told it had been dispatched.
   */
  warning?: string
}

function FieldBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-1.5 text-xs font-mono uppercase tracking-widest text-muted-foreground">{label}</h4>
      {children}
    </div>
  )
}

function PreviewPane({ submission }: { submission: Submission }) {
  const team = submission.teams
  const sponsor = submission.sponsors
  const financialAsk = submission.requested_amount_cents || team?.financial_ask_cents || 0
  const budgetItems: { qty: number; label: string; total_cents: number }[] = team?.budget_items ?? []
  const lineItemSum = budgetItems.reduce((s, i) => s + (i.total_cents ?? 0), 0)
  const currentTeamAsk = team?.financial_ask_cents || 0
  const isOverAsk = currentTeamAsk > lineItemSum && lineItemSum > 0

  return (
    <div className="space-y-4 text-sm">
      {/* Identity row */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Sponsor: <span className="text-foreground">{sponsor?.company_name}</span>
        </span>
        <span className="text-muted-foreground/40">·</span>
        <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Ask:{' '}
          <span className={cn('text-foreground', isOverAsk && 'text-status-warning')}>
            ${(financialAsk / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </span>
        </span>
        {isOverAsk && (
          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-status-warning dark:text-amber-400">
            ⚠ Exceeds line items (${(lineItemSum / 100).toFixed(2)})
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 border-b border-border pb-4">
        <FieldBlock label="Custom Pitch Alignment">
          <p className="whitespace-pre-wrap rounded-md bg-muted/50 px-3 py-2.5 text-muted-foreground leading-relaxed">
            {htmlToPlainText(submission.custom_pitch_alignment) || '—'}
          </p>
        </FieldBlock>
        <FieldBlock label="Specific Needs Statement">
          <p className="whitespace-pre-wrap rounded-md bg-muted/50 px-3 py-2.5 text-muted-foreground leading-relaxed">
            {htmlToPlainText(submission.specific_needs_statement) || '—'}
          </p>
        </FieldBlock>
        {/* B-03-09. The coach fills this in and, until now, no human ever saw it — least
            of all the admin gatekeeping sponsor-facing outreach, who has to be able to
            read every coach-authored word that reaches a sponsor. Spans both columns
            because it is prose, not a paired field. */}
        <FieldBlock label="Local Connection">
          <p className="whitespace-pre-wrap rounded-md bg-muted/50 px-3 py-2.5 text-muted-foreground leading-relaxed">
            {htmlToPlainText(submission.local_connection_notes) || '—'}
          </p>
        </FieldBlock>
      </div>

      <div className="space-y-3">
        <p className="text-xs font-medium text-foreground">Master Portfolio Data</p>
        {/* B-03-02. These three are richTextField columns holding TipTap HTML, and they
            were interpolated as JSX text children — so a moderator read `<p>…</p>` while
            deciding whether to dispatch the pitch. Flattened rather than rendered,
            matching the two pitch fields directly above: a moderator wants the substance
            in one consistent shape, not the coach's formatting. */}
        <FieldBlock label="Mission Statement">
          <p className="whitespace-pre-wrap text-muted-foreground leading-relaxed">{htmlToPlainText(team?.mission_statement) || '—'}</p>
        </FieldBlock>
        <FieldBlock label="Technical Summary">
          <p className="whitespace-pre-wrap text-muted-foreground leading-relaxed">{htmlToPlainText(team?.technical_summary) || '—'}</p>
        </FieldBlock>
        <FieldBlock label="Outreach Summary">
          <p className="whitespace-pre-wrap text-muted-foreground leading-relaxed">{htmlToPlainText(team?.outreach_summary) || '—'}</p>
        </FieldBlock>
        {budgetItems.length > 0 && (
          <FieldBlock label="Budget Items">
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
              {budgetItems.map((item, idx) => (
                <div key={idx} className={cn('flex justify-between py-1', idx < budgetItems.length - 1 && 'border-b border-border')}>
                  <span className="text-muted-foreground">{item.qty}× {item.label}</span>
                  <span className="font-mono text-xs font-medium text-foreground">${(item.total_cents / 100).toFixed(2)}</span>
                </div>
              ))}
            </div>
          </FieldBlock>
        )}
      </div>
    </div>
  )
}

function SubmissionCard({
  submission,
  selected,
  onToggle,
  onApproveClick,
}: {
  submission: Submission
  selected: boolean
  onToggle: () => void
  onApproveClick: () => void
}) {
  const [expanded, setExpanded] = useState(true)
  const team = submission.teams
  const sponsor = submission.sponsors
  const financialAsk = submission.requested_amount_cents || team?.financial_ask_cents || 0

  return (
    <Card className={cn('transition-colors', selected && 'ring-2 ring-primary')}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          {/* Checkbox + title */}
          <button
            type="button"
            onClick={onToggle}
            className="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            aria-label={selected ? 'Deselect submission' : 'Select submission'}
          >
            {selected
              ? <CheckSquare className="h-4 w-4 text-primary" strokeWidth={1.5} />
              : <Square className="h-4 w-4" strokeWidth={1.5} />}
          </button>

          <div className="flex-1 min-w-0">
            <CardTitle className="text-base">
              Submission to {sponsor?.company_name}
            </CardTitle>
            <p className="mt-0.5 text-sm font-medium text-foreground">
              From: {team?.team_name}{' '}
              {team?.status === 'existing' && team?.ftc_team_number ? (
                <span className="ml-1 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                  #{team.ftc_team_number}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">(Incubator)</span>
              )}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-border px-2 py-0.5 font-mono text-xs text-muted-foreground">
                Ask: ${(financialAsk / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </span>
              <span className="text-xs text-muted-foreground" suppressHydrationWarning>
                {new Date(submission.updated_at).toLocaleDateString()}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
            aria-label={expanded ? 'Collapse submission details' : 'Expand submission details'}
          >
            {expanded
              ? <ChevronUp className="h-4 w-4" strokeWidth={1.5} />
              : <ChevronDown className="h-4 w-4" strokeWidth={1.5} />}
          </button>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0">
          <PreviewPane submission={submission} />
        </CardContent>
      )}

      <ModerationActions submissionId={submission.id} onApproveClick={onApproveClick} />
    </Card>
  )
}

interface BulkFeedbackDialogProps {
  open: boolean
  onClose: () => void
  count: number
  action: 'decline' | 'request_edit'
  onConfirm: (feedback: string) => void
  isPending: boolean
}

function BulkFeedbackDialog({ open, onClose, count, action, onConfirm, isPending }: BulkFeedbackDialogProps) {
  const [feedback, setFeedback] = useState('')
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { setFeedback(''); onClose() } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {action === 'decline' ? `Decline ${count} submission${count > 1 ? 's' : ''}` : `Request edits on ${count} submission${count > 1 ? 's' : ''}`}
          </DialogTitle>
          <DialogDescription>
            This feedback will be sent to {count === 1 ? 'the coach' : 'each coach'} with their submission.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={feedback}
          onChange={e => setFeedback(e.target.value)}
          placeholder={action === 'decline' ? 'Does not meet sponsorship criteria at this time.' : 'Please clarify the budget line items and provide more detail.'}
          className="min-h-[100px]"
          maxLength={2000}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => { setFeedback(''); onClose() }} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant={action === 'decline' ? 'destructive' : 'default'}
            disabled={!feedback.trim() || isPending}
            loading={isPending}
            onClick={() => onConfirm(feedback)}
          >
            {action === 'decline' ? 'Decline all' : 'Send request'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface ApprovePreviewDrawerProps {
  open: boolean
  onClose: () => void
  submission: Submission | null
  onConfirm: (submissionId: string) => void
  isPending: boolean
}

function ApprovePreviewDrawer({ open, onClose, submission, onConfirm, isPending }: ApprovePreviewDrawerProps) {
  if (!submission) return null
  const team = submission.teams
  const sponsor = submission.sponsors
  const financialAsk = submission.requested_amount_cents || team?.financial_ask_cents || 0
  const budgetItems: { qty: number; label: string; total_cents: number }[] = team?.budget_items ?? []
  const lineItemSum = budgetItems.reduce((s, i) => s + (i.total_cents ?? 0), 0)
  const currentTeamAsk = team?.financial_ask_cents || 0

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Approve & Dispatch Preview</DialogTitle>
          <DialogDescription>
            Review what will happen before confirming. This action is irreversible.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          {/* What the sponsor receives */}
          <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
            <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Sponsor email</p>
            <p className="text-sm font-medium text-foreground">To: {sponsor?.company_name}</p>
            <p className="text-xs text-muted-foreground">
              Subject: Verified FTC Robotics Sponsorship Proposal:{' '}
              <span className="text-foreground">{team?.ftc_team_number ? `Team #${team.ftc_team_number}` : 'Incubator'} · {team?.state}</span>
            </p>
            <div className="rounded-md bg-background border border-border px-3 py-2 space-y-1 text-sm">
              <p><span className="text-muted-foreground">Team:</span> {team?.team_name}</p>
              <p><span className="text-muted-foreground">Total ask:</span>{' '}
                <span className="font-mono font-medium">${(financialAsk / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
              </p>
              <p className="text-xs italic text-muted-foreground">+ Secure viewer link (14-day expiry)</p>
            </div>
          </div>

          {/* Budget impact */}
          <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-1">
            <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Sponsor funding impact</p>
            <p className="text-sm text-muted-foreground">
              Deducted:{' '}
              <span className="font-mono font-medium text-foreground">
                ${(financialAsk / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </span>
              {lineItemSum > 0 && currentTeamAsk !== lineItemSum && (
                <span className="ml-1 text-status-warning text-xs">
                  (line items: ${(lineItemSum / 100).toFixed(2)})
                </span>
              )}
            </p>
          </div>

          {/* Coach notification */}
          <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
            <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Coach notification</p>
            <p className="rounded-md bg-background border border-border px-3 py-2 text-sm text-muted-foreground">
              Your submission to{' '}
              <span className="font-medium text-foreground">{sponsor?.company_name}</span>{' '}
              has been approved and dispatched. You will be notified when the sponsor responds.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button onClick={() => onConfirm(submission.id)} loading={isPending} disabled={isPending}>
            Confirm — Approve & Dispatch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ModerationQueue({ initialSubmissions }: { initialSubmissions: Submission[] }) {
  const [submissions, setSubmissions] = useState(initialSubmissions)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkAction, setBulkAction] = useState<'decline' | 'request_edit' | null>(null)
  const [bulkResults, setBulkResults] = useState<BulkResult[] | null>(null)
  const [approvePreview, setApprovePreview] = useState<Submission | null>(null)
  const [isPending, startTransition] = useTransition()

  const toggleSelect = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    setSelected(prev =>
      prev.size === submissions.length ? new Set() : new Set(submissions.map(s => s.id))
    )
  }, [submissions])

  function removeSubmissions(ids: string[]) {
    setSubmissions(prev => prev.filter(s => !ids.includes(s.id)))
    setSelected(prev => {
      const next = new Set(prev)
      ids.forEach(id => next.delete(id))
      return next
    })
  }

  function handleBulkApprove() {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    setBulkResults(null)
    startTransition(async () => {
      const results: BulkResult[] = []
      for (const id of ids) {
        const res = await approveSubmission(id)
        results.push({ id, ok: !res?.error, error: res?.error, warning: res?.warning })
      }
      setBulkResults(results)
      const succeeded = results.filter(r => r.ok).map(r => r.id)
      removeSubmissions(succeeded)
    })
  }

  function handleBulkFeedback(feedback: string) {
    const ids = Array.from(selected)
    if (ids.length === 0 || !bulkAction) return
    setBulkResults(null)
    startTransition(async () => {
      const results: BulkResult[] = []
      for (const id of ids) {
        const res = bulkAction === 'decline'
          ? await declineSubmission(id, feedback)
          : await requestEdit(id, feedback)
        results.push({ id, ok: !res?.error, error: res?.error, warning: res?.warning })
      }
      setBulkResults(results)
      const succeeded = results.filter(r => r.ok).map(r => r.id)
      removeSubmissions(succeeded)
      setBulkAction(null)
    })
  }

  function handleSingleApproveConfirm(submissionId: string) {
    startTransition(async () => {
      const res = await approveSubmission(submissionId)
      if (!res?.error) {
        removeSubmissions([submissionId])
        // Keep the row's warning on screen after it leaves the queue — it is the only
        // signal that the sponsor never actually received the pitch.
        setBulkResults(res?.warning ? [{ id: submissionId, ok: true, warning: res.warning }] : null)
      } else {
        // Surface the failure through the same results banner the bulk path uses —
        // closing the dialog with no feedback left admins thinking approval worked.
        setBulkResults([{ id: submissionId, ok: false, error: res.error }])
      }
      setApprovePreview(null)
    })
  }

  const allSelected = selected.size > 0 && selected.size === submissions.length
  const someSelected = selected.size > 0

  if (submissions.length === 0) {
    return (
      <EmptyState
        className="py-16"
        icon={CheckCircle2}
        title="Queue is empty"
        description="All submitted portfolios have been reviewed. New submissions will appear here automatically."
        action={
          <Link href="/coaches" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
            <Users className="h-4 w-4" aria-hidden="true" /> Review coach verifications
          </Link>
        }
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Bulk action bar */}
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-2.5">
        <button
          type="button"
          onClick={toggleAll}
          className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {allSelected
            ? <CheckSquare className="h-4 w-4 text-primary" strokeWidth={1.5} />
            : <Square className="h-4 w-4" strokeWidth={1.5} />}
          <span>{allSelected ? 'Deselect all' : 'Select all'}</span>
        </button>

        <span className="text-muted-foreground/40">·</span>
        <span className="text-sm text-muted-foreground">{submissions.length} pending</span>

        {someSelected && (
          <>
            <span className="ml-auto text-xs text-muted-foreground">{selected.size} selected</span>
            <Button
              size="sm"
              onClick={handleBulkApprove}
              disabled={isPending}
              loading={isPending}
            >
              Approve {selected.size}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => setBulkAction('request_edit')}
            >
              Request edits
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={isPending}
              onClick={() => setBulkAction('decline')}
            >
              Decline {selected.size}
            </Button>
          </>
        )}
      </div>

      {/* Bulk results summary */}
      {bulkResults && (
        <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm space-y-1">
          {bulkResults.filter(r => r.ok).length > 0 && (
            <div className="flex items-center gap-2 text-status-success dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" strokeWidth={1.5} />
              {bulkResults.filter(r => r.ok).length} succeeded
            </div>
          )}
          {bulkResults.filter(r => !r.ok).map(r => (
            <div key={r.id} className="flex items-center gap-2 text-destructive-text">
              <AlertCircle className="h-4 w-4" strokeWidth={1.5} />
              {r.id.slice(0, 8)}…: {r.error}
            </div>
          ))}
          {bulkResults.filter(r => r.ok && r.warning).map(r => (
            <ActionWarning key={`warn-${r.id}`}>
              {r.id.slice(0, 8)}…: {r.warning}
            </ActionWarning>
          ))}
        </div>
      )}

      {/* Submission cards */}
      <div className="flex flex-col gap-5">
        {submissions.map(s => (
          <SubmissionCard
            key={s.id}
            submission={s}
            selected={selected.has(s.id)}
            onToggle={() => toggleSelect(s.id)}
            onApproveClick={() => setApprovePreview(s)}
          />
        ))}
      </div>

      {/* Bulk feedback dialog */}
      <BulkFeedbackDialog
        open={bulkAction !== null}
        onClose={() => setBulkAction(null)}
        count={selected.size}
        action={bulkAction ?? 'decline'}
        onConfirm={handleBulkFeedback}
        isPending={isPending}
      />

      {/* Single-approve preview drawer */}
      <ApprovePreviewDrawer
        open={approvePreview !== null}
        onClose={() => setApprovePreview(null)}
        submission={approvePreview}
        onConfirm={handleSingleApproveConfirm}
        isPending={isPending}
      />
    </div>
  )
}
