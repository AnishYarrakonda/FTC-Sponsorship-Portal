'use client'

import { usePathname } from 'next/navigation'
import { useClerk } from '@clerk/nextjs'
import {
  LayoutDashboard,
  FileText,
  Wallet,
  Bell,
  Settings,
  Building2,
  Users,
  ShieldCheck,
} from 'lucide-react'
import {
  PortalBrand,
  PortalLabel,
  PortalNavLink,
  PortalSidebar,
  PortalSignOut,
  PortalUserChip,
} from '@/components/ui/portal-shell'

const SPONSOR_PREVIEW =
  process.env.NODE_ENV !== 'production' &&
  process.env.NEXT_PUBLIC_SPONSOR_PREVIEW === '1'

const NAV_ITEMS = [
  { label: 'Overview', href: '/sponsor/dashboard', icon: LayoutDashboard, exact: true },
  { label: 'Pitches', href: '/sponsor/submissions', icon: FileText, exact: false, badge: 'pending' },
  { label: 'Approvals', href: '/sponsor/approvals', icon: ShieldCheck, exact: false, badge: 'approvals' },
  { label: 'Funding', href: '/sponsor/funding', icon: Wallet, exact: false },
  { label: 'Inbox', href: '/sponsor/inbox', icon: Bell, exact: false, badge: 'inbox' },
  { label: 'Team', href: '/sponsor/members', icon: Users, exact: false },
] as const

export function SponsorSidebar({
  companyName,
  userName,
  userEmail,
  pendingCount = 0,
  pendingApprovalCount = 0,
}: {
  companyName: string
  userName: string
  userEmail: string
  pendingCount?: number
  pendingApprovalCount?: number
}) {
  const pathname = usePathname()
  const { signOut } = useClerk()

  const badges: Record<string, number> = { pending: pendingCount, inbox: 0, approvals: pendingApprovalCount }

  return (
    <PortalSidebar mobileTitle={companyName} routeKey={pathname}>
      <PortalBrand />
      <PortalLabel icon={Building2} title={companyName} subtitle="Sponsor Portal" />

      <nav aria-label="Sponsor portal" className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
        {NAV_ITEMS.map((item) => (
          <PortalNavLink
            key={item.href}
            href={item.href}
            icon={item.icon}
            label={item.label}
            active={item.exact ? pathname === item.href : pathname.startsWith(item.href)}
            badgeCount={'badge' in item ? (badges[item.badge] ?? 0) : 0}
            badgeLabel="pending pitches"
          />
        ))}
      </nav>

      <div className="shrink-0 space-y-0.5 border-t border-border px-2 py-3">
        <PortalNavLink
          href="/sponsor/settings"
          icon={Settings}
          label="Settings"
          active={pathname.startsWith('/sponsor/settings')}
        />
        <PortalSignOut
          onSignOut={() => {
            if (!SPONSOR_PREVIEW) signOut({ redirectUrl: '/login' })
          }}
        />
        <PortalUserChip name={userName} email={userEmail} />
      </div>
    </PortalSidebar>
  )
}
