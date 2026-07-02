import { currentUser } from '@clerk/nextjs/server'
import { getAuthedProfile } from '@/lib/actions-utils'
import { redirect } from 'next/navigation'
import { PageHeader } from '@/components/page-header'
import { AccountSettings } from '@/components/account/account-settings'

export default async function SettingsPage() {
  const authed = await getAuthedProfile()

  if (!authed) redirect('/login')
  const { supabase, user } = authed

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role')
    .eq('id', user.id)
    .single()

  // Surface a pending email change (registered in Clerk but not yet verified)
  // so the "verification sent" state survives reloads.
  let pendingEmail: string | null = null
  try {
    const clerkUser = await currentUser()
    const primaryId = clerkUser?.primaryEmailAddressId
    pendingEmail =
      clerkUser?.emailAddresses.find(
        (e) => e.id !== primaryId && e.verification?.status !== 'verified'
      )?.emailAddress ?? null
  } catch {
    // Non-fatal: settings still render without the pending banner.
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <PageHeader title="Account Settings" subtitle="Manage your profile, password, and account." />
      <div style={{ maxWidth: 640, margin: '0 auto', width: '100%' }}>
        <AccountSettings
          currentName={profile?.full_name ?? ''}
          email={user.email ?? ''}
          role={profile?.role ?? 'coach'}
          pendingEmail={pendingEmail}
        />
      </div>
    </div>
  )
}
