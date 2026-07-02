import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { UserCheck } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { CoachVerificationCard } from '@/components/admin/coach-verification-card'

export default async function CoachesPage() {
  const supabase = await createClient()

  const { data: coaches } = await supabase
    .from('profiles')
    .select(`
      id, full_name, email, created_at, coach_verified, coach_credentials_url,
      date_of_birth, phone_number, address_line1, city, state, zip_code, referral_source,
      coppa_acknowledged, tos_accepted, denial_reason, denied_at, pending_team_data,
      teams:teams(team_name, ftc_team_number, city, state)
    `)
    .eq('role', 'coach')
    .order('created_at', { ascending: false })

  // Generate signed URLs for credentials (30-min expiry) server-side
  const adminClient = createAdminClient()

  const coachesWithSignedUrls = await Promise.all(
    (coaches ?? []).map(async (coach) => {
      let signedUrl: string | null = null
      if (coach.coach_credentials_url) {
        const { data } = await adminClient.storage
          .from('coach-credentials')
          .createSignedUrl(coach.coach_credentials_url, 1800)
        signedUrl = data?.signedUrl ?? null
      }
      // teams is returned as an array from the join; grab first
      const teamArr = coach.teams as any
      const team = Array.isArray(teamArr) ? teamArr[0] ?? null : teamArr ?? null
      return { ...coach, email: coach.email ?? null, signedUrl, team }
    })
  )

  const pending  = coachesWithSignedUrls.filter(c => !c.coach_verified && c.coach_credentials_url)
  const verified = coachesWithSignedUrls.filter(c =>  c.coach_verified)
  const waiting  = coachesWithSignedUrls.filter(c => !c.coach_verified && !c.coach_credentials_url)

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        title="Teams & Coaches"
        subtitle="Verify coaches who have uploaded credentials. Only verified coaches can create teams and submit pitches."
      />

      {/* Awaiting Verification */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-widest font-mono">
            Awaiting Verification
          </h2>
          {pending.length > 0 && (
            <span className="inline-flex items-center rounded-full bg-[var(--badge-warning-bg)] border border-[var(--badge-warning-text)]/25 text-[var(--badge-warning-text)] text-xs font-semibold px-2 py-0.5">
              {pending.length}
            </span>
          )}
        </div>
        {pending.length === 0 ? (
          <EmptyState
            icon={UserCheck}
            title="No coaches pending verification"
            description="Coaches appear here as soon as they upload credentials during signup."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {pending.map(coach => (
              <CoachVerificationCard key={coach.id} coach={coach as unknown as import('@/components/admin/coach-verification-card').CoachData} />
            ))}
          </div>
        )}
      </section>

      {/* Verified */}
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest font-mono">
          Verified Coaches
        </h2>
        {verified.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No verified coaches yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {verified.map(coach => (
              <CoachVerificationCard key={coach.id} coach={coach as unknown as import('@/components/admin/coach-verification-card').CoachData} />
            ))}
          </div>
        )}
      </section>

      {/* No credentials */}
      {waiting.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest font-mono">
            No Credentials Uploaded
          </h2>
          <div className="flex flex-col gap-3">
            {waiting.map(coach => (
              <CoachVerificationCard key={coach.id} coach={coach as unknown as import('@/components/admin/coach-verification-card').CoachData} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
