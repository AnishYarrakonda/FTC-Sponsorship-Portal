import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getAuthedProfile } from '@/lib/actions-utils'
import { BackButton } from '@/components/ui/back-button'
import { EmptyState } from '@/components/ui/empty-state'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent } from '@/components/ui/card'
import { buttonVariants } from '@/components/ui/button'
import { FileSignature, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { prepareAgreementForSigning } from '@/app/actions/agreements-sign'
import { SigningPanel } from '@/components/agreements/signing-panel'

export default async function SponsorSignAgreementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const authed = await getAuthedProfile()
  if (!authed) redirect('/login')
  const { supabase, user } = authed

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, sponsor_id')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'sponsor' || !profile.sponsor_id) {
    redirect('/dashboard')
  }

  const result = await prepareAgreementForSigning({ submissionId: id })
  if (result.error === 'unauthorized') notFound()

  return (
    <div className="container mx-auto max-w-3xl space-y-6 py-10">
      <BackButton fallbackHref={`/sponsor/submissions/${id}`} label="Back to pitch" />

      {result.alreadySigned && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-500" />
            <h1 className="text-xl font-semibold">You already signed this agreement</h1>
            <p className="text-sm text-muted-foreground">
              You can review the full signed record at any time.
            </p>
            {result.signatureId && (
              <Link href={`/agreement-records/${result.signatureId}`} className={cn(buttonVariants())}>
                View signed record
              </Link>
            )}
          </CardContent>
        </Card>
      )}

      {!result.alreadySigned && result.error === 'not_applicable' && (
        <EmptyState
          icon={FileSignature}
          title="Nothing to sign yet"
          description="This submission does not have an active funding commitment that requires a signed agreement."
          action={
            <Link href={`/sponsor/submissions/${id}`} className={cn(buttonVariants({ variant: 'outline' }))}>
              Back to pitch
            </Link>
          }
        />
      )}

      {!result.alreadySigned && result.error && result.error !== 'not_applicable' && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Can&apos;t sign this document right now</AlertTitle>
          <AlertDescription>{result.error}</AlertDescription>
        </Alert>
      )}

      {!result.alreadySigned && result.document && <SigningPanel submissionId={id} document={result.document} />}
    </div>
  )
}
