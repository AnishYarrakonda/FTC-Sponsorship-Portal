import { getAuthedProfile } from '@/lib/actions-utils'
import { redirect } from 'next/navigation'
import { AdminSidebar } from '@/components/admin/admin-sidebar'
import { CommandPaletteProvider } from '@/components/command-palette-provider'

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const authed = await getAuthedProfile()
  if (!authed) redirect('/login')
  const { supabase, user } = authed

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, coach_verified, sponsor_id')
    .eq('id', user.id)
    .single()

  // Coaches and sponsors have settings embedded in their own portals — but ONLY once
  // they are through the gate. Redirecting unconditionally made account settings
  // unreachable for exactly the people most likely to need it:
  //
  //   unverified coach -> /dashboard?tab=settings -> (coach) layout -> /awaiting-verification
  //   pending sponsor  -> /sponsor/settings       -> (sponsor) layout -> pending screen
  //
  // Those users have already uploaded a government photo ID, and they could not delete
  // their account or export their data. That is a data-rights problem, not a UX one, so
  // they fall through to the standalone /settings page instead.
  if (profile?.role === 'coach' && profile.coach_verified) redirect('/dashboard?tab=settings')
  if (profile?.role === 'sponsor' && profile.sponsor_id) redirect('/sponsor/settings')

  const userName = user.full_name ?? user.email ?? 'Admin'
  const userEmail = user.email ?? ''

  return (
    <div className="flex h-screen overflow-hidden text-foreground">
      <AdminSidebar userName={userName} userEmail={userEmail} />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1100px] px-6 py-8 sm:px-8 lg:px-12">
          {children}
        </div>
      </main>
      <CommandPaletteProvider />
    </div>
  )
}
