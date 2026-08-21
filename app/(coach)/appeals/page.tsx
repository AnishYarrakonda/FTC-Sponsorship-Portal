import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getAuthedProfile } from '@/lib/actions-utils'
import { listAppealableSubjects } from '@/app/actions/appeals'
import { AppealForm } from '@/components/coach/appeal-form'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AppealStatusPill } from '@/components/coach/appeal-status-pill'
import type { AppealableSubject } from '@/lib/schemas/appeal'
import { APPEAL_SUBJECT_LABELS, type AppealSubjectType } from '@/lib/schemas/appeal'

export const dynamic = 'force-dynamic'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

export default async function CoachAppealsPage() {
  const authed = await getAuthedProfile()
  if (!authed) redirect('/login')
  const { supabase, user } = authed

  // appeals_select_own already scopes this to the caller; no TS re-filter needed.
  const { data: appeals } = await supabase
    .from('appeals')
    .select('id, subject_type, subject_id, status, statement, resolution_notes, created_at, resolved_at')
    .order('created_at', { ascending: false })

  const subjectsResult = await listAppealableSubjects()
  const subjects: AppealableSubject[] = 'error' in subjectsResult ? [] : subjectsResult.subjects
  const openable = subjects.filter((s) => s.windowOpen && !s.existingAppeal)

  return (
    <div className="container mx-auto max-w-3xl space-y-6 py-8">
      <div>
        <h1 className="text-2xl font-bold">Appeals</h1>
        <p className="text-sm text-muted-foreground">
          If a decision on your account or one of your pitches was wrong, you can ask a
          different administrator to re-read it. You have 30 days from the decision.
        </p>
      </div>

      {openable.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Decisions you can appeal</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {openable.map((s) => (
              <div key={`${s.subjectType}:${s.subjectId}`} className="flex flex-col gap-2">
                <div>
                  <p className="text-sm font-medium">{s.label}</p>
                  <p className="text-xs text-muted-foreground">
                    Decided {formatDate(s.decisionAt)}
                  </p>
                </div>
                {s.originalReason && (
                  <p className="whitespace-pre-wrap rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
                    {s.originalReason}
                  </p>
                )}
                <AppealForm subject={s} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your appeals</CardTitle>
        </CardHeader>
        <CardContent>
          {(appeals ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              You have not filed any appeals.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {(appeals ?? []).map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <Link href={`/appeals/${a.id}`} className="text-sm font-medium hover:underline">
                      {APPEAL_SUBJECT_LABELS[a.subject_type as AppealSubjectType] ?? 'Appeal'}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Filed {formatDate(a.created_at)}
                      {a.resolved_at ? ` · Resolved ${formatDate(a.resolved_at)}` : ''}
                    </p>
                    {a.resolution_notes && (
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{a.resolution_notes}</p>
                    )}
                  </div>
                  <AppealStatusPill status={a.status} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
