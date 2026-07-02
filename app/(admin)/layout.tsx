import { getAuthedProfile } from '@/lib/actions-utils'
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { AdminSidebar } from '@/components/admin/admin-sidebar'
import { CommandPaletteProvider } from '@/components/command-palette-provider'

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
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role === 'sponsor') redirect('/sponsor/dashboard?redirected=admin')
  if (profile?.role !== 'admin') redirect('/dashboard?redirected=admin')

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
