'use client'

import { usePathname } from 'next/navigation'
import { useClerk } from '@clerk/nextjs'
import {
  LayoutDashboard,
  FileText,
  Bell,
  Settings,
  Building2,
  History,
  Users,
  ShieldCheck,
  FileBarChart,
} from 'lucide-react'
import { SponsorOrgSwitcher } from '@/components/sponsor/org-switcher'
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
  { label: 'Impact', href: '/sponsor/impact', icon: FileBarChart, exact: false },
  { label: 'Inbox', href: '/sponsor/inbox', icon: Bell, exact: false, badge: 'inbox' },
  { label: 'Team', href: '/sponsor/members', icon: Users, exact: false },
  // A-12-05. Self-serve activity log. Org-admin only; the page renders an explanatory
  // message rather than 404ing for other seats, so the nav entry can stay unconditional.
  { label: 'Activity', href: '/sponsor/activity', icon: History, exact: false },
] as const

export function SponsorSidebar({
  orgs = [],
  activeOrgId,
  companyName,
  userName,
  userEmail,
  pendingCount = 0,
  pendingApprovalCount = 0,
}: {
  /** A-12-01. Empty or single-entry hides the switcher entirely. */
  orgs?: { id: string; company_name: string }[]
  activeOrgId?: string | null
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
      {/* A-12-01. Renders nothing unless this person belongs to more than one org. */}
      {activeOrgId && <SponsorOrgSwitcher orgs={orgs} activeId={activeOrgId} />}

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
