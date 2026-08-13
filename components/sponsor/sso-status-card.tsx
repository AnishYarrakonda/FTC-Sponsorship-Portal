import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ShieldCheck, Clock, Building2, AlertTriangle } from 'lucide-react'
import type { SponsorSsoStatus } from '@/lib/sso'

const SUPPORT_EMAIL = 'support@ftcpitfund.org'

/**
 * Read-only. Enterprise connections need a human on both sides (our team and the
 * sponsor's IdP admin), so there is no self-serve flow here by design — see
 * docs/enterprise-sso-runbook.md.
 */
export function SsoStatusCard({ status }: { status: SponsorSsoStatus }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Single sign-on</CardTitle>
            <CardDescription>
              Let your employees sign in with your company identity provider (Okta, Microsoft Entra ID, or any
              SAML/OIDC provider).
            </CardDescription>
          </div>
          <StatusBadge status={status} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {status.state === 'active' && (
          <>
            <p className="text-muted-foreground">
              {status.provider} sign-on is active
              {status.connectionName ? ` via ${status.connectionName}` : ''}. Anyone with a verified company email
              below is sent to your identity provider to sign in.
            </p>
            <DomainList domains={status.domains} />
            <p className="text-xs text-muted-foreground">
              New employees who sign in this way join with the <strong>Viewer</strong> role and see nothing until an
              admin on your team promotes them. Removing someone in your identity provider removes their access here.
            </p>
          </>
        )}

        {status.state === 'pending' && (
          <>
            <p className="text-muted-foreground">
              A connection{status.connectionName ? ` (${status.connectionName})` : ''} has been created for your
              organization but is not live yet — your IT team still needs to publish the DNS TXT record we sent them,
              or the connection is switched off.
            </p>
            <DomainList domains={status.domains} />
            <Alert>
              <AlertDescription>
                Email <a className="underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> if you need the
                verification record re-sent.
              </AlertDescription>
            </Alert>
          </>
        )}

        {status.state === 'not_configured' && (
          <>
            <p className="text-muted-foreground">
              Your team signs in with an email address and password today. We can connect your identity provider
              instead, so access is granted and revoked by your IT department.
            </p>
            <Alert>
              <AlertDescription>
                Contact us at <a className="underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> to set up
                single sign-on. Setup takes about an hour with your IdP administrator.
              </AlertDescription>
            </Alert>
          </>
        )}

        {status.state === 'no_org' && (
          <p className="text-muted-foreground">
            Your company workspace is still being provisioned. Single sign-on becomes available once that finishes —
            contact <a className="underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> if this persists.
          </p>
        )}

        {status.state === 'unavailable' && (
          <p className="text-muted-foreground">
            We could not load your single sign-on settings right now. Nothing is wrong with your account — refresh in a
            moment, or contact <a className="underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function StatusBadge({ status }: { status: SponsorSsoStatus }) {
  switch (status.state) {
    case 'active':
      return (
        <Badge variant="default" className="shrink-0 gap-1">
          <ShieldCheck className="h-3 w-3" aria-hidden /> Active
        </Badge>
      )
    case 'pending':
      return (
        <Badge variant="secondary" className="shrink-0 gap-1">
          <Clock className="h-3 w-3" aria-hidden /> Pending verification
        </Badge>
      )
    case 'unavailable':
      return (
        <Badge variant="outline" className="shrink-0 gap-1">
          <AlertTriangle className="h-3 w-3" aria-hidden /> Unavailable
        </Badge>
      )
    default:
      return (
        <Badge variant="outline" className="shrink-0 gap-1">
          <Building2 className="h-3 w-3" aria-hidden /> Not set up
        </Badge>
      )
  }
}

function DomainList({ domains }: { domains: { name: string; verified: boolean }[] }) {
  if (domains.length === 0) return null
  return (
    <ul className="space-y-1">
      {domains.map((d) => (
        <li key={d.name} className="flex items-center gap-2">
          <span className="font-mono text-xs">{d.name}</span>
          <span className={d.verified ? 'text-xs text-muted-foreground' : 'text-xs text-amber-600 dark:text-amber-500'}>
            {d.verified ? 'verified' : 'awaiting DNS verification'}
          </span>
        </li>
      ))}
    </ul>
  )
}
