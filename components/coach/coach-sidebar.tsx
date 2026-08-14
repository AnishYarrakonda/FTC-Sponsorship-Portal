'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { useClerk } from '@clerk/nextjs'
import useSWR from 'swr'
import {
  LayoutDashboard,
  BookOpen,
  FileText,
  Building2,
  Bell,
  Settings,
  GraduationCap,
  Award,
} from 'lucide-react'
import {
  PortalBrand,
  PortalLabel,
  PortalNavLink,
  PortalSidebar,
  PortalSignOut,
  PortalUserChip,
} from '@/components/ui/portal-shell'

const COACH_PREVIEW =
  process.env.NODE_ENV !== 'production' &&
  process.env.NEXT_PUBLIC_COACH_PREVIEW === '1'

const NAV_ITEMS = [
  { label: 'Dashboard', href: '/dashboard',                icon: LayoutDashboard, tabs: ['', 'overview', 'insights'],         badge: false },
  { label: 'Portfolio', href: '/dashboard?tab=portfolio',  icon: BookOpen,        tabs: ['portfolio', 'ledger'],              badge: false },
  { label: 'Pitches',   href: '/dashboard?tab=pitches',    icon: FileText,        tabs: ['pitches', 'submissions', 'drafts'], badge: false },
  { label: 'Sponsors',  href: '/dashboard?tab=sponsors',   icon: Building2,       tabs: ['sponsors', 'find-sponsors'],        badge: false },
  { label: 'Recognition', href: '/dashboard?tab=recognition', icon: Award,        tabs: ['recognition'],                      badge: false },
  { label: 'Funding',   href: '/dashboard?tab=funding',    icon: BookOpen,        tabs: ['funding', 'finances', 'money'],     badge: false },
  { label: 'Inbox',     href: '/dashboard?tab=inbox',      icon: Bell,            tabs: ['inbox'],                            badge: true  },
] as const

export function CoachSidebar({
  userName,
  userEmail,
}: {
  userName: string
  userEmail: string
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { signOut } = useClerk()

  const tab = searchParams?.get('tab') ?? ''

  const { data: inboxData } = useSWR<{ count: number }>(
    '/api/coach/notifications/unread',
    (url: string) => fetch(url).then((r) => r.json()),
    { refreshInterval: 60_000, revalidateOnFocus: false },
  )
  const unreadCount = inboxData?.count ?? 0

  const settingsActive = pathname === '/dashboard' && tab === 'settings'

  return (
    <PortalSidebar mobileTitle="Coach Portal" routeKey={`${pathname}?${tab}`}>
      <PortalBrand />
      <PortalLabel icon={GraduationCap} title="Coach Portal" subtitle="Team Dashboard" />

      <nav aria-label="Coach portal" className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
        {NAV_ITEMS.map((item) => (
          <PortalNavLink
            key={item.href}
            href={item.href}
            icon={item.icon}
            label={item.label}
            active={pathname === '/dashboard' && (item.tabs as readonly string[]).includes(tab)}
            badgeCount={item.badge ? unreadCount : 0}
            badgeLabel="unread notifications"
          />
        ))}
      </nav>

      <div className="shrink-0 space-y-0.5 border-t border-border px-2 py-3">
        <PortalNavLink
          href="/dashboard?tab=settings"
          icon={Settings}
          label="Settings"
          active={settingsActive}
        />
        <PortalSignOut
          onSignOut={() => {
            if (!COACH_PREVIEW) signOut({ redirectUrl: '/login' })
          }}
        />
        <PortalUserChip name={userName} email={userEmail} />
      </div>
    </PortalSidebar>
  )
}
