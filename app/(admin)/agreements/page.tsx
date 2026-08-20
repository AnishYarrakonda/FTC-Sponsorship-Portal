import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AgreementLegalReviewBanner } from '@/components/admin/agreement-legal-review-banner'
import { AGREEMENT_TEMPLATE_KEYS, AGREEMENT_TEMPLATE_LABELS } from '@/lib/schemas/agreement'

export default async function AgreementsPage() {
  const supabase = await createClient()

  const { data: rows } = await supabase
    .from('agreement_templates')
    .select('id, key, version, title, status, needs_legal_review, effective_from, created_at')
    .order('version', { ascending: false })

  const byKey = new Map<string, typeof rows>()
  for (const key of AGREEMENT_TEMPLATE_KEYS) byKey.set(key, [])
  for (const row of rows ?? []) {
    byKey.get(row.key)?.push(row)
  }

  const reviewItems = (rows ?? [])
    .filter((r) => r.status === 'effective' && r.needs_legal_review)
    .map((r) => ({ id: r.id, title: r.title, version: r.version }))

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Agreements"
        subtitle="Versioned legal document templates: the sponsorship agreement, platform terms, and team participation agreement."
      />

      <AgreementLegalReviewBanner items={reviewItems} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {AGREEMENT_TEMPLATE_KEYS.map((key) => {
          const versions = byKey.get(key) ?? []
          const effective = versions.find((v) => v.status === 'effective')
          const draft = versions.find((v) => v.status === 'draft')

          return (
            <Card key={key}>
              <CardHeader>
                <CardTitle>{AGREEMENT_TEMPLATE_LABELS[key]}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {effective ? (
                  <div className="text-sm">
                    <span className="text-muted-foreground">Effective version:</span> v{effective.version}
                    {effective.effective_from && (
                      <span className="text-muted-foreground">
                        {' '}since {new Date(effective.effective_from).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No version of this document exists yet.</p>
                )}

                <div className="flex flex-wrap gap-2">
                  {draft && <Badge variant="draft">Draft in progress</Badge>}
                  {effective?.needs_legal_review && <Badge variant="needs-revision">Needs legal review</Badge>}
                </div>

                <Link href={`/agreements/${key}`}>
                  <Button size="sm" variant="outline">View</Button>
                </Link>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
