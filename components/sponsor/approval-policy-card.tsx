'use client'

import { useState, useTransition } from 'react'
import { formatMoneyAmount } from '@/lib/format-money'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { updateOrgApprovalSettings } from '@/app/actions/sponsor-approvals'

export function ApprovalPolicyCard({
  approvalRequiredAboveCents,
  eligibleApproverCount,
}: {
  approvalRequiredAboveCents: number | null
  eligibleApproverCount: number
}) {
  const [enabled, setEnabled] = useState(approvalRequiredAboveCents !== null)
  const [amount, setAmount] = useState(
    approvalRequiredAboveCents !== null ? (approvalRequiredAboveCents / 100).toString() : '1000'
  )
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const canEnable = eligibleApproverCount >= 2
  const parsedCents = Math.round(parseFloat(amount || '0') * 100)

  function handleSave() {
    startTransition(async () => {
      const res = await updateOrgApprovalSettings({
        approvalRequiredAboveCents: enabled ? (Number.isFinite(parsedCents) ? Math.max(0, parsedCents) : 0) : null,
      })
      if (res.error) toast.error(res.error)
      else {
        toast.success('Approval policy saved')
        router.refresh()
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Approval policy</CardTitle>
        <CardDescription>
          Require a second person to confirm large funding commitments before the money commits.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!canEnable && !enabled && (
          <Alert>
            <AlertDescription>
              Add a second teammate with the Approver role before turning this on — otherwise nobody could confirm a
              request.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex items-start gap-3">
          <Checkbox
            id="approvals-enabled"
            checked={enabled}
            onCheckedChange={(v) => setEnabled(v)}
            disabled={isPending || (!canEnable && !enabled)}
            className="mt-0.5"
          />
          <div>
            <Label htmlFor="approvals-enabled" className="text-sm font-medium cursor-pointer">
              Two-step approval
            </Label>
            <p className="text-xs text-muted-foreground">
              {enabled
                ? `Commitments above $${formatMoneyAmount(parsedCents)} need a second person to confirm. $${formatMoneyAmount(parsedCents)} and below go through immediately.`
                : 'Every funding decision commits immediately, as it does today.'}
            </p>
          </div>
        </div>

        {enabled && (
          <div className="space-y-2 max-w-xs">
            <Label htmlFor="approval-threshold">Threshold</Label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">$</span>
              <Input
                id="approval-threshold"
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={isPending}
              />
            </div>
          </div>
        )}

        <div className="pt-2">
          <Button onClick={handleSave} disabled={isPending || (enabled && !canEnable)}>
            {isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
