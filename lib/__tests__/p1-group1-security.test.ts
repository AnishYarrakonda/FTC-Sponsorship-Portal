/**
 * Regression cover for the Group 1 (security / RLS / money) P1 findings.
 *
 * Same discipline as p0-audit-regressions.test.ts: several of these were invisible
 * precisely because nothing asserted on them, so the assertions are written against the
 * property that was violated, not against the shape of the current implementation.
 *
 * The DB-side halves (A-02-02's actor gate, B-01-3's teams_update policy) are proved
 * against a real Postgres — see the migration headers for the before/after evidence.
 * What is pinned here is the source-level invariant that would silently regress in a
 * refactor: the guard call, the import, the queue call, the Sentry hook.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { emailDomain, websiteDomain, isInternationalizedHost } from '@/lib/email-domain'
import { scrubUrl, scrubBreadcrumb, scrubEvent, containsSecretUrl } from '@/lib/sentry-scrub'

const root = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

describe('A-10-01 — IDNA normalization closes the domain-gate bypass', () => {
  it('maps full-width Latin to the SAME ascii domain, so the blocklist sees it', () => {
    // This is the case that actually mattered, and it is not the one the audit cited.
    // U+FF47 FULLWIDTH LATIN SMALL LETTER G normalizes to a plain `g`, so `ｇmail.com`
    // IS gmail.com — same domain, same mailbox, and before the fix emailDomain() returned
    // null and checkSponsorEmailDomain treats null as { allowed: true }.
    expect(emailDomain('johndoe@ｇmail.com')).toBe('gmail.com')
  })

  it('maps a cyrillic lookalike to a DIFFERENT punycode domain rather than failing open', () => {
    // The audit's example. It is a weaker attack — an attacker must actually register
    // and run mail for xn--gmil-63d.com — but returning null (and therefore allowing)
    // was still wrong. Now it resolves to something a blocklist row can name.
    const d = emailDomain('johndoe@gmаil.com')
    expect(d).toBe('xn--gmil-63d.com')
    expect(d).not.toBe('gmail.com')
  })

  it('no longer fails open on a legitimate internationalized domain', () => {
    expect(emailDomain('hans@münchen.de')).toBe('xn--mnchen-3ya.de')
    expect(websiteDomain('münchen.de')).toBe('xn--mnchen-3ya.de')
  })

  it('flags punycode hosts for the human reviewer, and only punycode hosts', () => {
    expect(isInternationalizedHost('xn--mnchen-3ya.de')).toBe(true)
    expect(isInternationalizedHost('gmail.com')).toBe(false)
    expect(isInternationalizedHost(null)).toBe(false)
  })

  it('still rejects everything it rejected before', () => {
    for (const bad of ['not-an-email', 'jane@', '@acme.com', 'jane@localhost', '']) {
      expect(emailDomain(bad)).toBeNull()
    }
    // A host containing a path/space/userinfo must not be salvaged into something valid
    // by URL() reinterpreting it.
    expect(emailDomain('jane@acme.com/evil')).toBeNull()
    expect(emailDomain('jane@acme .com')).toBeNull()
  })

  it('keeps the existing normalizations intact', () => {
    expect(emailDomain('Jane+ftc@Acme.COM')).toBe('acme.com')
    expect(emailDomain('  jane@acme.com  ')).toBe('acme.com')
    expect(websiteDomain('https://www.acme.co.uk/x?y=1')).toBe('acme.co.uk')
  })

  it('surfaces the advisory on the admin application card', () => {
    const page = read('app/(admin)/applications/page.tsx')
    expect(page).toContain('isInternationalizedHost')
    // Advisory only — this module must never gain the power to auto-reject.
    expect(page).not.toMatch(/isInternationalizedHost[^)]*\)\s*\)?\s*(return|throw)/)
  })
})

describe('A-10-03 — sponsor tokens never reach Sentry', () => {
  const TOKEN_URL = 'https://app.example.com/sponsor-view/abc123LIVEtoken?x=1'

  it('redacts the token segment but keeps the route recognizable', () => {
    const out = scrubUrl(TOKEN_URL)
    expect(out).not.toContain('abc123LIVEtoken')
    expect(out).toContain('/sponsor-view/[redacted]')
    expect(out).toContain('x=1')
  })

  it('redacts bare paths too — breadcrumbs carry paths, not absolute URLs', () => {
    expect(scrubUrl('/sponsor-view/tok_live_999')).toBe('/sponsor-view/[redacted]')
  })

  it('redacts credential-bearing query params', () => {
    expect(scrubUrl('/x?token=secret&page=2')).toBe('/x?token=[redacted]&page=2')
    expect(scrubUrl('/x?__clerk_ticket=abc')).toBe('/x?__clerk_ticket=[redacted]')
    // A filter that merely looks like one must survive.
    expect(scrubUrl('/x?status=pending')).toBe('/x?status=pending')
  })

  it('leaves ordinary urls untouched', () => {
    expect(scrubUrl('/dashboard?tab=pitches')).toBe('/dashboard?tab=pitches')
    expect(containsSecretUrl('/dashboard')).toBe(false)
    expect(containsSecretUrl(TOKEN_URL)).toBe(true)
  })

  it('scrubs every breadcrumb field that can hold a url', () => {
    const b = scrubBreadcrumb({
      message: 'navigating to /sponsor-view/tok1',
      data: { url: '/sponsor-view/tok2', from: '/sponsor-view/tok3', to: '/dashboard' },
    })
    expect(JSON.stringify(b)).not.toMatch(/tok[123]/)
    expect(b.data?.to).toBe('/dashboard')
  })

  it('scrubs the event request url, transaction, referer and attached breadcrumbs', () => {
    const e = scrubEvent({
      transaction: '/sponsor-view/tokT',
      request: { url: TOKEN_URL, headers: { referer: '/sponsor-view/tokR' } },
      breadcrumbs: [{ data: { url: '/sponsor-view/tokB' } }, null],
    })
    const dumped = JSON.stringify(e)
    expect(dumped).not.toMatch(/tokT|tokR|tokB|abc123LIVEtoken/)
  })

  it('never throws — a scrubber that throws inside beforeSend drops the event', () => {
    expect(() => scrubEvent({})).not.toThrow()
    expect(() => scrubBreadcrumb({})).not.toThrow()
    expect(scrubUrl('')).toBe('')
  })

  it('is wired into BOTH sentry configs, not just one', () => {
    for (const f of ['instrumentation.ts', 'instrumentation-client.ts']) {
      const src = read(f)
      expect(src, f).toContain('beforeBreadcrumb')
      expect(src, f).toContain('beforeSend')
      expect(src, f).toContain('scrubEvent')
    }
  })
})

describe('A-10-02 — lookupFTCTeam is throttled, not just authenticated', () => {
  const src = read('app/actions/team.ts')

  it('calls check_throttle keyed on the clerk id', () => {
    expect(src).toMatch(/check_throttle[\s\S]{0,200}ftc-lookup:\$\{clerkUserId\}/)
  })

  it('throttles AFTER the auth guard and BEFORE the outbound lookup', () => {
    const auth = src.indexOf('await requireAuth()')
    const throttle = src.indexOf('ftc-lookup:')
    const outbound = src.indexOf('await lookupFTCTeamWithSource(')
    expect(auth).toBeGreaterThan(-1)
    expect(throttle).toBeGreaterThan(auth)
    expect(outbound).toBeGreaterThan(throttle)
  })
})

describe('B-01-3 — the coach_verified gate covers every portfolio write', () => {
  const src = read('app/actions/team.ts')

  it('updateTeam and uploadTeamLogo both require a VERIFIED coach', () => {
    for (const fn of ['updateTeam', 'uploadTeamLogo']) {
      const start = src.indexOf(`export async function ${fn}(`)
      expect(start, fn).toBeGreaterThan(-1)
      // Look only at the guard block at the top of the function.
      const window = src.slice(start, start + 2500)
      expect(window, fn).toContain('requireVerifiedCoach()')
    }
  })

  it('surfaces NEEDS_VERIFICATION so the UI can show the CTA instead of a raw error', () => {
    expect(src).toMatch(/code:\s*e\.code as string \| undefined/)
  })

  it('the RLS half is in the migration, not only in the action', () => {
    const sql = read('supabase/migrations/0102_teams_update_requires_verified_coach.sql')
    expect(sql).toContain('is_coach_verified()')
    // Admins must keep the ability to moderate a team regardless of owner state.
    expect(sql).toContain('is_admin()')
  })
})

describe('A-02-02 — the anon actor fallthrough is closed', () => {
  const sql = read('supabase/migrations/0101_close_anon_actor_fallthrough.sql')

  it('gates the no-JWT branch on is_trusted_server_context()', () => {
    expect(sql).toContain('ELSIF is_trusted_server_context() THEN')
    expect(sql).toMatch(/ELSE\s+RETURN jsonb_build_object\('ok', false, 'error', 'unauthorized'\)/)
  })

  it('was built from the LIVE body — 0100 capacity logic must still be present', () => {
    // Rebuilding a function from an older migration file has silently deleted later
    // fixes three times in this repo. If v_delta is gone, that happened again.
    expect(sql).toContain('v_delta')
    expect(sql).toContain('IF v_delta > 0 THEN')
  })
})

describe('A-06-02 — superseded government IDs are queued, not fire-and-forget', () => {
  it('the supersede path enqueues instead of best-effort remove()', () => {
    // The W-9 half of this finding went with the payout subsystem (0111). The coach
    // photo-ID half is the one that mattered anyway -- it is the government ID -- and the
    // queue that backs it (pending_storage_deletions) was deliberately KEPT for exactly
    // this reason when the rest of the payout tables were dropped.
    const cred = read('app/actions/credentials.ts')
    expect(cred).toContain('enqueueStorageDeletion')
    // The old shape must be gone: an unawaited remove() whose failure is only logged.
    expect(cred).not.toMatch(/\.remove\(\[[^\]]+\]\)\s*\n?\s*\.catch/)
  })

  it('the nightly cron retries the queue', () => {
    const cron = read('app/api/cron/expire-submissions/route.ts')
    expect(cron).toContain('sweepPendingStorageDeletions')
  })

  it('the sweep refuses to delete a path that is still a live pointer', () => {
    const lib = read('lib/credentials-retention.ts')
    expect(lib).toContain('isPathStillLive')
    expect(lib).toContain('skippedStillLive')
  })

  it('the queue table is RLS-protected and closed to anon', () => {
    const sql = read('supabase/migrations/0103_pending_storage_deletions.sql')
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('REVOKE ALL ON public.pending_storage_deletions FROM anon')
    expect(sql).toContain('is_admin()')
  })
})

describe('A-10-04 — production dependency tree is clean', () => {
  it('next is pinned at or above the version that fixes the middleware bypass', () => {
    const pkg = JSON.parse(read('package.json'))
    const [maj, min] = pkg.dependencies.next.split('.').map(Number)
    // 16.3.2 carries the App Router middleware/proxy bypass fix. Middleware IS this
    // app's auth boundary, so a downgrade below it is a security regression.
    expect(maj).toBeGreaterThanOrEqual(16)
    if (maj === 16) expect(min).toBeGreaterThanOrEqual(3)
  })

  it('keeps the jsdom/cssstyle overrides that fix ERR_REQUIRE_ESM in the bundle', () => {
    const pkg = JSON.parse(read('package.json'))
    expect(pkg.overrides.jsdom).toBeTruthy()
    expect(pkg.overrides.cssstyle).toBeTruthy()
  })
})
