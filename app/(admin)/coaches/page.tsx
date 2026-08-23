import { createClient } from '@/lib/supabase/server'
// A-06-03. 60s, not 1800s. The "open full size" control re-mints on demand, so the
// short TTL does not turn into a dead link.
import { SENSITIVE_DOCUMENT_URL_TTL_SECONDS } from '@/app/actions/sensitive-documents'
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
      coach_credentials_purged_at,
      date_of_birth, phone_number, address_line1, city, state, zip_code, referral_source,
      coppa_acknowledged, tos_accepted, denial_reason, denied_at, pending_team_data,
      teams:teams(team_name, ftc_team_number, city, state)
    `)
    .eq('role', 'coach')
    .order('created_at', { ascending: false })

  // Latest FTC verification check per coach (prompts/07) — team_verification_records
  // has no dedicated join point on profiles, so it's fetched separately and matched by
  // profile_id below. Admins see every row (tvr_select_admin, 0081).
  const coachIds = (coaches ?? []).map((c) => c.id)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let verificationRows: any[] = []
  if (coachIds.length) {
    const { data } = await supabase
      .from('team_verification_records')
      .select('*')
      .in('profile_id', coachIds)
      .order('checked_at', { ascending: false })
    verificationRows = data ?? []
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const latestVerificationByCoach = new Map<string, any>()
  for (const row of verificationRows) {
    if (row.profile_id && !latestVerificationByCoach.has(row.profile_id)) {
      latestVerificationByCoach.set(row.profile_id, row)
    }
  }

  // A coach is reviewable only while unverified WITH a document on file — that is the
  // exact condition under which the card renders the ID viewer.
  const needsReview = (c: { coach_verified: boolean; coach_credentials_url: string | null }) =>
    !c.coach_verified && !!c.coach_credentials_url

  // Signed URLs (30-min expiry) are minted ONLY for that queue. This used to run for
  // every coach on the page — one storage round-trip each — to build URLs that were
  // never placed in the DOM, because verified coaches have no viewer to put them in.
  // At 200 coaches that was 200 wasted API calls on every single page load.
  const adminClient = createAdminClient()

  const coachesWithSignedUrls = await Promise.all(
    (coaches ?? []).map(async (coach) => {
      let signedUrl: string | null = null
      if (needsReview(coach)) {
        const { data } = await adminClient.storage
          .from('coach-credentials')
          .createSignedUrl(coach.coach_credentials_url!, SENSITIVE_DOCUMENT_URL_TTL_SECONDS)
        signedUrl = data?.signedUrl ?? null
      }
      // teams is returned as an array from the join; grab first
      const teamArr = coach.teams as any
      const team = Array.isArray(teamArr) ? teamArr[0] ?? null : teamArr ?? null
      const verification = latestVerificationByCoach.get(coach.id) ?? null
      return { ...coach, email: coach.email ?? null, signedUrl, team, verification }
    })
  )

  const pending  = coachesWithSignedUrls.filter(needsReview)
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
