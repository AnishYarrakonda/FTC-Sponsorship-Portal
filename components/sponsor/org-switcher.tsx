'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Building2, Check, ChevronsUpDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { switchActiveSponsorOrg } from '@/app/actions/sponsor-org-switch'
import { cn } from '@/lib/utils'

/**
 * A-12-01. Switch which sponsor organisation the portal is showing.
 *
 * Renders NOTHING when the person belongs to a single org, which is the overwhelmingly
 * common case — a control that never has a second option is noise, and worse, it implies
 * there is something to choose.
 */
export function SponsorOrgSwitcher({
  orgs,
  activeId,
}: {
  orgs: { id: string; company_name: string }[]
  activeId: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  if (orgs.length < 2) return null

  const active = orgs.find((o) => o.id === activeId) ?? orgs[0]

  function handleSwitch(sponsorId: string) {
    if (sponsorId === activeId) return
    startTransition(async () => {
      const result = await switchActiveSponsorOrg({ sponsorId })
      if (result.error) {
        toast.error(result.error)
        return
      }
      // Every sponsor page is now about a different company; a refresh is not optional.
      router.refresh()
    })
  }

  return (
    <div className="px-2 pb-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={isPending}
          className={cn(
            'flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left text-sm',
            'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            'disabled:opacity-60'
          )}
          aria-label={`Active organization: ${active.company_name}. Switch organization.`}
        >
          <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate font-medium">{active.company_name}</span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[--radix-dropdown-menu-trigger-width] min-w-56">
          {orgs.map((org) => (
            <DropdownMenuItem
              key={org.id}
              onClick={() => handleSwitch(org.id)}
              className="flex items-center gap-2"
            >
              <Check
                className={cn('h-4 w-4 shrink-0', org.id === activeId ? 'opacity-100' : 'opacity-0')}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate">{org.company_name}</span>
              {org.id === activeId && <span className="sr-only">(current)</span>}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
