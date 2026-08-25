/**
 * Regression cover for P2 Group B — security and access.
 *
 * A-02-04, A-06-03, A-06-04, A-10-05. (A-01-03 did not reproduce — see the describe block
 * at the bottom, which pins the fix that already existed so it cannot regress.)
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectTeam } from '../impact-report/projection'
import {
  isWellFormedAccessToken,
  throttleTokenView,
  __resetTokenViewThrottle,
  TOKEN_VIEW_LIMIT_PER_WINDOW,
  TOKEN_VIEW_WINDOW_MS,
} from '../token-view-guard'

const root = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

describe('A-02-04 — every UPDATE policy states its WITH CHECK explicitly', () => {
  const migration = read('supabase/migrations/0108_explicit_with_check_on_update_policies.sql')

  it('covers all four policies the pg_policies sweep found', () => {
    // The finding named three. Sweeping pg_policies rather than spot-checking migrations
    // turned up a fourth on storage.objects.
    for (const p of [
      'profiles_update_admin',
      'submissions_update_admin',
      'achievements_update',
      'Coaches can update their own team logo',
    ]) {
      expect(migration, p).toContain(p)
    }
  })

  it('each policy has both a USING and a WITH CHECK', () => {
    const usings = migration.match(/^\s*USING \(/gm) ?? []
    const checks = migration.match(/^\s*WITH CHECK \(/gm) ?? []
    expect(usings).toHaveLength(4)
    expect(checks).toHaveLength(4)
  })

  it('the achievements policy keeps the verified-coach requirement on the write side', () => {
    // teams_update had exactly this omission for real (0102). The post-image check is the
    // half that stops a row being written into a state the read rule would have refused.
    const withCheckBlock = migration.slice(migration.indexOf('CREATE POLICY achievements_update'))
    const check = withCheckBlock.slice(withCheckBlock.indexOf('WITH CHECK'))
    expect(check).toContain('is_coach_verified()')
    expect(check).toContain('current_profile_id()')
    expect(check).toContain('is_admin()')
  })
})

describe('A-06-03 — signed URLs for government IDs are short-lived', () => {
  it('the TTL is 60 seconds, not 1800', () => {
    // The constant lives in lib/, not the action file: every export of a 'use server'
    // module must be an async server action, and exporting a const there fails the build.
    expect(read('lib/sensitive-documents.ts')).toContain('SENSITIVE_DOCUMENT_URL_TTL_SECONDS = 60')
  })

  it('neither admin queue mints a 1800-second URL any more', () => {
    for (const f of ['app/(admin)/coaches/page.tsx']) {
      expect(read(f), f).not.toContain(', 1800)')
      expect(read(f), f).toContain('SENSITIVE_DOCUMENT_URL_TTL_SECONDS')
    }
  })

  it('the storage path is resolved server-side from an id, never taken from the caller', () => {
    // Otherwise this action is an arbitrary-object read oracle across every bucket.
    const action = read('app/actions/sensitive-documents.ts')
    expect(action).toContain('kind: z.enum(')
    expect(action).toContain('subjectId: z.string().uuid()')
    expect(action).not.toMatch(/path:\s*z\.string\(\)/)
  })

  it('it is admin-only and every view is audited', () => {
    const action = read('app/actions/sensitive-documents.ts')
    expect(action).toContain('requireAdmin()')
    expect(action).toContain("action: 'sensitive_document_viewed'")
  })

  it('the audit row never records the signed URL itself', () => {
    const action = read('app/actions/sensitive-documents.ts')
    const auditBlock = action.slice(action.indexOf('writeAudit('), action.indexOf('return { url'))
    expect(auditBlock).not.toContain('signedUrl')
    expect(auditBlock).not.toContain('signed.signedUrl')
  })

  it('the external-open control re-mints rather than reusing a stale render-time URL', () => {
    const btn = read('components/admin/open-sensitive-document-button.tsx')
    expect(btn).toContain('mintSensitiveDocumentUrl')
    // A signed URL must not leak through a referrer header.
    expect(btn).toContain('noopener,noreferrer')
    // The payout review card went with the W-9 subsystem (0111); the coach verification
    // card is the surviving surface that mints a URL to a government ID.
    for (const f of ['components/admin/coach-verification-card.tsx']) {
      expect(read(f), f).toContain('OpenSensitiveDocumentButton')
      expect(read(f), f).not.toMatch(/<a href=\{coach\.signedUrl!\}/)
    }
  })
})

describe('A-06-04 — impact report media is scheme- and host-validated', () => {
  const base = {
    team_name: 'Test Team',
    media_no_minors_confirmed_at: '2026-01-01T00:00:00Z',
  }

  it('drops javascript: and data: URLs', () => {
    const out = projectTeam({
      ...base,
      media_urls: [
        'javascript:alert(1)',
        'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      ],
    } as never)
    expect(out.media_urls).toEqual([])
  })

  it('drops third-party hosts even when the scheme is https', () => {
    // Not just an XSS question: loading a coach-chosen image on a sponsor-facing page
    // leaks the sponsor's IP and the referrer of a token-bearing URL to that host.
    const out = projectTeam({
      ...base,
      media_urls: ['https://evil.example.com/tracker.png', 'https://supabase.co.evil.com/x.png'],
    } as never)
    expect(out.media_urls).toEqual([])
  })

  it('keeps genuine Supabase Storage URLs', () => {
    const good = 'https://qqizqbtwigyedgskoezm.supabase.co/storage/v1/object/public/team-logos/a.png'
    const out = projectTeam({ ...base, media_urls: [good] } as never)
    expect(out.media_urls).toEqual([good])
  })

  it('still fails closed when the no-minors affirmation is absent', () => {
    const good = 'https://x.supabase.co/storage/v1/object/public/team-logos/a.png'
    const out = projectTeam({ ...base, media_no_minors_confirmed_at: null, media_urls: [good] } as never)
    expect(out.media_urls).toEqual([])
  })

  it('validates BEFORE slicing, so rejected URLs cannot eat the media limit', () => {
    const good = 'https://x.supabase.co/storage/v1/object/public/team-logos/ok.png'
    const out = projectTeam({
      ...base,
      media_urls: [...Array(6).fill('javascript:alert(1)'), good],
    } as never)
    expect(out.media_urls).toEqual([good])
  })

  it('logo_url is validated too — it is fed straight into an <img src>', () => {
    // Not named in the pack; same defect class, same file, found while proving A-06-04.
    const out = projectTeam({ ...base, logo_url: 'javascript:alert(1)' } as never)
    expect(out.logo_url).toBeNull()
    const good = 'https://x.supabase.co/storage/v1/object/public/team-logos/logo.png'
    expect(projectTeam({ ...base, logo_url: good } as never).logo_url).toBe(good)
  })
})

describe('A-10-05 — the unauthenticated token view is guarded before it queries', () => {
  beforeEach(() => __resetTokenViewThrottle())

  it('only a 64-char lowercase hex string is even considered', () => {
    expect(isWellFormedAccessToken('a'.repeat(64))).toBe(true)
    expect(isWellFormedAccessToken('0123456789abcdef'.repeat(4))).toBe(true)
    // The finding's own repro path.
    expect(isWellFormedAccessToken('foo')).toBe(false)
    expect(isWellFormedAccessToken('A'.repeat(64))).toBe(false) // uppercase
    expect(isWellFormedAccessToken('a'.repeat(63))).toBe(false)
    expect(isWellFormedAccessToken('a'.repeat(65))).toBe(false)
    expect(isWellFormedAccessToken('g'.repeat(64))).toBe(false) // not hex
    expect(isWellFormedAccessToken(null)).toBe(false)
    expect(isWellFormedAccessToken(12345)).toBe(false)
  })

  it('the throttle allows a normal burst then refuses', () => {
    const key = 'k'
    for (let i = 0; i < TOKEN_VIEW_LIMIT_PER_WINDOW; i++) {
      expect(throttleTokenView(key, 1_000), `request ${i}`).toBe(true)
    }
    expect(throttleTokenView(key, 1_000)).toBe(false)
  })

  it('the window slides, so a legitimate sponsor is not locked out forever', () => {
    const key = 'k'
    for (let i = 0; i < TOKEN_VIEW_LIMIT_PER_WINDOW; i++) throttleTokenView(key, 1_000)
    expect(throttleTokenView(key, 1_000)).toBe(false)
    expect(throttleTokenView(key, 1_000 + TOKEN_VIEW_WINDOW_MS + 1)).toBe(true)
  })

  it('one token being hammered does not throttle a different one', () => {
    for (let i = 0; i < TOKEN_VIEW_LIMIT_PER_WINDOW + 5; i++) throttleTokenView('busy', 1_000)
    expect(throttleTokenView('quiet', 1_000)).toBe(true)
  })

  it('both guards run before the admin-client query, and both fail to notFound()', () => {
    const page = read('app/sponsor-view/[token]/page.tsx')
    const shapeAt = page.indexOf('isWellFormedAccessToken(token)')
    const throttleAt = page.indexOf('throttleTokenView(tokenHash)')
    const queryAt = page.indexOf("from('submission_access_tokens')")
    expect(shapeAt).toBeGreaterThan(-1)
    expect(throttleAt).toBeGreaterThan(shapeAt)
    expect(queryAt).toBeGreaterThan(throttleAt)
    // A distinct error would turn this into an oracle for token existence.
    expect(page).toContain('if (!isWellFormedAccessToken(token)) return notFound()')
    expect(page).toContain('if (!throttleTokenView(tokenHash)) return notFound()')
  })

  it('no Upstash/Redis dependency was reintroduced', () => {
    // workflows.md records these were removed deliberately. Assert on real imports rather
    // than the words, since the module's own comment explains why they are absent.
    const guard = read('lib/token-view-guard.ts')
    expect(guard).not.toMatch(/^\s*import .*(upstash|ioredis|@vercel\/kv)/im)
    const pkg = JSON.parse(read('package.json'))
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
    for (const forbidden of ['@upstash/redis', '@upstash/ratelimit', 'ioredis', '@vercel/kv']) {
      expect(deps, forbidden).not.toHaveProperty(forbidden)
    }
  })
})

describe('A-01-03 — DID NOT REPRODUCE, and the existing fix is pinned here', () => {
  const src = read('lib/actions-utils.ts')

  it('a membership read ERROR throws instead of falling through to the legacy seat', () => {
    // The finding asserts requireSponsor "falls back to LEGACY_MEMBER_ROLE if membership
    // is null, which can happen if the database read fails". That is no longer true: the
    // error is checked and thrown before `memberships ?? []` can flatten it to an empty
    // array. Asserted here so the finding cannot come back true.
    expect(src).toContain('if (membershipError) {')
    const block = src.slice(src.indexOf('if (membershipError) {'))
    expect(block.slice(0, 200)).toContain('throw new Error')
  })

  it('the genuine zero-row case still resolves the legacy owner, which is intended', () => {
    // A legacy owner holds profiles.sponsor_id and no sponsor_members row; they really are
    // the org admin. That fallback is load-bearing (A-05-03) and must NOT be removed.
    expect(src).toContain('LEGACY_MEMBER_ROLE')
  })
})
