import { getAuthedProfile } from '@/lib/actions-utils'
import { SkipToContent } from '@/components/ui/skip-to-content'
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { AdminSidebar } from '@/components/admin/admin-sidebar'
import { CommandPaletteProvider } from '@/components/command-palette-provider'
import type { AdminLevel } from '@/lib/schemas/admin'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const authed = await getAuthedProfile()
  if (!authed) {
    // Clerk session without a profiles row = orphaned signup → recovery page
    // (redirecting to /login would loop: middleware bounces authed users back).
    const { userId } = await auth()
    redirect(userId ? '/complete-profile' : '/login')
  }
  const { supabase, user } = authed

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, admin_level')
    .eq('id', user.id)
    .single()

  if (profile?.role === 'sponsor') redirect('/sponsor/dashboard?redirected=admin')
  if (profile?.role !== 'admin') redirect('/dashboard?redirected=admin')

  const userName = user.full_name ?? user.email ?? 'Admin'
  const userEmail = user.email ?? ''
  // Drives which nav entries the sidebar renders. UX only — every super-admin action
  // re-checks with requireSuperAdmin() server-side.
  const adminLevel = (profile?.admin_level ?? null) as AdminLevel | null

  return (
    <div className="flex h-screen flex-col overflow-hidden text-foreground lg:flex-row">
      <SkipToContent />
      <AdminSidebar userName={userName} userEmail={userEmail} adminLevel={adminLevel} />
      {/**
        * B-04-09 — DOCUMENTED EXEMPTION, deliberately not "fixed".
        *
        * axe reports `scrollable-region-focusable` (serious) against this node on
        * /reconciliation at 768px and 375px. The two genuine instances of that rule (the
        * analytics table wrapper and the capacity formula `<pre>`) were given
        * `tabIndex={0}` + `role="region"` + a label. This one is different in kind and
        * must NOT get the same treatment:
        *
        *  - `tabIndex={0}` here would put the entire admin page shell into the tab order,
        *    ahead of everything inside it, on every admin page. That is a worse experience
        *    for the users the rule exists to protect.
        *  - The node is ALREADY programmatically focusable: `tabIndex={-1}` is what makes
        *    it the target of <SkipToContent>. A keyboard user reaches it by the skip link
        *    — the mechanism designed for exactly this — and a focused scroll container
        *    responds to arrow keys, so the content is operable from the keyboard, which is
        *    what WCAG 2.1.1 actually requires.
        *  - It only scrolls horizontally at all because `overflow-y-auto` makes the other
        *    axis compute to `auto` per CSS overflow rules; there is no intentional
        *    horizontal scroll region here.
        *
        * axe's rule tests for `tabindex >= 0` specifically, so a skip-link target is a
        * known false positive for it. Recorded in docs/accessibility-audit.md.
        */}
      <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto focus-visible:outline-none">
        <div className="mx-auto w-full max-w-[1100px] px-4 py-6 sm:px-8 sm:py-8 lg:px-12">
          {children}
        </div>
      </main>
      <CommandPaletteProvider />
    </div>
  )
}
