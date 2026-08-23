import { getAuthedProfile } from '@/lib/actions-utils'
import { SkipToContent } from '@/components/ui/skip-to-content'
import { AWAITING_SPONSOR_STATUSES } from '@/lib/submission-status'
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { SponsorSidebar } from '@/components/sponsor/sponsor-sidebar'
import { resolveActiveSponsorId } from '@/lib/active-sponsor-org'
import { createAdminClient } from '@/lib/supabase/admin'
import { SUPPORT_EMAIL } from '@/lib/site-config'

export default async function SponsorLayout({ children }: { children: React.ReactNode }) {
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
    .select('*, sponsors(*)')
    .eq('id', user.id)
    .single()

  if (profile?.role === 'admin') redirect('/admin?redirected=sponsor')
  if (profile?.role === 'coach') redirect('/dashboard?redirected=sponsor')
  if (profile?.role !== 'sponsor') redirect('/complete-profile')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sponsor = (profile as any)?.sponsors ?? null

  // An invited teammate whose profiles.sponsor_id has not yet been stamped (the brief
  // window between accepting the Clerk invite and the webhook landing) resolves through
  // their sponsor_members row instead — without this they would see "Awaiting
  // verification" forever despite already being a member.
  /**
   * A-12-01. A person may now belong to more than one sponsor organization, so this can no
   * longer be `.maybeSingle()` — with two memberships that throws, and the whole portal
   * falls into the "Awaiting verification" branch below for a fully provisioned user.
   */
  const { data: memberships } = await supabase
    .from('sponsor_members')
    .select('sponsor_id, sponsors:sponsor_id(*)')
    .eq('profile_id', user.id)

  const membershipRows = (memberships ?? []) as unknown as {
    sponsor_id: string
    sponsors: Record<string, unknown> | null
  }[]

  const sponsorIds = Array.from(
    new Set([
      ...(profile.sponsor_id ? [profile.sponsor_id] : []),
      ...membershipRows.map((m) => m.sponsor_id),
    ])
  )

  const defaultSponsorId = profile.sponsor_id ?? sponsorIds[0] ?? null

  // Same cookie, same validation as requireSponsor — so the shell and the pages inside it
  // can never disagree about which company is on screen.
  const resolvedSponsorId = defaultSponsorId
    ? await resolveActiveSponsorId(sponsorIds, defaultSponsorId)
    : null

  if (resolvedSponsorId && resolvedSponsorId !== profile.sponsor_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sponsor = (membershipRows.find((m) => m.sponsor_id === resolvedSponsorId)?.sponsors as any) ?? sponsor
  }
  if (!sponsor && resolvedSponsorId) {
    const { data: row } = await supabase.from('sponsors').select('*').eq('id', resolvedSponsorId).maybeSingle()
    sponsor = row ?? null
  }

  if (!resolvedSponsorId) {
    return (
      <div className="flex h-screen items-center justify-center bg-background px-4">
        <div className="max-w-md rounded-xl border border-border bg-card p-8 text-center space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Awaiting verification</h1>
          <p className="text-sm text-muted-foreground">
            Thanks for applying. An administrator is reviewing your sponsor application — most are approved within
            24 hours. You will receive an email when your account is activated.
          </p>
          <p className="text-xs text-muted-foreground">
            Need to update your application?{' '}
            <a className="underline" href={`mailto:${SUPPORT_EMAIL}`}>
              Contact support
            </a>
            .
          </p>
        </div>
      </div>
    )
  }

  // Sidebar badge: pitches awaiting THIS SPONSOR's decision.
  // This filtered on status='pending', which means "awaiting the ADMIN" and is a state a
  // sponsor-visible pitch never has — so the badge read 0 while real pitches waited.
  const { count: pendingCount } = await supabase
    .from('submissions')
    .select('id', { count: 'exact', head: true })
    .eq('sponsor_id', resolvedSponsorId)
    .in('status', [...AWAITING_SPONSOR_STATUSES])
    .is('deleted_at', null)

  const { count: pendingApprovalCount } = await supabase
    .from('sponsor_decision_proposals')
    .select('id', { count: 'exact', head: true })
    .eq('sponsor_id', resolvedSponsorId)
    .eq('status', 'pending')

  const companyName = sponsor?.company_name ?? 'Your Company'

  /**
   * A-12-01. Names only for the switcher — no funding figures and no contact details. A
   * viewer in one org must not learn another org's budget from a dropdown. Read through
   * the admin client because `sponsors_select` does not admit a sponsor reading sibling
   * rows, and a two-column projection is the smaller change than loosening that policy.
   */
  const switcherOrgs =
    sponsorIds.length > 1
      ? (
          await createAdminClient()
            .from('sponsors')
            .select('id, company_name')
            .in('id', sponsorIds)
            .order('company_name')
        ).data ?? []
      : []
  const userName = user.full_name ?? user.email ?? 'Sponsor'
  const userEmail = user.email ?? ''

  return (
    <div className="flex h-screen flex-col overflow-hidden text-foreground lg:flex-row">
      <SkipToContent />
      <SponsorSidebar
        orgs={switcherOrgs}
        activeOrgId={resolvedSponsorId}
        companyName={companyName}
        userName={userName}
        userEmail={userEmail}
        pendingCount={pendingCount ?? 0}
        pendingApprovalCount={pendingApprovalCount ?? 0}
      />
      <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto focus-visible:outline-none">
        <div className="mx-auto w-full max-w-[1000px] px-4 py-6 sm:px-8 sm:py-8 lg:px-12">
          {children}
        </div>
      </main>
    </div>
  )
}
