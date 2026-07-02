import { auth, currentUser } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getAuthedProfile } from '@/lib/actions-utils'
import { CompleteProfileChooser } from '@/components/auth/complete-profile-chooser'

/**
 * Orphan recovery: an authenticated Clerk user whose `profiles` row was never
 * created (signup crashed after the Clerk session activated — happens to both
 * coach and sponsor signups). Role layouts and /awaiting-verification route
 * profile-less users here instead of /login (which would redirect-loop for an
 * authed session). The chooser lets the user finish as either a coach or a
 * sponsor representative.
 */
export default async function CompleteProfilePage() {
  const { userId } = await auth()
  if (!userId) redirect('/login')

  // If a profile row exists there is nothing to complete — go home by role.
  const authed = await getAuthedProfile()
  if (authed) {
    const role = authed.user.role
    redirect(role === 'admin' ? '/admin' : role === 'sponsor' ? '/sponsor/dashboard' : '/dashboard')
  }

  const clerkUser = await currentUser()
  const email =
    clerkUser?.primaryEmailAddress?.emailAddress ??
    clerkUser?.emailAddresses?.[0]?.emailAddress ??
    ''
  const defaultName = clerkUser?.fullName ?? ''

  return <CompleteProfileChooser email={email} defaultName={defaultName} />
}
