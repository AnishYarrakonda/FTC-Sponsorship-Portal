/**
 * Pure domain-comparison helpers for the sponsor application path.
 *
 * No network, no database, no `server-only` — this module is deliberately pure so it can
 * be unit-tested in isolation (lib/__tests__/email-domain.test.ts), the same idiom as
 * lib/team-slug.ts and lib/recognition.ts.
 *
 * ⚠️ THE OUTPUT OF `compareDomains` IS A WARNING SHOWN TO A HUMAN REVIEWER, NEVER A GATE.
 * Nothing in this file may become an auto-rejection. That is why the public-suffix
 * handling below is allowed to be approximate — see the comment on MULTI_PART_SUFFIXES.
 */

/**
 * Known multi-part public suffixes.
 *
 * Correctly reducing `acme.co.uk` to an apex needs the full Public Suffix List, which is
 * a dependency plus a data file that goes stale. We deliberately do not add one. Instead
 * we compare the last two labels by default and the last three when the last two appear
 * here. This is imperfect: a suffix missing from this list makes two unrelated companies
 * on the same ccTLD look `related` instead of `mismatch`.
 *
 * That is ACCEPTABLE and must stay acceptable: the worst outcome of a wrong answer is a
 * missing (or spurious) advisory badge on an admin review card. Do NOT "fix" this into a
 * hard rule, and do NOT wire it into anything that can refuse an application.
 */
const MULTI_PART_SUFFIXES = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'com.au',
  'co.nz',
  'co.jp',
  'com.br',
  'co.za',
  'com.mx',
])

/** A bare hostname: labels of [a-z0-9-] plus an alphabetic TLD of 2+ characters. */
const HOST_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/

/**
 * IDNA/punycode normalization (A-10-01).
 *
 * `HOST_RE` is ASCII-only, so any non-ASCII host used to fail it and `normalizeHost`
 * returned null — and `checkSponsorEmailDomain` treats a null domain as
 * `{ allowed: true, reason: 'corporate' }`. Non-ASCII therefore did not bypass the
 * blocklist by impersonating an entry; it bypassed it by never being looked up at all.
 *
 * The case that actually matters is NOT the Cyrillic lookalike the audit cited — that
 * maps to a distinct domain (`xn--gmil-63d.com`) an attacker would have to register and
 * run mail for. It is **full-width and other compatibility Latin**: `ｇmail.com`
 * (U+FF47) IDNA-maps to literally `gmail.com`. Same domain, same mailbox, and the
 * blocklist never saw it.
 *
 * `new URL()` implements UTS-46 for us, which is why there is no punycode dependency
 * here. It also lowercases, strips a trailing dot, and rejects structurally invalid
 * hosts — so it subsumes most of what this function did by hand.
 */
function toAsciiHost(raw: string): string | null {
  try {
    const { hostname } = new URL(`http://${raw}`)
    return hostname || null
  } catch {
    return null
  }
}

function normalizeHost(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase().replace(/\.+$/, '')
  if (!trimmed) return null
  // A host with a slash, space, or userinfo is not a host. Reject before URL() gets a
  // chance to reinterpret it as a path and hand back something that looks valid.
  if (/[/\\?#@\s]/.test(trimmed)) return null
  const host = toAsciiHost(trimmed)
  if (!host) return null
  return HOST_RE.test(host) ? host : null
}

/**
 * Does this host contain an internationalized (punycode) label?
 *
 * Advisory only, in keeping with this module's rule that nothing here may auto-reject.
 * A punycode host is not illegitimate — plenty of real companies have one — but a
 * sponsor applying from one is worth a human reviewer's attention, because homograph
 * registration is cheap and the admin card is where the impersonation would land.
 */
export function isInternationalizedHost(host: string | null | undefined): boolean {
  if (!host) return false
  return host.split('.').some((label) => label.startsWith('xn--'))
}

/** Lowercased apex domain from an email address, or null if unparseable. */
export function emailDomain(email: string): string | null {
  if (typeof email !== 'string') return null
  // Strip a +tag from the local part before splitting, so a tagged address and its
  // untagged twin resolve identically ("Jane+ftc@Acme.COM" -> "acme.com").
  const trimmed = email.trim().replace(/\+[^@]*(?=@)/, '')
  const at = trimmed.lastIndexOf('@')
  if (at < 1) return null
  return normalizeHost(trimmed.slice(at + 1))
}

/**
 * Lowercased apex host from a URL or a bare host
 * ("https://www.acme.co.uk/x?y=1" -> "acme.co.uk").
 *
 * The scheme is optional on purpose: `sponsorSignupSchema.website` only requires the
 * string to contain a `.`, so `acme.com` with no `https://` is valid user input.
 */
export function websiteDomain(raw: string): string | null {
  if (typeof raw !== 'string') return null
  let host = raw.trim().toLowerCase()
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, '') // scheme
  host = host.split(/[/?#]/)[0] ?? ''                // path / query / fragment
  host = host.split('@').pop() ?? ''                 // userinfo
  host = host.split(':')[0] ?? ''                    // port
  host = host.replace(/^www\./, '')
  return normalizeHost(host)
}

/** Last two labels, or last three when the last two are a known multi-part suffix. */
function apex(host: string): string {
  const labels = host.split('.')
  if (labels.length <= 2) return host
  const lastTwo = labels.slice(-2).join('.')
  if (MULTI_PART_SUFFIXES.has(lastTwo) && labels.length >= 3) {
    return labels.slice(-3).join('.')
  }
  return lastTwo
}

/** Lowercase alphanumerics only — "Acme Corp, Inc." -> "acmecorpinc". */
function squash(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export type DomainComparison = 'match' | 'related' | 'mismatch' | 'unknown'

/**
 * Compare an applicant's email host against the website host they supplied.
 *
 * | Result     | When                                                                    |
 * |------------|-------------------------------------------------------------------------|
 * | `match`    | The two hosts are equal after normalization.                            |
 * | `related`  | One is a subdomain of the other, they share an apex, or the email host's |
 * |            | first label appears in the company name (`jane@acme-corp.com`/`acme.com`)|
 * | `mismatch` | Both present, none of the above.                                        |
 * | `unknown`  | Either side is null/unparseable.                                        |
 *
 * `companyName` is optional; without it the name heuristic is simply skipped.
 */
export function compareDomains(
  emailHost: string | null,
  siteHost: string | null,
  companyName?: string | null
): DomainComparison {
  if (!emailHost || !siteHost) return 'unknown'

  const e = emailHost.trim().toLowerCase()
  const s = siteHost.trim().toLowerCase()
  if (!e || !s) return 'unknown'

  if (e === s) return 'match'
  if (e.endsWith(`.${s}`) || s.endsWith(`.${e}`)) return 'related'
  // Same registrable domain seen from two different subdomains (mail.acme.com / shop.acme.com).
  // apex() is where MULTI_PART_SUFFIXES earns its keep: without it `acme.co.uk` and
  // `other.co.uk` would both reduce to `co.uk` and read as related.
  if (apex(e) === apex(s)) return 'related'

  if (companyName) {
    const label = squash(e.split('.')[0] ?? '')
    const name = squash(companyName)
    // Guard against 3-char noise: "it.com" should not match "Digital IT Services".
    if (label.length >= 4 && name.length >= 4 && name.includes(label)) return 'related'
  }

  return 'mismatch'
}
