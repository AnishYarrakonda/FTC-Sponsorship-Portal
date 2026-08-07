import { describe, it, expect } from 'vitest'
import { teamOnboardingBaseSchema } from '@/lib/schemas/team'
import { sponsorApplicationSchema, sponsorSchema } from '@/lib/schemas/sponsor'
import { sponsorSignupSchema } from '@/lib/schemas/sponsor-signup'
import { safeInternalPath, isNextControlFlowError } from '@/lib/client-errors'
import { isAwaitingSponsor, isTerminal, AWAITING_SPONSOR_STATUSES } from '@/lib/submission-status'

/**
 * `updateTeam` validation (report §15 P1).
 *
 * `app/actions/team.ts` was the only mutating action in app/actions/* missing step 1 of
 * the canonical 5-step shape. It now runs `teamOnboardingBaseSchema.partial().safeParse` and
 * builds its payload from `parsed.data`. These assert the two properties that actually
 * matter: `.partial()` still accepts a real section-by-section patch, and it still
 * REJECTS the values the missing validation used to let through.
 */
describe('updateTeam validation — teamOnboardingBaseSchema.partial()', () => {
  it('accepts a partial patch (the portfolio saves one section at a time)', () => {
    const result = teamOnboardingBaseSchema.partial().safeParse({ teamName: 'Exodius Robotics' })
    expect(result.success).toBe(true)
  })

  it('accepts an empty patch without inventing required fields', () => {
    expect(teamOnboardingBaseSchema.partial().safeParse({}).success).toBe(true)
  })

  it('still enforces the mediaUrls supabase-host allowlist', () => {
    // Sharpest consequence of the missing validation: media_urls and press_links stay
    // mutable AFTER an admin approves, so the admin reviews image A and the sponsor
    // opens image B — defeating Admin-Gatekept Outreach without touching `submissions`.
    const evil = teamOnboardingBaseSchema.partial().safeParse({
      mediaUrls: ['https://evil.example/payload.svg'],
    })
    expect(evil.success).toBe(false)

    const ok = teamOnboardingBaseSchema.partial().safeParse({
      mediaUrls: ['https://qqizqbtwigyedgskoezm.supabase.co/storage/v1/object/public/pitch-media/a.png'],
    })
    expect(ok.success).toBe(true)
  })

  it('still rejects a malformed pressLinks url', () => {
    const result = teamOnboardingBaseSchema.partial().safeParse({
      pressLinks: [{ label: 'Coverage', url: 'javascript:alert(1)' }],
    })
    expect(result.success).toBe(false)
  })
})

/**
 * Sponsor email normalization (report §13).
 *
 * `profiles.email` is Clerk-lowercased, and `approveSponsorApplication` links the two by
 * equality. A sponsor who typed `Jane@Acme.COM` had that stored raw, the link matched
 * ZERO rows, Postgres does not report a zero-row UPDATE as an error, and the action
 * returned success — leaving them on "Awaiting verification" permanently.
 */
describe('sponsor email normalization', () => {
  const base = {
    companyName: 'Acme Corporation',
    contactName: 'Jane Doe',
    proposedCapCents: 500000,
  }

  it('lowercases and trims contactEmail in sponsorApplicationSchema', () => {
    const result = sponsorApplicationSchema.safeParse({ ...base, contactEmail: '  Jane@Acme.COM ' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.contactEmail).toBe('jane@acme.com')
  })

  it('lowercases and trims contactEmail in sponsorSchema (the admin-create path)', () => {
    const result = sponsorSchema.safeParse({
      companyName: 'Acme Corporation',
      contactName: 'Jane Doe',
      contactEmail: 'Jane@ACME.com',
      fundingCapCents: 500000,
      status: 'active',
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.contactEmail).toBe('jane@acme.com')
  })

  it('sponsorSignupSchema was already normalizing — assert it stays that way', () => {
    // .partial() is unavailable here for the same Zod-4 reason as teamOnboardingSchema
    // (this schema carries a password-confirmation refinement), so assert on the field.
    const result = sponsorSignupSchema.shape.email.safeParse('  Jane@Acme.COM ')
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toBe('jane@acme.com')
  })

  it('two casings of the same address converge on one stored value', () => {
    const a = sponsorApplicationSchema.safeParse({ ...base, contactEmail: 'JANE@ACME.COM' })
    const b = sponsorApplicationSchema.safeParse({ ...base, contactEmail: 'jane@acme.com' })
    expect(a.success && b.success).toBe(true)
    if (a.success && b.success) expect(a.data.contactEmail).toBe(b.data.contactEmail)
  })
})

/** Open redirect on /login (report §15 P2). */
describe('safeInternalPath', () => {
  it('keeps a genuine internal path, including query and hash', () => {
    expect(safeInternalPath('/dashboard')).toBe('/dashboard')
    expect(safeInternalPath('/moderation?tab=queue#top')).toBe('/moderation?tab=queue#top')
  })

  it('rejects every off-site form', () => {
    for (const evil of [
      'https://evil.example/',
      'http://evil.example/',
      '//evil.example/',
      '/\\evil.example',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'evil.example',
    ]) {
      expect(safeInternalPath(evil)).toBe('/')
    }
  })

  it('falls back for empty input', () => {
    expect(safeInternalPath(null)).toBe('/')
    expect(safeInternalPath(undefined)).toBe('/')
    expect(safeInternalPath('')).toBe('/')
  })
})

/**
 * A catch block around a server action must not swallow `redirect()` / `notFound()`,
 * which signal control flow by throwing.
 */
describe('isNextControlFlowError', () => {
  it('recognises Next redirect and not-found digests', () => {
    expect(isNextControlFlowError({ digest: 'NEXT_REDIRECT;replace;/dashboard;307;' })).toBe(true)
    expect(isNextControlFlowError({ digest: 'NEXT_NOT_FOUND' })).toBe(true)
  })

  it('does not misclassify a real error', () => {
    expect(isNextControlFlowError(new Error('database is on fire'))).toBe(false)
    expect(isNextControlFlowError({ digest: 12345 })).toBe(false)
    expect(isNextControlFlowError(null)).toBe(false)
    expect(isNextControlFlowError(undefined)).toBe(false)
  })
})

/**
 * Status-enum handling. The app treated `pending` as "waiting on the sponsor", which is
 * wrong in both directions and produced three separate shipped defects.
 */
describe('submission status groupings', () => {
  it('a sponsor-actionable pitch is dispatched/delivered/opened — never pending', () => {
    expect(AWAITING_SPONSOR_STATUSES).toEqual(['dispatched', 'delivered', 'opened'])
    expect(isAwaitingSponsor('pending')).toBe(false)
    for (const s of AWAITING_SPONSOR_STATUSES) expect(isAwaitingSponsor(s)).toBe(true)
  })

  it('expired and bounced are terminal, so the decision console must not render', () => {
    // review-shell.tsx rendered LIVE Approve/Decline buttons for these, whose RPC always
    // returns invalid_status — the sponsor's funding decision silently evaporated.
    expect(isAwaitingSponsor('expired')).toBe(false)
    expect(isAwaitingSponsor('bounced')).toBe(false)
    expect(isTerminal('expired')).toBe(true)
    expect(isTerminal('bounced')).toBe(true)
  })

  it('handles null/undefined without throwing', () => {
    expect(isAwaitingSponsor(null)).toBe(false)
    expect(isAwaitingSponsor(undefined)).toBe(false)
    expect(isTerminal(null)).toBe(false)
  })
})
