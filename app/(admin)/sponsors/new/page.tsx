import { getAuthedProfile } from '@/lib/actions-utils'
import { redirect } from 'next/navigation'
import { SponsorForm } from '@/components/sponsor/sponsor-form'
import { buttonVariants } from '@/components/ui/button'
import Link from 'next/link'

export default async function NewSponsorPage() {
  const authed = await getAuthedProfile()

  if (!authed) redirect('/login')
  const { supabase, user } = authed

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, admin_level')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') {
    redirect('/dashboard')
  }

  // Creating a sponsor company sets a funding cap, so the whole form is super-admin-only
  // (adminCreateSponsor rejects a reviewer regardless).
  if (profile?.admin_level !== 'super_admin') {
    redirect('/sponsors?error=super_admin_required')
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Add Sponsor</h1>
        <Link href="/sponsors" className={buttonVariants({ variant: 'outline' })}>
          ← Back
        </Link>
      </div>
      <SponsorForm />
    </div>
  )
}
