import Link from 'next/link'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { LucideIcon } from 'lucide-react'
import { CheckCircle2, Clock, FileSignature } from 'lucide-react'
import type { Database } from '@/lib/supabase/types'

interface AgreementStatusRowProps {
  supabase: SupabaseClient<Database>
  submissionId: string
  viewerRole: 'sponsor' | 'coach'
}

type AgreementState = 'not_required' | 'awaiting_sponsor' | 'awaiting_coach' | 'executed'

const STATE_CONFIG: Record<AgreementState, { label: string; icon: LucideIcon }> = {
  not_required: { label: 'Not required yet', icon: FileSignature },
  awaiting_sponsor: { label: 'Awaiting sponsor signature', icon: Clock },
  awaiting_coach: { label: 'Awaiting team countersignature', icon: Clock },
  executed: { label: 'Agreement executed', icon: CheckCircle2 },
}

/**
 * Reads through the caller's own RLS-respecting `supabase` client (passed down from the
 * page, real or preview-mock), so it only ever sees fulfillments/signatures the viewer is
 * already entitled to. The database is the real gate; this row is a courtesy.
 *
 * Call as `await AgreementStatusRow({...})`, never `<AgreementStatusRow .../>` — invoking it
 * as a JSX element makes Next.js try to Flight-serialize the real SupabaseClient prop for
 * RSC dev-mode owner-stack tracking, which crashes (it isn't a plain serializable object).
 * A direct function call inlines the returned JSX with no such serialization boundary.
 */
export async function AgreementStatusRow({ supabase, submissionId, viewerRole }: AgreementStatusRowProps) {
  const { data: fulfillment } = await supabase
    .from('funding_fulfillments')
    .select('id, status')
    .eq('submission_id', submissionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!fulfillment || fulfillment.status === 'cancelled') {
    const { icon: Icon, label } = STATE_CONFIG.not_required
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card/50 px-4 py-3 text-sm text-muted-foreground">
        <Icon className="h-4 w-4 shrink-0" />
        <span>Sponsorship agreement: {label}</span>
      </div>
    )
  }

  const { data: signatures } = await supabase
    .from('agreement_signatures')
    .select('id, signer_role')
    .eq('submission_id', submissionId)

  const sponsorSig = signatures?.find((s) => s.signer_role === 'sponsor')
  const coachSig = signatures?.find((s) => s.signer_role === 'coach')

  let state: AgreementState = 'awaiting_sponsor'
  if (sponsorSig && coachSig) state = 'executed'
  else if (sponsorSig) state = 'awaiting_coach'

  const { icon: Icon, label } = STATE_CONFIG[state]

  const signPath =
    viewerRole === 'sponsor' ? `/sponsor/submissions/${submissionId}/sign` : `/submissions/${submissionId}/sign`
  const canSignNow =
    (viewerRole === 'sponsor' && state === 'awaiting_sponsor') ||
    (viewerRole === 'coach' && state === 'awaiting_coach')

  const ownSignatureId = viewerRole === 'sponsor' ? sponsorSig?.id : coachSig?.id
  const viewableSignatureId = ownSignatureId ?? sponsorSig?.id ?? coachSig?.id
  const canViewRecord = !canSignNow && viewableSignatureId && (state === 'executed' || ownSignatureId)

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card/50 px-4 py-3 text-sm">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 shrink-0" />
        <span>Sponsorship agreement: {label}</span>
      </div>
      {canSignNow && (
        <Link href={signPath} className="font-medium text-primary underline-offset-4 hover:underline">
          Sign now
        </Link>
      )}
      {canViewRecord && (
        <Link
          href={`/agreement-records/${viewableSignatureId}`}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          View record
        </Link>
      )}
    </div>
  )
}
