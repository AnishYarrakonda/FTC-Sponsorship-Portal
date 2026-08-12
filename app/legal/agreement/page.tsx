import type { Metadata } from 'next'
import { BackButton } from '@/components/ui/back-button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Info } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { renderAgreement } from '@/lib/agreements/render'
import { exampleMergeContext } from '@/lib/agreements/merge-fields'

export const metadata: Metadata = {
  title: 'Sponsorship Agreement (Specimen)',
  description: 'A specimen of the Sponsorship Agreement executed between a sponsor and a team.',
}

export default async function AgreementSpecimenPage() {
  // Server component reading through the admin client with a hard-scoped, no-user-input
  // filter — the crossing (public read of an admin-only table) is routed through the
  // admin client rather than loosening RLS (house rule 9).
  const adminClient = createAdminClient()
  const { data: template } = await adminClient
    .from('agreement_templates')
    .select('title, body, updated_at')
    .eq('key', 'sponsorship_agreement')
    .eq('status', 'effective')
    .maybeSingle()

  return (
    <div className="container mx-auto max-w-3xl py-12 space-y-8">
      <BackButton />

      <div>
        <h1 className="text-3xl font-bold">Sponsorship Agreement — Specimen</h1>
      </div>

      {!template ? (
        <p className="text-muted-foreground">
          No Sponsorship Agreement has been published yet. Check back once a sponsorship has been
          finalized.
        </p>
      ) : (
        <>
          <Alert>
            <Info />
            <AlertTitle>Specimen document</AlertTitle>
            <AlertDescription>
              The merge fields below show example values. This is not a binding document — the
              binding document is the one generated and signed for a specific sponsorship.
            </AlertDescription>
          </Alert>

          <div
            className="prose prose-invert"
            dangerouslySetInnerHTML={{ __html: renderAgreement(template.body, exampleMergeContext()).html }}
          />
        </>
      )}
    </div>
  )
}
