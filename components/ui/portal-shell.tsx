'use client'

import * as React from 'react'
import Link from 'next/link'
import { LogOut, Menu } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

/**
 * Shared building blocks for the coach / sponsor / admin portal sidebars,
 * plus the responsive wrapper that turns the fixed desktop sidebar into a
 * top bar + slide-out Sheet on <lg screens.
 */

export function PortalBrandMark({ className }: { className?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true" className={cn('shrink-0 text-foreground', className)}>
      <path d="M9 1L16.5 5.5V12.5L9 17L1.5 12.5V5.5L9 1Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9 4L14 7V11.5L9 14.5L4 11.5V7L9 4Z" stroke="currentColor" strokeWidth="1" opacity="0.5" />
    </svg>
  )
}

export function PortalBrand() {
  return (
    <Link
      href="/"
      className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-4 transition-colors hover:bg-accent/60"
    >
      <PortalBrandMark />
      <span className="text-sm font-semibold tracking-tight text-foreground">FTC Pitfund</span>
    </Link>
  )
}

export function PortalLabel({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: LucideIcon
  title: string
  subtitle: string
}) {
  return (
    <div className="shrink-0 border-b border-border px-4 py-3">
      <div className="flex items-center gap-2">
        <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
        <span className="truncate text-sm font-medium text-foreground">{title}</span>
      </div>
      <div className="mt-0.5 font-mono text-xs uppercase tracking-widest text-muted-foreground">
        {subtitle}
      </div>
    </div>
  )
}

export function PortalNavLink({
  href,
  icon: Icon,
  label,
  active,
  badgeCount = 0,
  badgeLabel,
}: {
  href: string
  icon: LucideIcon
  label: string
  active: boolean
  badgeCount?: number
  /** Accessible description of the badge, e.g. "unread notifications" */
  badgeLabel?: string
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground',
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          'h-4 w-4 shrink-0 transition-colors',
          active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground',
        )}
        strokeWidth={1.5}
      />
      <span className="flex-1">{label}</span>
      <span aria-live="polite" aria-atomic="true">
        {badgeCount > 0 && (
          <span
            aria-label={`${badgeCount}${badgeLabel ? ` ${badgeLabel}` : ''}`}
            className="rounded-full bg-primary px-1.5 py-0.5 font-mono text-xs font-semibold leading-none text-primary-foreground"
          >
            <span aria-hidden="true">{badgeCount > 9 ? '9+' : badgeCount}</span>
          </span>
        )}
      </span>
    </Link>
  )
}

export function PortalSignOut({ onSignOut }: { onSignOut: () => void }) {
  return (
    <button
      onClick={onSignOut}
      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
    >
      <LogOut aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={1.5} />
      Sign out
    </button>
  )
}

function getInitials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

export function PortalUserChip({ name, email }: { name: string; email: string }) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2">
      <div
        aria-hidden="true"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-foreground ring-1 ring-border"
      >
        {getInitials(name)}
      </div>
      <div className="min-w-0">
        <div className="truncate text-xs font-medium text-foreground">{name}</div>
        <div className="truncate text-xs text-muted-foreground">{email}</div>
      </div>
    </div>
  )
}

/**
 * Responsive shell: on lg+ renders the classic sticky sidebar unchanged; on
 * smaller screens renders a sticky top bar with a hamburger that opens the
 * same navigation in a left-side Sheet.
 *
 * `routeKey` should change on navigation (pathname + relevant search params)
 * so the sheet closes after a link is tapped.
 */
export function PortalSidebar({
  mobileTitle,
  routeKey,
  children,
}: {
  mobileTitle: string
  routeKey: string
  children: React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)

  // Close the sheet when navigation happens (React "adjust state during
  // render" pattern — avoids a cascading-effect re-render).
  const [prevRouteKey, setPrevRouteKey] = React.useState(routeKey)
  if (prevRouteKey !== routeKey) {
    setPrevRouteKey(routeKey)
    if (open) setOpen(false)
  }

  return (
    <>
      {/* Desktop sidebar — unchanged from the original fixed pattern */}
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-border bg-card lg:flex">
        {children}
      </aside>

      {/* Mobile top bar + sheet */}
      <div className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-4 lg:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            aria-label="Open navigation menu"
            className="-ml-1 flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
          >
            <Menu aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
          </SheetTrigger>
          <SheetContent side="left" className="w-72 gap-0 p-0">
            <SheetTitle className="sr-only">{mobileTitle} navigation</SheetTitle>
            <SheetDescription className="sr-only">Portal navigation links</SheetDescription>
            <div className="flex h-full flex-col overflow-y-auto">{children}</div>
          </SheetContent>
        </Sheet>
        <div className="flex min-w-0 items-center gap-2">
          <PortalBrandMark />
          <span className="truncate text-sm font-semibold tracking-tight text-foreground">{mobileTitle}</span>
        </div>
      </div>
    </>
  )
}
