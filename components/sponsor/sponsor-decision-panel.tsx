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
}

type Step = 'choose' | 'partial' | 'confirm_decline' | 'done'

export function SponsorDecisionPanel({ token, totalAskCents, teamName }: Props) {
  const [step, setStep] = useState<Step>('choose')
  const [partialAmount, setPartialAmount] = useState('')
  // P0-11: this was typed { ok, error } — discarding `warning` AT THE TYPE LEVEL, so
  // recordSponsorDecision's warning could never be read even by accident.
  const [result, setResult] = useState<{ ok: boolean; error?: string; warning?: string } | null>(null)
  const [isPending, startTransition] = useTransition()

  const totalDisplay = `$${(totalAskCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`

  function submit(decision: 'decline' | 'full' | 'partial', amountCents?: number) {
    startTransition(async () => {
      const res = await recordSponsorDecision(token, decision, amountCents)
      setResult(res)
      if (res.ok) setStep('done')
    })
  }

  if (step === 'done' || result?.ok) {
    return (
      <Card className="border-green-200 bg-green-50">
        <CardContent className="pt-6 text-center space-y-2">
          <p className="text-2xl">🎉</p>
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
        {result?.error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
            {result.error}
          </div>
        )}

        {step === 'choose' && (
          <div className="grid gap-3">
            <Button
              size="lg"
              className="bg-green-600 hover:bg-green-700 text-white"
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
            <div className="flex gap-2">
              <span className="flex items-center text-slate-500 pl-3 border rounded-l-md bg-slate-50 text-sm">$</span>
              <Input
                type="number"
                min="1"
                step="0.01"
                placeholder="e.g. 500.00"
                value={partialAmount}
                onChange={(e) => setPartialAmount(e.target.value)}
                className="rounded-l-none"
              />
            </div>
            {parseFloat(partialAmount) * 100 > totalAskCents && (
              <p className="text-xs text-status-warning">
                A partial offer can&apos;t exceed the full request of {totalDisplay}.
              </p>
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep('choose')} disabled={isPending}>Back</Button>
              <Button
                className="bg-green-600 hover:bg-green-700 text-white"
                disabled={
                  isPending ||
                  !partialAmount ||
                  parseFloat(partialAmount) <= 0 ||
                  Math.round(parseFloat(partialAmount) * 100) > totalAskCents
                }
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
