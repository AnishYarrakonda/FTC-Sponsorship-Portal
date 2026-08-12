import { redirect, notFound } from 'next/navigation'
import { getAuthedProfile } from '@/lib/actions-utils'
import { getExecutedAgreement } from '@/app/actions/agreements-sign'
import { SignatureAuditTrail } from '@/components/agreements/signature-audit-trail'
import { BackButton } from '@/components/ui/back-button'

// Top-level authenticated route — deliberately NOT under (account), whose layout
// redirects verified coaches and active sponsors away and so cannot host a page both
// roles need. Not added to isPublicRoute in middleware.ts: the default
// unauthenticated -> /login behaviour is correct here.
//
// NOTE: prompts/06-esign-capture-flow.md specifies this page at `/agreements/[signatureId]`,
// but prompt 05 (already shipped on this branch) owns `/agreements/[key]` for the admin
// template manager (app/(admin)/agreements/[key]/page.tsx). Route groups strip out of the
// URL, so both would resolve to the identical `/agreements/:param` pattern with different
// dynamic-segment names — Next.js hard-fails the build on that. Renamed to
// `/agreement-records/[signatureId]` to avoid the collision (user-confirmed).
export const metadata = {
  title: 'Executed Agreement | FTC Pitfund',
}

export default async function AgreementRecordPage({
  params,
}: {
  params: Promise<{ signatureId: string }>
}) {
  const { signatureId } = await params
  const authed = await getAuthedProfile()
  if (!authed) redirect('/login')

  // getExecutedAgreement reads through the caller's RLS-respecting client, so a
  // non-party — or a signature that does not exist — both collapse to the same
  // "not found" outcome here, deliberately undistinguished.
  const result = await getExecutedAgreement({ signatureId })
  if (!result.signatures || result.signatures.length === 0) {
    notFound()
  }

  return (
    <div className="container mx-auto max-w-3xl space-y-6 py-10">
      <BackButton fallbackHref="/dashboard" />

      <div>
        <h1 className="text-2xl font-bold">Executed Sponsorship Agreement</h1>
        <p className="text-sm text-muted-foreground">
          The complete signing record for this agreement, including both signatures.
        </p>
      </div>

      <SignatureAuditTrail signatures={result.signatures} />
    </div>
  )
}
