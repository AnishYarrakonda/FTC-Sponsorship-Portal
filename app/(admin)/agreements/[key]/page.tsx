import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AgreementVersionDiff } from '@/components/admin/agreement-version-diff'
import { diffLines } from '@/lib/agreements/diff'
import { AGREEMENT_TEMPLATE_KEYS, AGREEMENT_TEMPLATE_LABELS, type AgreementTemplateKey } from '@/lib/schemas/agreement'

function isAgreementKey(key: string): key is AgreementTemplateKey {
  return (AGREEMENT_TEMPLATE_KEYS as readonly string[]).includes(key)
}

export default async function AgreementDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const { key } = await params
  if (!isAgreementKey(key)) notFound()

  const { from, to } = await searchParams

  const supabase = await createClient()
  const { data: versions } = await supabase
    .from('agreement_templates')
    .select('id, version, title, status, needs_legal_review, effective_from, retired_at, created_at, updated_at, body')
    .eq('key', key)
    .order('version', { ascending: false })

  const rows = versions ?? []
  const draft = rows.find((v) => v.status === 'draft')

  const fromVersion = from ? rows.find((v) => String(v.version) === from) : undefined
  const toVersion = to ? rows.find((v) => String(v.version) === to) : undefined
  const diffOps = fromVersion && toVersion ? diffLines(fromVersion.body, toVersion.body) : null

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={AGREEMENT_TEMPLATE_LABELS[key]}
        subtitle="Version history. Select two versions below to see a line diff."
        action={
          <Link href={`/agreements/${key}/edit`}>
            <Button size="sm">{draft ? 'Edit draft' : 'New draft'}</Button>
          </Link>
        }
      />

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No version of this document exists yet.</p>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="grid grid-cols-5 gap-4 px-4 py-3 border-b border-border bg-muted/30 text-xs font-medium text-muted-foreground">
            <span>Version</span>
            <span>Status</span>
            <span>Title</span>
            <span>Dates</span>
            <span>Compare</span>
          </div>
          {rows.map((v) => (
            <div key={v.id} className="grid grid-cols-5 gap-4 px-4 py-3 border-b border-border last:border-0 items-center text-sm">
              <span className="font-mono">v{v.version}</span>
              <span>
                <Badge variant={v.status === 'effective' ? 'approved' : v.status === 'draft' ? 'draft' : 'locked'}>
                  {v.status}
                </Badge>
                {v.status === 'effective' && v.needs_legal_review && (
                  <Badge variant="needs-revision" className="ml-1">legal review</Badge>
                )}
              </span>
              <span className="truncate">{v.title}</span>
              <span className="text-xs text-muted-foreground">
                {v.effective_from && <>effective {new Date(v.effective_from).toLocaleDateString()}<br /></>}
                {v.retired_at && <>retired {new Date(v.retired_at).toLocaleDateString()}</>}
              </span>
              <span className="flex gap-1">
                <Link href={`/agreements/${key}?from=${v.version}&to=${to ?? v.version}`}>
                  <Button size="sm" variant="ghost">From</Button>
                </Link>
                <Link href={`/agreements/${key}?from=${from ?? v.version}&to=${v.version}`}>
                  <Button size="sm" variant="ghost">To</Button>
                </Link>
              </span>
            </div>
          ))}
        </div>
      )}

      {diffOps && (
        <Card>
          <CardHeader>
            <CardTitle>
              Diff: v{fromVersion!.version} → v{toVersion!.version}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <AgreementVersionDiff ops={diffOps} />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
