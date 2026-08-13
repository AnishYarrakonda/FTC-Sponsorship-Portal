import { clerkClient } from '@clerk/nextjs/server'
import { SPONSOR_PREVIEW } from '@/lib/dev-preview'

/**
 * Read-only view of a sponsor organization's enterprise SSO configuration (prompt 10).
 *
 * Everything here lives in Clerk — enterprise connections are configured by us in the
 * Clerk dashboard together with the sponsor's IdP admin (see
 * docs/enterprise-sso-runbook.md). This module only *reports* that state so the sponsor
 * settings page can show it; there is deliberately no self-serve write path, and nothing
 * in it is ever used for authorization. Roles come from sponsor_members, always.
 */

export type SsoDomain = {
  name: string
  verified: boolean
  /** Clerk enrollment mode — 'automatic_invitation' / 'automatic_suggestion' / 'manual_invitation'. */
  enrollmentMode: string | null
}

export type SponsorSsoStatus =
  /** The sponsor has no Clerk Organization yet (org creation failed at approval time). */
  | { state: 'no_org' }
  /** Clerk could not be reached, or the plan does not include Enterprise Connections. */
  | { state: 'unavailable' }
  /** Org exists, no enterprise connection is attached to it. */
  | { state: 'not_configured' }
  /** A connection exists but is inactive or no domain has passed DNS verification yet. */
  | { state: 'pending'; connectionName: string | null; domains: SsoDomain[] }
  /** Active connection with at least one verified domain. */
  | { state: 'active'; connectionName: string | null; provider: string; domains: SsoDomain[] }

/**
 * Never throws. A Clerk outage or a plan that lacks Enterprise Connections must not take
 * the settings page down — it degrades to `unavailable`.
 */
export async function getSponsorSsoStatus(clerkOrgId: string | null): Promise<SponsorSsoStatus> {
  if (!clerkOrgId) return { state: 'no_org' }
  // Preview mode has no Clerk credentials; report the real-world default so the panel is
  // still exercisable with `npm run dev:sponsor-preview`.
  if (SPONSOR_PREVIEW) return { state: 'not_configured' }

  try {
    const clerk = await clerkClient()
    const [connectionList, domainList] = await Promise.all([
      clerk.enterpriseConnections.getEnterpriseConnectionList({ organizationId: clerkOrgId }),
      clerk.organizations.getOrganizationDomainList({ organizationId: clerkOrgId }),
    ])

    // Defense in depth against an instance-wide connection leaking into another org's
    // panel: keep only connections Clerk reports as scoped to THIS organization.
    const connections = connectionList.data.filter((c) => c.organizationId === clerkOrgId)
    if (connections.length === 0) return { state: 'not_configured' }

    const connection = connections.find((c) => c.active) ?? connections[0]
    const connectionDomains = new Set((connection.domains ?? []).map((d) => d.toLowerCase()))

    const domains: SsoDomain[] = domainList.data
      .filter((d) => connectionDomains.size === 0 || connectionDomains.has(d.name.toLowerCase()))
      .map((d) => ({
        name: d.name,
        verified: d.verification?.status === 'verified',
        enrollmentMode: d.enrollmentMode ?? null,
      }))

    // A connection domain Clerk has no organization-domain row for is still worth showing
    // — it is exactly the "waiting on the sponsor's DNS TXT record" state.
    for (const name of connectionDomains) {
      if (!domains.some((d) => d.name.toLowerCase() === name)) {
        domains.push({ name, verified: false, enrollmentMode: null })
      }
    }

    if (connection.active && domains.some((d) => d.verified)) {
      return {
        state: 'active',
        connectionName: connection.name ?? null,
        provider: connection.samlConnection ? 'SAML' : connection.oauthConfig ? 'OIDC' : 'Enterprise',
        domains,
      }
    }

    return { state: 'pending', connectionName: connection.name ?? null, domains }
  } catch (err) {
    // 403 on a plan without Enterprise Connections, 401 on a bad key, network errors —
    // all indistinguishable to the sponsor and all mean "we cannot say".
    console.warn('[sso] could not read enterprise connections for', clerkOrgId, err)
    return { state: 'unavailable' }
  }
}
