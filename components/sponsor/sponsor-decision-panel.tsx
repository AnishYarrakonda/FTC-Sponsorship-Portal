'use client'

import { useState, useTransition } from 'react'
import { recordSponsorDecision } from '@/app/actions/sponsor-decision'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { ActionWarning } from '@/components/ui/action-warning'

interface Props {
  token: string
  totalAskCents: number
  teamName: string
  approvalThresholdCents?: number | null
  companyName?: string
}

type Step = 'choose' | 'partial' | 'confirm_decline' | 'done' | 'pending_approval'

export function SponsorDecisionPanel({ token, totalAskCents, teamName, approvalThresholdCents = null, companyName = 'This company' }: Props) {
  const [step, setStep] = useState<Step>('choose')
  const [partialAmount, setPartialAmount] = useState('')
  // P0-11: this was typed { ok, error } — discarding `warning` AT THE TYPE LEVEL, so
  // recordSponsorDecision's warning could never be read even by accident.
  const [result, setResult] = useState<{ ok: boolean; error?: string; warning?: string; pendingApproval?: boolean } | null>(null)
  const [isPending, startTransition] = useTransition()

  const totalDisplay = `$${(totalAskCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
  // Named because it now drives three things — the message, aria-invalid, and
  // aria-describedby — and `parseFloat(partialAmount) * 100 > totalAskCents` repeated
  // three times invites the three copies to drift apart.
  const exceedsAsk = Math.round(parseFloat(partialAmount) * 100) > totalAskCents

  function submit(decision: 'decline' | 'full' | 'partial', amountCents?: number) {
    startTransition(async () => {
      const res = await recordSponsorDecision(token, decision, amountCents)
      setResult(res)
      if (res.ok && res.pendingApproval) setStep('pending_approval')
      else if (res.ok) setStep('done')
    })
  }

  if (step === 'pending_approval' || result?.pendingApproval) {
    const thresholdDisplay = approvalThresholdCents !== null
      ? `$${(approvalThresholdCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
      : null
    return (
      // role="status": submitting a decision unmounts the button that had focus, so focus
      // falls to <body> and nothing is announced. The live region is the only thing that
      // tells a screen-reader user their decision landed.
      <Card className="border-primary/20 bg-primary/5">
        <CardContent role="status" className="pt-6 text-center space-y-2">
          <p className="font-bold text-lg">Sent for approval.</p>
          <p className="text-sm text-muted-foreground">
            {companyName} requires a second approver for commitments{thresholdDisplay ? ` above ${thresholdDisplay}` : ''}.
            We&apos;ve notified them; you&apos;ll get an email when it&apos;s confirmed. This link stays valid until then.
          </p>
        </CardContent>
      </Card>
    )
  }

  if (step === 'done' || result?.ok) {
    return (
      <Card className="border-green-200 bg-green-50">
        <CardContent role="status" className="pt-6 text-center space-y-2">
          {/* Decorative. Without aria-hidden VoiceOver reads "party popper" as the first
              thing after a funding decision, ahead of the outcome itself. */}
          <p aria-hidden="true" className="text-2xl">🎉</p>
          <p className="font-bold text-green-800 text-lg">Decision Recorded!</p>
          {/*
            Previously this hard-coded "A confirmation email has been sent to both you and
            the team coach" — shown to an external sponsor who had just committed real
            money, even when the send had failed. Only claim it when it is true.
          */}
          {result?.warning ? (
            <div className="pt-1">
              <ActionWarning>{result.warning}</ActionWarning>
            </div>
          ) : (
            <p className="text-green-700 text-sm">
              A confirmation email has been sent to both you and the team coach. They will follow up with payment details.
            </p>
          )}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle className="text-xl">Respond to This Proposal</CardTitle>
        <CardDescription>Your decision will be recorded and both parties notified immediately.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/*
          role="alert" so the failure is spoken when it appears. Without it a screen-reader
          user presses "Accept Full Amount", hears nothing at all, and has no way to know the
          decision was rejected — focus never moves, so nothing announces itself.
          The leading "Error:" carries the meaning that the red styling carries visually
          (WCAG 1.4.1 — not by colour alone).
        */}
        {result?.error && (
          <div role="alert" className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
            <span className="font-semibold">Error:</span> {result.error}
          </div>
        )}

        {step === 'choose' && (
          <div className="grid gap-3">
            <Button
              size="lg"
              className="bg-primary text-primary-foreground"
              disabled={isPending}
              onClick={() => submit('full')}
            >
              Accept Full Amount ({totalDisplay})
            </Button>
            <Button
              size="lg"
              variant="outline"
              disabled={isPending}
              onClick={() => setStep('partial')}
            >
              Offer Partial Amount…
            </Button>
            <Button
              size="lg"
              variant="ghost"
              className="text-slate-500 hover:text-red-600"
              disabled={isPending}
              onClick={() => setStep('confirm_decline')}
            >
              Decline This Proposal
            </Button>
          </div>
        )}

        {step === 'partial' && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Enter the amount you&apos;d like to offer {teamName}. The full request is {totalDisplay}.
            </p>
            {/*
              The input had a placeholder and nothing else. A placeholder is not a label:
              it is not exposed as an accessible name by every AT, and it disappears the
              moment the field has a value — so a screen-reader user landing on a
              half-filled amount field heard only "edit text, 500". This is the field that
              decides how much money a team receives.
            */}
            <label htmlFor="partial-amount" className="block text-sm font-medium">
              Amount to offer (US dollars)
            </label>
            <div className="flex gap-2">
              <span aria-hidden="true" className="flex items-center text-slate-500 pl-3 border rounded-l-md bg-slate-50 text-sm">$</span>
              <Input
                id="partial-amount"
                type="number"
                min="1"
                step="0.01"
                placeholder="e.g. 500.00"
                value={partialAmount}
                onChange={(e) => setPartialAmount(e.target.value)}
                className="rounded-l-none"
                aria-invalid={exceedsAsk || undefined}
                aria-describedby={exceedsAsk ? 'partial-amount-error' : undefined}
              />
            </div>
            {/*
              aria-describedby ties this to the field, and role="alert" announces it on
              appearance. Previously the only signal that the offer was too large was amber
              text floating near the input, which failed both 3.3.1 (error identification)
              and 1.4.1 — and the Confirm button silently disabled itself with no stated reason.
            */}
            {exceedsAsk && (
              <p id="partial-amount-error" role="alert" className="text-xs text-status-warning">
                A partial offer can&apos;t exceed the full request of {totalDisplay}.
              </p>
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep('choose')} disabled={isPending}>Back</Button>
              <Button
                className="bg-primary text-primary-foreground"
                disabled={isPending || !partialAmount || parseFloat(partialAmount) <= 0 || exceedsAsk}
                onClick={() => submit('partial', Math.round(parseFloat(partialAmount) * 100))}
              >
                Confirm Partial Offer
              </Button>
            </div>
          </div>
        )}

        {step === 'confirm_decline' && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Are you sure you want to decline this proposal from {teamName}? This action cannot be undone.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep('choose')} disabled={isPending}>Go Back</Button>
              <Button
                variant="destructive"
                disabled={isPending}
                onClick={() => submit('decline')}
              >
                {isPending ? 'Processing…' : 'Confirm Decline'}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
