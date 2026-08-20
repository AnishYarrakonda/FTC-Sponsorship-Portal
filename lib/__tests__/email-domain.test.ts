import { describe, it, expect } from 'vitest'
import { emailDomain, websiteDomain, compareDomains } from '@/lib/email-domain'

describe('emailDomain', () => {
  it('lowercases, trims, and strips a +tag', () => {
    expect(emailDomain('Jane+ftc@Acme.COM')).toBe('acme.com')
    expect(emailDomain('  jane@acme.com  ')).toBe('acme.com')
  })

  it('returns null for anything that is not an address', () => {
    expect(emailDomain('not-an-email')).toBeNull()
    expect(emailDomain('jane@')).toBeNull()
    expect(emailDomain('@acme.com')).toBeNull()
    expect(emailDomain('jane@localhost')).toBeNull()
    expect(emailDomain('')).toBeNull()
  })
})

describe('websiteDomain', () => {
  it('strips scheme, www, path, query and port', () => {
    expect(websiteDomain('https://www.acme.com/careers?x=1')).toBe('acme.com')
    expect(websiteDomain('http://acme.com:8080/#top')).toBe('acme.com')
  })

  it('tolerates a missing scheme — the signup schema permits a bare host', () => {
    expect(websiteDomain('acme.com')).toBe('acme.com')
    expect(websiteDomain('WWW.Acme.CO.UK')).toBe('acme.co.uk')
  })

  it('returns null for unparseable input', () => {
    expect(websiteDomain('not a website')).toBeNull()
    expect(websiteDomain('')).toBeNull()
  })
})

describe('compareDomains', () => {
  it('reports an exact hit as match', () => {
    expect(compareDomains('acme.com', 'acme.com')).toBe('match')
  })

  it('reports a subdomain as related', () => {
    expect(compareDomains('mail.acme.com', 'acme.com')).toBe('related')
    expect(compareDomains('acme.com', 'careers.acme.com')).toBe('related')
  })

  it('reports two subdomains of the same apex as related', () => {
    expect(compareDomains('mail.acme.com', 'shop.acme.com')).toBe('related')
  })

  it('handles multi-part public suffixes', () => {
    // Proves the suffix list is reachable and did not collapse to `co.uk`.
    expect(compareDomains('acme.co.uk', 'acme.co.uk')).toBe('match')
    // The real proof: two UNRELATED companies on the same ccTLD must not read as related.
    // Without MULTI_PART_SUFFIXES both apexes would reduce to `co.uk`.
    expect(compareDomains('acme.co.uk', 'other.co.uk')).toBe('mismatch')
  })

  it('reports an unrelated host as mismatch', () => {
    expect(compareDomains('gmail.com', 'acme.com')).toBe('mismatch')
  })

  it('uses the company name to catch a hyphenated variant', () => {
    expect(compareDomains('acme-corp.com', 'acme.com', 'Acme Corp')).toBe('related')
    // …but not on 3-character noise, and not without the name.
    expect(compareDomains('acme-corp.com', 'acme.com')).toBe('mismatch')
    expect(compareDomains('it.com', 'acme.com', 'Digital IT Services')).toBe('mismatch')
  })

  it('reports unknown when either side is missing', () => {
    expect(compareDomains(null, 'acme.com')).toBe('unknown')
    expect(compareDomains('acme.com', null)).toBe('unknown')
    expect(compareDomains(null, null)).toBe('unknown')
  })
})
