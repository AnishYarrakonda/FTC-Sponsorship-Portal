import { createAdminClient } from '@/lib/supabase/admin'
import { SUPPORT_EMAIL } from '@/lib/site-config'
import { emailDomain } from '@/lib/email-domain'
import * as Sentry from '@sentry/nextjs'

/**
 * Corporate email domain gate — SPONSOR PATH ONLY.
 *
 * ⚠️ SCOPE FENCE. Coaches are unpaid volunteers and a very large share of them will
 * legitimately sign up with a personal Gmail, Yahoo, or school-district address. This
 * module must never be imported by `provisionCoachProfile`, `createCoachProfile`, or
 * `completeCoachProfile` — not behind a flag, not "for logging". A Playwright test
 * (tests/e2e/sponsor-domain-gating.spec.ts) pins that a coach can sign up with gmail.com.
 *
 * The lists live in the `email_domain_rules` table rather than in code so an admin can
 * allowlist a small business or family foundation without a deploy, and so the whole gate
 * can be turned off with `DELETE FROM email_domain_rules WHERE rule = 'block'`.
 *
 * Reads go through the ADMIN client: `email_domain_rules` has an admin-only SELECT policy
 * and no write policy at all, and this check runs for a caller who could never satisfy
 * `is_admin()`.
 */

export type DomainGateVerdict =
  | { allowed: true; reason: 'allowlisted' | 'corporate' }
  | { allowed: false; reason: 'consumer' | 'disposable'; message: string }

/**
 * The rejection copy. Non-insulting, actionable, and it deliberately does not imply the
 * applicant is a bot or a liar — plenty of real small businesses and family foundations
 * have no domain of their own.
 */
function rejectionMessage(): string {
  return (
    `Sponsor accounts need a company email address — one at your organization's own domain. ` +
    `If your organization doesn't have one (small businesses and family foundations often ` +
    `don't), email us at ${SUPPORT_EMAIL} and we'll set your account up manually.`
  )
}

export async function checkSponsorEmailDomain(email: string): Promise<DomainGateVerdict> {
  const domain = emailDomain(email)
  // An unparseable address never reaches here in practice (Zod + Clerk both validate it),
  // and refusing one on domain grounds would be the wrong error message anyway.
  if (!domain) return { allowed: true, reason: 'corporate' }

  try {
    const adminClient = createAdminClient()
    const { data, error } = await adminClient
      .from('email_domain_rules')
      .select('domain, rule, category')
      .eq('domain', domain)
      .maybeSingle()

    if (error) {
      // FAIL OPEN, and loudly. Mirrors the throttle's documented posture in
      // createSponsorApplication: a database hiccup must not close the only
      // sponsor-acquisition funnel the product has. console.error as well as Sentry,
      // because Sentry has no DSN in any Vercel environment today — a Sentry-only report
      // would make this fail open completely silently.
      const err = new Error(
        `[checkSponsorEmailDomain] email_domain_rules lookup failed (failing OPEN): ${error.message}`
      )
      console.error(err.message, error)
      Sentry.captureException(err)
      return { allowed: true, reason: 'corporate' }
    }

    // ALLOW ALWAYS BEATS BLOCK. `domain` is the primary key so both rows cannot coexist,
    // but this is an explicit early return rather than an accident of query order because
    // it is what the admin UI copy promises.
    if (data?.rule === 'allow') return { allowed: true, reason: 'allowlisted' }

    if (data?.rule === 'block') {
      return {
        allowed: false,
        reason: data.category === 'disposable' ? 'disposable' : 'consumer',
        message: rejectionMessage(),
      }
    }

    return { allowed: true, reason: 'corporate' }
  } catch (e) {
    console.error('[checkSponsorEmailDomain] threw (failing OPEN)', e)
    Sentry.captureException(e)
    return { allowed: true, reason: 'corporate' }
  }
}
