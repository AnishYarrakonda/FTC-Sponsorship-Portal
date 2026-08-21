import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getAuthedProfile } from '@/lib/actions-utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AppealStatusPill } from '@/components/coach/appeal-status-pill'
import { WithdrawAppealButton } from '@/components/coach/withdraw-appeal-button'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { APPEAL_SUBJECT_LABELS, type AppealSubjectType } from '@/lib/schemas/appeal'

export const dynamic = 'force-dynamic'

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })
}

export default async function CoachAppealDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const authed = await getAuthedProfile()
  if (!authed) redirect('/login')
  const { supabase } = authed

  // appeals_select_own does the ownership work: another coach's appeal simply is not here,
  // which is what turns this into notFound() rather than a 403.
  const { data: appeal } = await supabase
    .from('appeals')
    .select('id, subject_type, subject_id, status, statement, resolution_notes, created_at, resolved_at')
    .eq('id', id)
    .maybeSingle()

  if (!appeal) notFound()

  const isOpen = appeal.status === 'open' || appeal.status === 'under_review'
  const isSubmission = appeal.subject_type === 'submission'
  const subjectLabel = APPEAL_SUBJECT_LABELS[appeal.subject_type as AppealSubjectType] ?? 'Appeal'

  return (
    <div className="container mx-auto max-w-3xl space-y-6 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/appeals" className="text-sm text-muted-foreground hover:underline">
            ← All appeals
          </Link>
          <h1 className="mt-1 text-2xl font-bold">
            {`Appeal — ${subjectLabel.toLowerCase()}`}
          </h1>
          <p className="text-sm text-muted-foreground">Filed {formatDate(appeal.created_at)}</p>
        </div>
        <AppealStatusPill status={appeal.status} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What you wrote</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm">{appeal.statement}</p>
        </CardContent>
      </Card>

      {appeal.resolution_notes && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {appeal.status === 'overturned' ? 'Your appeal was successful' : 'The decision stands'}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="whitespace-pre-wrap text-sm">{appeal.resolution_notes}</p>

            {appeal.status === 'overturned' && isSubmission && (
              <Link href={`/submissions/${appeal.subject_id}/edit`} className={cn(buttonVariants({ size: 'sm' }), 'self-start')}>
                Edit and resubmit your pitch
              </Link>
            )}
            {appeal.status === 'overturned' && !isSubmission && (
              <Link href="/upload-credentials" className={cn(buttonVariants({ size: 'sm' }), 'self-start')}>
                Upload your photo ID again
              </Link>
            )}
          </CardContent>
        </Card>
      )}

      {isOpen && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Withdraw</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              Withdrawing takes this off the review queue. You can file one more appeal on
              the same decision while the 30-day window is still open.
            </p>
            <WithdrawAppealButton appealId={appeal.id} />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
