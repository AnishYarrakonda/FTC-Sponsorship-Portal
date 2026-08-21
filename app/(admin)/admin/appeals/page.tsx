import { redirect } from 'next/navigation'
import { getAuthedProfile } from '@/lib/actions-utils'
import { PageHeader } from '@/components/page-header'
import { AppealReviewPanel, type AdminAppeal } from '@/components/admin/appeal-review-panel'
import { AppealStatusPill } from '@/components/coach/appeal-status-pill'
import { verificationRejectionReason } from '@/lib/schemas/appeal'

export const dynamic = 'force-dynamic'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

export default async function AdminAppealsPage() {
  const authed = await getAuthedProfile()
  if (!authed) redirect('/login')
  const { supabase, user } = authed
  if (user.role !== 'admin') redirect('/dashboard')

  // appeals_select_admin grants is_admin() a full read; no admin client needed.
  const { data: rows } = await supabase
    .from('appeals')
    .select(
      'id, subject_type, subject_id, status, statement, created_at, decision_at, original_decider_id, assigned_reviewer_id, resolution_notes, resolved_at, appellant_profile_id'
    )
    .order('created_at', { ascending: true })
    .limit(200)

  const all = rows ?? []

  // Resolve the human names + the original decision text in as few round trips as possible,
  // rather than one query per row.
  const profileIds = Array.from(
    new Set(
      all.flatMap((a) => [a.appellant_profile_id, a.original_decider_id, a.assigned_reviewer_id]).filter(Boolean)
    )
  ) as string[]
  const submissionIds = all.filter((a) => a.subject_type === 'submission').map((a) => a.subject_id)
  const coachSubjectIds = all.filter((a) => a.subject_type === 'coach_verification').map((a) => a.subject_id)
  const verificationIds = all.filter((a) => a.subject_type === 'team_verification').map((a) => a.subject_id)

  const [{ data: profiles }, { data: submissions }, { data: deniedProfiles }, { data: verifications }] = await Promise.all([
    profileIds.length
      ? supabase.from('profiles').select('id, full_name').in('id', profileIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
    submissionIds.length
      ? supabase
          .from('submissions')
          .select('id, admin_feedback, sponsors:sponsor_id(company_name)')
          .in('id', submissionIds)
      : Promise.resolve({ data: [] as unknown[] }),
    coachSubjectIds.length
      ? supabase.from('profiles').select('id, denial_reason').in('id', coachSubjectIds)
      : Promise.resolve({ data: [] as { id: string; denial_reason: string | null }[] }),
    verificationIds.length
      ? supabase
          .from('team_verification_records')
          .select('id, ftc_team_number, claimed_team_name, official_team_name')
          .in('id', verificationIds)
      : Promise.resolve({
          data: [] as {
            id: string
            ftc_team_number: number
            claimed_team_name: string | null
            official_team_name: string | null
          }[],
        }),
  ])

  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const submissionById = new Map((submissions ?? []).map((s: any) => [s.id, s]))
  const denialById = new Map((deniedProfiles ?? []).map((p) => [p.id, p.denial_reason]))
  const verificationById = new Map((verifications ?? []).map((v) => [v.id, v]))

  const appeals: AdminAppeal[] = all.map((a) => {
    const submission = a.subject_type === 'submission' ? submissionById.get(a.subject_id) : null
    return {
      id: a.id,
      subject_type: a.subject_type,
      subject_id: a.subject_id,
      status: a.status,
      statement: a.statement,
      created_at: a.created_at,
      decision_at: a.decision_at,
      original_decider_id: a.original_decider_id,
      original_decider_name: a.original_decider_id ? (nameById.get(a.original_decider_id) ?? null) : null,
      assigned_reviewer_id: a.assigned_reviewer_id,
      assigned_reviewer_name: a.assigned_reviewer_id ? (nameById.get(a.assigned_reviewer_id) ?? null) : null,
      resolution_notes: a.resolution_notes,
      resolved_at: a.resolved_at,
      appellant_name: nameById.get(a.appellant_profile_id) ?? null,
      original_reason:
        a.subject_type === 'submission'
          ? (submission?.admin_feedback ?? null)
          : a.subject_type === 'team_verification'
            ? (() => {
                const v = verificationById.get(a.subject_id)
                // The matcher writes scores, not prose, so the reason is composed — the same
                // sentence the coach was shown on the appeal form.
                return v ? verificationRejectionReason(v) : null
              })()
            : (denialById.get(a.subject_id) ?? null),
      subject_label:
        a.subject_type === 'submission'
          ? `pitch to ${submission?.sponsors?.company_name ?? 'a sponsor'}`
          : a.subject_type === 'team_verification'
            ? `FTC Team #${verificationById.get(a.subject_id)?.ftc_team_number ?? '—'} verification`
            : 'coach verification',
    }
  })

  const active = appeals.filter((a) => a.status === 'open' || a.status === 'under_review')
  const resolved = appeals
    .filter((a) => a.status !== 'open' && a.status !== 'under_review')
    .sort((x, y) => new Date(y.resolved_at ?? 0).getTime() - new Date(x.resolved_at ?? 0).getTime())

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Appeals"
        subtitle="Coaches contesting a declined pitch or a denied credential check. Oldest first — an unresolved appeal is our failure, not theirs."
      />

      <AppealReviewPanel
        appeals={active}
        currentAdminId={user.id}
        isSuperAdmin={(user as { admin_level?: string }).admin_level === 'super_admin'}
      />

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold">Resolved</h2>
          <p className="text-sm text-muted-foreground">
            An appeals log nobody can read afterwards is not a record.
          </p>
        </div>
        {resolved.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            Nothing resolved yet.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border">
            {resolved.map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-4 p-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {a.appellant_name ?? 'A coach'} · {a.subject_label}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {a.resolved_at ? `Resolved ${formatDate(a.resolved_at)}` : ''}
                    {a.assigned_reviewer_name ? ` by ${a.assigned_reviewer_name}` : ''}
                  </p>
                  {a.resolution_notes && (
                    <p className="mt-1 text-sm text-muted-foreground">{a.resolution_notes}</p>
                  )}
                </div>
                <AppealStatusPill status={a.status} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
