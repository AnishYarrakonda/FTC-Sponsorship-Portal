import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AgreementEditor } from '@/components/admin/agreement-editor'
import { AgreementNewVersionButton } from '@/components/admin/agreement-new-version-button'
import { AGREEMENT_TEMPLATE_KEYS, AGREEMENT_TEMPLATE_LABELS, type AgreementTemplateKey } from '@/lib/schemas/agreement'

function isAgreementKey(key: string): key is AgreementTemplateKey {
  return (AGREEMENT_TEMPLATE_KEYS as readonly string[]).includes(key)
}

export default async function AgreementEditPage({
  params,
}: {
  params: Promise<{ key: string }>
}) {
  const { key } = await params
  if (!isAgreementKey(key)) notFound()

  const supabase = await createClient()
  const { data: versions } = await supabase
    .from('agreement_templates')
    .select('id, version, title, body, consent_text, status')
    .eq('key', key)
    .order('version', { ascending: false })

  const rows = versions ?? []
  const draft = rows.find((v) => v.status === 'draft')
  const latest = rows[0]

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={`Edit — ${AGREEMENT_TEMPLATE_LABELS[key]}`} />

      {draft ? (
        <AgreementEditor
          mode="edit"
          templateKey={key}
          draftId={draft.id}
          initialTitle={draft.title}
          initialBody={draft.body}
          initialConsentText={draft.consent_text}
        />
      ) : latest ? (
        <Card>
          <CardHeader>
            <CardTitle>v{latest.version} ({latest.status}) — read only</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This document has no open draft. The current version is {latest.status} and cannot
              be edited directly — create a new version to make changes.
            </p>
            <pre className="max-h-96 overflow-auto rounded-md border border-border bg-muted/20 p-3 text-xs whitespace-pre-wrap">
              {latest.body}
            </pre>
            <AgreementNewVersionButton
              templateKey={key}
              title={latest.title}
              body={latest.body}
              consentText={latest.consent_text}
            />
          </CardContent>
        </Card>
      ) : (
        <AgreementEditor mode="create" templateKey={key} />
      )}
    </div>
  )
}
