'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { ShieldBan, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  adminDeleteEmailDomainRule,
  adminSetEmailDomainRule,
} from '@/app/actions/admin'

export interface EmailDomainRuleRow {
  domain: string
  rule: string
  category: string
  reason: string | null
  updated_at: string
}

const RULES = [
  { value: 'block' as const, label: 'Block' },
  { value: 'allow' as const, label: 'Allow' },
]

export function EmailDomainRules({ rows }: { rows: EmailDomainRuleRow[] }) {
  const [domain, setDomain] = useState('')
  const [rule, setRule] = useState<'block' | 'allow'>('block')
  const [reason, setReason] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const blocked = rows.filter((r) => r.rule === 'block')
  const allowed = rows.filter((r) => r.rule === 'allow')

  const save = () =>
    startTransition(async () => {
      setFormError(null)
      const res = await adminSetEmailDomainRule({ domain, rule, reason: reason.trim() || undefined })
      if (res?.error) {
        setFormError(res.error)
        return
      }
      toast.success(`${domain.trim().toLowerCase()} is now on the ${rule} list.`)
      setDomain('')
      setReason('')
    })

  const remove = (target: string) =>
    startTransition(async () => {
      setFormError(null)
      const res = await adminDeleteEmailDomainRule(target)
      if (res?.error) {
        setFormError(res.error)
        return
      }
      toast.success(`${target} removed. Applicants on that domain are no longer affected.`)
    })

  const list = (title: string, description: string, items: EmailDomainRuleRow[]) => (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          {title}{' '}
          <span className="text-muted-foreground font-normal">({items.length})</span>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <EmptyState
            icon={ShieldBan}
            title="Nothing on this list"
            description="Add a domain with the form above. Domains with no rule are treated as corporate and allowed through."
          />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {items.map((r) => (
              <li key={r.domain} className="flex items-center justify-between gap-4 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{r.domain}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {r.category}
                    {r.reason ? ` · ${r.reason}` : ''}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => remove(r.domain)}
                  aria-label={`Remove ${r.domain}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Add or update a domain</CardTitle>
          <CardDescription>
            Allow always beats block. Allowlisting a domain is the escape hatch for a small
            business or family foundation with no company email of its own.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {formError && (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
          <div className="grid gap-4 sm:grid-cols-[1fr_auto_1fr_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="edr-domain">Domain</Label>
              <Input
                id="edr-domain"
                placeholder="acme.com"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edr-rule">Rule</Label>
              <div id="edr-rule" className="flex gap-1">
                {RULES.map((r) => (
                  <Button
                    key={r.value}
                    type="button"
                    variant={rule === r.value ? 'default' : 'outline'}
                    size="sm"
                    aria-pressed={rule === r.value}
                    onClick={() => setRule(r.value)}
                  >
                    {r.label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edr-reason">Reason (optional)</Label>
              <Input
                id="edr-reason"
                placeholder="Family foundation, no company domain"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            <Button onClick={save} disabled={pending || !domain.trim()}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {list(
        'Blocked',
        'Sponsor applications from these domains are refused with a support-email fallback. Coach signup is never affected.',
        blocked,
      )}
      {list('Allowed', 'Explicit overrides. These beat any block rule for the same domain.', allowed)}
    </div>
  )
}
