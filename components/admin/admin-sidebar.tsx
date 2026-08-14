'use client'

import { usePathname } from 'next/navigation'
import { useClerk } from '@clerk/nextjs'
import useSWR from 'swr'
import {
  LayoutDashboard,
  Inbox,
  Building2,
  Users,
  BarChart2,
  Shield,
  Settings,
  Receipt,
  FileSignature,
  UserCog,
  Scale,
  Gavel,
  Award,
  FileBarChart,
  AtSign,
} from 'lucide-react'
import {
  PortalBrand,
  PortalLabel,
  PortalNavLink,
  PortalSidebar,
  PortalSignOut,
  PortalUserChip,
} from '@/components/ui/portal-shell'
import type { AdminLevel } from '@/lib/schemas/admin'

const DEV_AUTH_BYPASS =
  process.env.NODE_ENV !== 'production' &&
  process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS === 'true'

const NAV_ITEMS = [
  { label: 'Dashboard',    href: '/admin',        icon: LayoutDashboard, exact: true,  badge: false },
  { label: 'Review',       href: '/moderation',   icon: Inbox,           exact: false, badge: true  },
  { label: 'Applications', href: '/applications', icon: Shield,          exact: false, badge: false },
  { label: 'Sponsors',     href: '/sponsors',     icon: Building2,       exact: false, badge: false },
  { label: 'Agreements',   href: '/agreements',   icon: FileSignature,  exact: false, badge: false },
  { label: 'Teams',        href: '/coaches',      icon: Users,           exact: false, badge: false },
  { label: 'Payouts',      href: '/payouts',      icon: Receipt,         exact: false, badge: false },
  { label: 'Reconciliation',href: '/reconciliation',icon: Receipt,         exact: false, badge: false },
  { label: 'Appeals',      href: '/admin/appeals',      icon: Gavel,           exact: false, badge: false },
  { label: 'Analytics',    href: '/analytics',    icon: BarChart2,       exact: false, badge: false },
  { label: 'Recognition',  href: '/recognition',  icon: Award,           exact: false, badge: false },
  { label: 'Impact',       href: '/impact',       icon: FileBarChart,    exact: false, badge: false },
  { label: 'Capacity',     href: '/admin/capacity',icon: Scale,          exact: false, badge: false },
  { label: 'Email domains',href: '/admin/domains', icon: AtSign,          exact: false, badge: false },
  // Super-admin only — filtered out below rather than rendered disabled, because a
  // reviewer clicking it would only reach the permission-denied card.
  { label: 'Admin team',   href: '/admin/team',   icon: UserCog,         exact: false, badge: false, superAdminOnly: true },
] as const

export function AdminSidebar({
  userName,
  userEmail,
  adminLevel = null,
}: {
  userName: string
  userEmail: string
  adminLevel?: AdminLevel | null
}) {
  const pathname = usePathname()
  const { signOut } = useClerk()

  const { data: queueData } = useSWR<{ count: number }>(
    '/api/admin/queue/count',
    (url: string) => fetch(url).then((r) => r.json()),
    { refreshInterval: 60_000, revalidateOnFocus: false },
  )
  const queueCount = queueData?.count ?? 0

  const navItems = NAV_ITEMS.filter(
    (item) => !('superAdminOnly' in item && item.superAdminOnly) || adminLevel === 'super_admin'
  )

  return (
    <PortalSidebar mobileTitle="Admin" routeKey={pathname}>
      <PortalBrand />
      <PortalLabel icon={Shield} title="Admin" subtitle="Control Panel" />

      <nav aria-label="Admin portal" className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
        {navItems.map((item) => (
          <PortalNavLink
            key={item.href}
            href={item.href}
            icon={item.icon}
            label={item.label}
            active={item.exact ? pathname === item.href : pathname.startsWith(item.href)}
            badgeCount={item.badge ? queueCount : 0}
            badgeLabel="submissions awaiting review"
          />
        ))}
      </nav>

      <div className="shrink-0 space-y-0.5 border-t border-border px-2 py-3">
        <PortalNavLink
          href="/settings"
          icon={Settings}
          label="Settings"
          active={pathname.startsWith('/settings')}
        />
        <PortalSignOut
          onSignOut={() => {
            if (!DEV_AUTH_BYPASS) signOut({ redirectUrl: '/login' })
          }}
        />
        <PortalUserChip name={userName} email={userEmail} />
      </div>
    </PortalSidebar>
  )
}
