'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Copy, Check, ShieldCheck, Download } from 'lucide-react'
import type { RetrievedSignature } from '@/lib/agreements/provider'

function CopyHashButton({ hash }: { hash: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(hash)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Copied' : 'Copy hash'}
    </Button>
  )
}

function formatUtc(iso: string): string {
  return `${new Date(iso).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')}`
}

export function SignatureAuditTrail({ signatures }: { signatures: RetrievedSignature[] }) {
  return (
    <div className="space-y-6">
      {signatures.map((sig) => (
        <Card key={sig.signatureId}>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base capitalize">{sig.signerRole} signature</CardTitle>
            <Badge variant="outline">
              {sig.templateKey} v{sig.templateVersion}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Signer legal name</dt>
                <dd className="font-medium">{sig.signerLegalName}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Typed name</dt>
                <dd className="font-medium">{sig.typedName}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Signer email</dt>
                <dd className="font-medium">{sig.signerEmail}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Signed (UTC)</dt>
                <dd className="font-medium">{formatUtc(sig.signedAt)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">IP address</dt>
                <dd className="font-mono text-xs">{sig.ipAddress}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Browser / user agent</dt>
                <dd className="break-all text-xs">{sig.userAgent}</dd>
              </div>
            </dl>

            <div className="space-y-1.5 rounded-md border border-border bg-card/50 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">SHA-256 document fingerprint</span>
                <CopyHashButton hash={sig.documentHash} />
              </div>
              <p className="break-all font-mono text-xs">{sig.documentHash}</p>
            </div>

            <a
              href={sig.documentUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              <Download className="h-3.5 w-3.5" />
              Download executed document
            </a>
            <p className="text-xs text-muted-foreground">This download link expires in 30 minutes.</p>
          </CardContent>
        </Card>
      ))}

      <Alert>
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>Verify this record</AlertTitle>
        <AlertDescription>
          The SHA-256 fingerprint above is a cryptographic checksum of the exact bytes each
          signer saw and typed their name against. To verify a downloaded document matches
          the record, run{' '}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
            shasum -a 256 &lt;downloaded file&gt;
          </code>{' '}
          and confirm the output equals the fingerprint shown above for that signature.
        </AlertDescription>
      </Alert>
    </div>
  )
}
