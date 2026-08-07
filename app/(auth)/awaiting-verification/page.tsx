import Link from 'next/link'
import { auth } from '@clerk/nextjs/server'
import { getAuthedProfile } from '@/lib/actions-utils'
import { redirect } from 'next/navigation'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { SignOutButton } from './sign-out-button'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Awaiting verification',
}


export default async function AwaitingVerificationPage() {
  const authed = await getAuthedProfile()

  if (!authed) {
    // Authenticated Clerk session but no profiles row → orphaned signup;
    // recovery lives at /complete-profile (redirecting to /login would loop).
    const { userId } = await auth()
    redirect(userId ? '/complete-profile' : '/login')
  }
  const { supabase, user } = authed

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, sponsor_id, coach_verified, coach_credentials_url, full_name, denial_reason, denied_at')
    .eq('id', user.id)
    .single()

  if (profile?.coach_verified) redirect('/dashboard')

  // Sponsor applicants have no credentials to upload — their pending state lives
  // in the sponsor layout, which shows the application-under-review screen.
  if (profile?.role === 'sponsor') redirect('/sponsor/dashboard')

  const hasCredentials = !!profile?.coach_credentials_url
  const displayName = profile?.full_name ?? user.email ?? 'Coach'
  const isDenied = !profile?.coach_verified && !!profile?.denied_at

  if (isDenied) {
    return (
      <div className="min-h-screen text-foreground flex items-center justify-center px-4">
        <div className="w-full max-w-md space-y-6">
          <div className="rounded-2xl border border-border bg-card p-8 text-center space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30 text-2xl">
              ✕
            </div>

            <div>
              <h1 className="text-xl font-semibold text-foreground">
                Your application was not approved
              </h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                An administrator reviewed your credentials on{' '}
                <span className="text-foreground font-medium" suppressHydrationWarning>
                  {new Date(profile!.denied_at!).toLocaleDateString()}
                </span>{' '}
                and could not verify them.
              </p>
            </div>

            <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-left space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-red-600 dark:text-red-400">
                Reason from the reviewer
              </p>
              <p className="text-sm text-foreground whitespace-pre-wrap">
                {profile!.denial_reason ?? 'No reason was provided. Please contact support for details.'}
              </p>
            </div>

            <div className="rounded-xl border border-border bg-background/60 p-4 text-left space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                What to do next
              </p>
              <ul className="text-sm text-muted-foreground list-disc pl-4 space-y-1">
                <li>Fix the issue described above (for example, provide a current, legible photo ID).</li>
                <li>Re-upload your credentials — this automatically puts you back in the review queue.</li>
                <li>Still stuck? Reply to the denial email or contact support below.</li>
              </ul>
            </div>

            <p className="text-xs text-muted-foreground">
              Registered as <span className="font-medium text-foreground">{user.email}</span>
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Link href="/upload-credentials" className={cn(buttonVariants({ variant: 'default' }), 'w-full')}>
              Re-upload credentials
            </Link>
            <a
              href="mailto:support@ftcportal.dev"
              className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}
            >
              Contact support
            </a>
            <SignOutButton />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen text-foreground flex items-center justify-center px-4">
      <div className="w-full max-w-md space-y-6">
        {/* Status card */}
        <div className="rounded-2xl border border-border bg-card p-8 text-center space-y-4">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30 text-2xl">
            ⏳
          </div>

          <div>
            <h1 className="text-xl font-semibold text-foreground">Under review, {displayName.split(' ')[0]}</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Your credentials are in the queue. Most coaches are verified within{' '}
              <strong className="text-foreground">24 hours</strong> on business days.
            </p>
          </div>

          <div className="rounded-xl border border-border bg-background/60 p-4 text-left space-y-2">
            <div className="flex items-center gap-2.5 text-sm">
              <span className={cn('h-2 w-2 rounded-full shrink-0', hasCredentials ? 'bg-emerald-500' : 'bg-amber-400')} />
              <span className="text-foreground">
                {hasCredentials ? 'Credentials uploaded' : 'Credentials pending upload'}
              </span>
            </div>
            <div className="flex items-center gap-2.5 text-sm">
              <span className="h-2 w-2 rounded-full shrink-0 bg-muted-foreground/30" />
              <span className="text-muted-foreground">Admin review in progress</span>
            </div>
            <div className="flex items-center gap-2.5 text-sm">
              <span className="h-2 w-2 rounded-full shrink-0 bg-muted-foreground/30" />
              <span className="text-muted-foreground">Dashboard unlocked — email notification sent</span>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Registered as <span className="font-medium text-foreground">{user.email}</span>
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2">
          {!hasCredentials && (
            <Link href="/upload-credentials" className={cn(buttonVariants({ variant: 'default' }), 'w-full')}>
              Upload credentials
            </Link>
          )}
          <a
            href="mailto:support@ftcportal.dev"
            className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}
          >
            Contact support
          </a>
          <SignOutButton />
        </div>
      </div>
    </div>
  )
}
