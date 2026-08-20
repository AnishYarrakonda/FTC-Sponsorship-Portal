'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { setAdminLevel, demoteAdmin, provisionAdmin } from '@/app/actions/admin'
import { ADMIN_LEVELS, ADMIN_LEVEL_DESCRIPTIONS, ADMIN_LEVEL_LABELS, type AdminLevel } from '@/lib/schemas/admin'
import { describeActionError } from '@/lib/client-errors'

export function AdminLevelControls({
  profileId,
  level,
  isSelf,
}: {
  profileId: string
  level: AdminLevel | null
  isSelf: boolean
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // The signed-in user's own row renders as static text with a reason, not a disabled
  // select that just looks broken. The database floor is the real guarantee; this is
  // only the explanation.
  if (isSelf) {
    return (
      <div className="text-right">
        <Badge variant="outline">{level ? ADMIN_LEVEL_LABELS[level] : 'No level'}</Badge>
        <p className="mt-1 text-xs text-muted-foreground">You cannot change your own level</p>
      </div>
    )
  }

  function run(fn: () => Promise<{ error?: string; warning?: string; success?: boolean }>) {
    setError(null)
    setNotice(null)
    startTransition(async () => {
      try {
        const result = await fn()
        if (result?.error) {
          setError(result.error)
          return
        }
        if (result?.warning) setNotice(result.warning)
        router.refresh()
      } catch (e) {
        setError(describeActionError(e, 'adminLevelControls'))
      }
    })
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={isPending} className="font-normal">
            {level ? ADMIN_LEVEL_LABELS[level] : 'No level'}
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-w-xs">
          {ADMIN_LEVELS.map((option) => (
            <DropdownMenuItem
              key={option}
              disabled={option === level}
              onClick={() => run(() => setAdminLevel({ profileId, level: option }))}
              className="flex-col items-start gap-0.5"
            >
              <span className="font-medium">{ADMIN_LEVEL_LABELS[option]}</span>
              <span className="text-xs text-muted-foreground">{ADMIN_LEVEL_DESCRIPTIONS[option]}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem
            onClick={() => run(() => demoteAdmin({ profileId, newRole: 'coach' }))}
            className="flex-col items-start gap-0.5"
          >
            <span className="font-medium">Remove admin access</span>
            <span className="text-xs text-muted-foreground">Returns the account to a coach account.</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {error && (
        <Alert variant="destructive" className="text-left">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {notice && (
        <Alert className="text-left">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}

/**
 * Promotes an EXISTING account to admin by email. There is no "create a user" path here
 * on purpose — Clerk owns identity, so the person must sign up first and then be
 * promoted. The action refuses linked sponsors and team-owning coaches, because
 * promoting either strands data they still own.
 */
export function ProvisionAdminForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [level, setLevel] = useState<AdminLevel>('reviewer')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    startTransition(async () => {
      try {
        const result = await provisionAdmin({ email, level })
        if (result?.error) {
          setError(result.error)
          return
        }
        setEmail('')
        setNotice(result?.warning ?? `${email} now has ${ADMIN_LEVEL_LABELS[level].toLowerCase()} access.`)
        router.refresh()
      } catch (err) {
        setError(describeActionError(err, 'provisionAdmin'))
      }
    })
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        <Input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="person@example.com"
          aria-label="Email address of the account to promote"
          className="sm:flex-1"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" className="justify-between font-normal sm:w-52">
              {ADMIN_LEVEL_LABELS[level]}
              <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-w-xs">
            {ADMIN_LEVELS.map((option) => (
              <DropdownMenuItem key={option} onClick={() => setLevel(option)} className="flex-col items-start gap-0.5">
                <span className="font-medium">{ADMIN_LEVEL_LABELS[option]}</span>
                <span className="text-xs text-muted-foreground">{ADMIN_LEVEL_DESCRIPTIONS[option]}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button type="submit" disabled={isPending || !email.trim()}>
          {isPending ? 'Adding…' : 'Add admin'}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {notice && (
        <Alert>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
    </form>
  )
}
