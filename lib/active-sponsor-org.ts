import { cookies } from 'next/headers'

/**
 * A-12-01. Which sponsor organisation the caller is currently acting as.
 *
 * BACKGROUND
 *
 * `sponsor_members` has always been a many-to-many table and `current_sponsor_ids()` has
 * always returned an ARRAY, so the database supported multi-org membership from the start.
 * What refused it was application code in two places — `inviteSponsorMember` and the
 * `organizationMembership.created` webhook — which rejected anyone already belonging to a
 * different org. With multi-org now a supported shape, the portal needs to know which of
 * a person's orgs a given request is about.
 *
 * THE SECURITY PROPERTY, WHICH IS THE WHOLE POINT OF THIS FILE
 *
 * The active org is stored in a cookie. A cookie is CALLER-CONTROLLED: anyone can set it
 * to any uuid. It is therefore treated as a *preference*, never as an authorization, and
 * `resolveActiveSponsorId` re-validates it against the caller's real memberships on every
 * single request. An unrecognised value silently falls back to the caller's default org
 * rather than erroring, because an error would let an attacker use the response to probe
 * which org ids exist.
 *
 * This is the same discipline as A-02-02: never trust a caller-supplied id to name the
 * principal. The cookie selects among ids the server already proved the caller holds; it
 * cannot introduce one.
 */

export const ACTIVE_SPONSOR_COOKIE = 'active_sponsor_id'

/**
 * Pick the org this request is about.
 *
 * @param sponsorIds The caller's REAL memberships, already resolved server-side.
 * @param fallback   The caller's default org (profiles.sponsor_id, or the first membership).
 */
export function pickActiveSponsorId(
  requested: string | null | undefined,
  sponsorIds: string[],
  fallback: string
): string {
  if (requested && sponsorIds.includes(requested)) return requested
  return fallback
}

/** Server-side convenience: read the cookie and validate it in one step. */
export async function resolveActiveSponsorId(
  sponsorIds: string[],
  fallback: string
): Promise<string> {
  const store = await cookies()
  return pickActiveSponsorId(store.get(ACTIVE_SPONSOR_COOKIE)?.value ?? null, sponsorIds, fallback)
}

/**
 * Cookie options. `httpOnly` is deliberate even though the value is not a secret: nothing
 * client-side needs to read it, and keeping it out of `document.cookie` means an injected
 * script cannot silently switch which org a signed-in admin is operating on.
 */
export const ACTIVE_SPONSOR_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 60 * 60 * 24 * 30,
}
