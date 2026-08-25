/**
 * Regression cover for P2 Group C — coach and sponsor journeys.
 *
 * B-03-09, B-03-10, B-03-13, A-05-04, A-07-03, A-07-04, B-01-4.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { execSync as execSync_ } from 'node:child_process'
import { join } from 'node:path'
import { submissionSchema, submissionDraftSchema } from '../schemas/submission'
import { formatMoney, formatMoneyAmount } from '../format-money'
import { STATUS_CONFIG } from '@/components/ui/status-badge'

const root = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

/**
 * Strip comments before asserting that a call is ABSENT. Several of these fixes are
 * documented by naming the function that was removed, which a naive `not.toContain` would
 * then match against the explanation rather than the code.
 */
const readCode = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

// A valid v4 UUID — zod's uuid() checks the version nibble.
const SPONSOR_ID = '11111111-1111-4111-8111-111111111111'

const XSS = '<img src=x onerror="window.__X=1"><script>window.__Y=1</script>Local connection'

describe('B-03-09 — Local Connection Notes is sanitized AND actually shown', () => {
  it('the field is no longer raw z.string() — HTML is flattened like its siblings', () => {
    const parsed = submissionSchema.safeParse({
      sponsorId: SPONSOR_ID,
      customPitchAlignment: 'x'.repeat(60),
      specificNeedsStatement: 'y'.repeat(60),
      localConnectionNotes: XSS,
    })
    expect(parsed.success).toBe(true)
    const notes = parsed.success ? parsed.data.localConnectionNotes ?? '' : ''
    expect(notes).not.toContain('<script')
    expect(notes).not.toContain('onerror')
    expect(notes).toContain('Local connection')
  })

  it('it stays optional — a coach with no local tie leaves it blank', () => {
    const parsed = submissionSchema.safeParse({
      sponsorId: SPONSOR_ID,
      customPitchAlignment: 'x'.repeat(60),
      specificNeedsStatement: 'y'.repeat(60),
    })
    expect(parsed.success).toBe(true)
  })

  it('the 1000-character cap still holds', () => {
    const parsed = submissionSchema.safeParse({
      sponsorId: SPONSOR_ID,
      customPitchAlignment: 'x'.repeat(60),
      specificNeedsStatement: 'y'.repeat(60),
      localConnectionNotes: 'z'.repeat(1001),
    })
    expect(parsed.success).toBe(false)
  })

  it('the admin moderating sponsor-facing outreach can now read it', () => {
    // The gap this closes is a Core Mandate one: the admin gating outreach was never
    // shown a coach-authored field that was already in the sponsor's payload.
    expect(read('app/(admin)/moderation/page.tsx')).toContain('local_connection_notes')
    expect(read('components/admin/moderation-queue.tsx')).toContain('local_connection_notes')
  })

  it('both sponsor-facing surfaces render it', () => {
    expect(read('components/sponsor/review-shell.tsx')).toContain('local_connection_notes')
    expect(read('app/sponsor-view/[token]/page.tsx')).toContain('local_connection_notes')
  })
})

describe('B-03-10 — every write from the submission actions is validated', () => {
  it('the draft schema applies the transforms without the 50-char minimums', () => {
    const parsed = submissionDraftSchema.safeParse({
      sponsorId: SPONSOR_ID,
      customPitchAlignment: '<b>half written</b>',
    })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.customPitchAlignment).toBe('half written')
  })

  it('the draft schema still enforces the maximums', () => {
    const parsed = submissionDraftSchema.safeParse({
      sponsorId: SPONSOR_ID,
      customPitchAlignment: 'x'.repeat(1501),
    })
    expect(parsed.success).toBe(false)
  })

  it('autosave parses before writing', () => {
    const src = read('app/actions/submission.ts')
    const fn = src.slice(src.indexOf('export async function autoSaveSubmissionDraft'))
    expect(fn).toContain('submissionDraftSchema.safeParse(data)')
    // Every column written must come from parsed.data, not the raw argument.
    expect(fn).toContain('sponsor_id: parsed.data.sponsorId')
    expect(fn).toContain('custom_pitch_alignment: parsed.data.customPitchAlignment')
    expect(fn).toContain('local_connection_notes: parsed.data.localConnectionNotes')
  })

  it('saveSubmission USES the parse result rather than discarding it', () => {
    // Found while fixing the autosave path: this function parsed on the submit path but
    // then built its payload from the raw `data`, so the transform never landed, and the
    // draft path did not parse at all.
    const src = read('app/actions/submission.ts')
    const fn = src.slice(src.indexOf('export async function saveSubmission'), src.indexOf('export async function withdrawSubmission'))
    expect(fn).toContain('sanitized = result.data')
    expect(fn).toContain('submissionDraftSchema.safeParse(data)')
    expect(fn).toContain('custom_pitch_alignment: sanitized.customPitchAlignment')
    expect(fn).not.toMatch(/custom_pitch_alignment: data\./)
    expect(fn).not.toMatch(/local_connection_notes: data\./)
  })

  it('autosave cannot reach status or the amount columns', () => {
    // The reason this stayed a P2 rather than being a P0 wearing a P2 label.
    const src = read('app/actions/submission.ts')
    const fn = src.slice(src.indexOf('export async function autoSaveSubmissionDraft'))
    const payload = fn.slice(fn.indexOf('const payload = {'), fn.indexOf('if (submissionId)'))
    expect(payload).not.toMatch(/status:/)
    expect(payload).toContain('requested_amount_cents: financialAsk')
    expect(payload).not.toMatch(/requested_amount_cents:\s*(parsed\.)?data\./)
    for (const key of ['sponsorId', 'customPitchAlignment', 'specificNeedsStatement', 'localConnectionNotes']) {
      expect(Object.keys(submissionDraftSchema.shape)).toContain(key)
    }
    expect(Object.keys(submissionDraftSchema.shape)).not.toContain('status')
  })
})

describe('A-05-04 — one approval, one email', () => {
  it('the portal/approvals path sends only the handshake', () => {
    const src = readCode('lib/decision-followup.ts')
    const approved = src.slice(src.indexOf("if (status === 'approved')"), src.indexOf("} else if (status === 'declined')"))
    expect(approved).toContain('sendHandshakeEmail(submissionId, amountCents)')
    expect(approved).not.toMatch(/sendSubmissionDecisionEmail\(/)
  })

  it('the emailed-token path sends only the handshake', () => {
    const src = readCode('app/actions/sponsor-decision.ts')
    const block = src.slice(src.indexOf("if (submissionId && decision !== 'decline')"))
    const approved = block.slice(0, block.indexOf('} else if (submissionId)'))
    expect(approved).toContain('sendHandshakeEmail')
    expect(approved).not.toContain("sendSubmissionDecisionEmail(submissionId, 'approved')")
  })

  it('decline and changes_requested KEEP their decision email — there is no handshake there', () => {
    const src = readCode('lib/decision-followup.ts')
    const rest = src.slice(src.indexOf("} else if (status === 'declined')"))
    expect(rest).toContain("sendSubmissionDecisionEmail(submissionId, 'declined'")
    expect(rest).toContain("sendSubmissionDecisionEmail(submissionId, 'changes_requested'")
  })
})

describe('A-07-03 — money always renders with both cents', () => {
  it('a whole-dollar amount keeps its .00', () => {
    expect(formatMoney(50000)).toBe('$500.00')
    expect(formatMoneyAmount(50000)).toBe('500.00')
  })

  it('a half-cent-looking amount is not truncated to one digit', () => {
    expect(formatMoney(123450)).toBe('$1,234.50')
    expect(formatMoneyAmount(123450)).toBe('1,234.50')
  })

  it('floating-point division cannot leak extra digits', () => {
    // 1234 / 100 = 12.34 exactly here, but the maximumFractionDigits bound is what
    // guarantees no amount ever renders as $12.340000000000001.
    expect(formatMoney(1234)).toBe('$12.34')
    expect(formatMoney(1)).toBe('$0.01')
    expect(formatMoney(999999999)).toBe('$9,999,999.99')
  })

  it('null and NaN degrade to $0.00 rather than "$NaN"', () => {
    expect(formatMoney(null)).toBe('$0.00')
    expect(formatMoney(undefined)).toBe('$0.00')
    expect(formatMoney(NaN)).toBe('$0.00')
  })

  it('no surface divides by 100 and calls toLocaleString with no options', () => {
    const out = execSync_
(
      "grep -rn '/ 100).toLocaleString()' app components lib emails | grep -v '__tests__' || true",
      { cwd: root, encoding: 'utf8' }
    ).trim()
    expect(out).toBe('')
  })
})

describe('B-01-4 — NEEDS_VERIFICATION offers a way forward', () => {
  const src = read('components/portfolio-builder/portfolio-form.tsx')

  it('the code is branched on rather than the raw message being printed', () => {
    expect(src).toContain("result.code === 'NEEDS_VERIFICATION'")
  })

  it('a real CTA is rendered, not a destructive alert', () => {
    expect(src).toContain('href="/awaiting-verification"')
    expect(src).toContain('Check verification status')
  })

  it('the generic destructive error path is not used for it', () => {
    const branch = src.slice(src.indexOf("result.code === 'NEEDS_VERIFICATION'"))
    const body = branch.slice(0, branch.indexOf('const msg'))
    expect(body).toContain('setNeedsVerification(true)')
    expect(body).toContain('setError(null)')
  })
})

/**
 * NOT IN THE PACK. Found by the keyboard-journey E2E test in Phase 5.
 *
 * B-03-11 (P1 sweep) revokes EVERY outstanding access token for a submission once a
 * decision lands, and `.is('revoked_at', null)` does not exclude the token that was just
 * consumed. `/sponsor-view/[token]` then returned `notFound()` on any revoked token — so
 * the sponsor pressed "Confirm Decline", the action revoked their own link,
 * `revalidatePath` re-rendered the route, and they were handed a 404 with no confirmation
 * that the decision they had just made had been recorded at all.
 *
 * Both fixes are correct in isolation, which is why review missed it and why every
 * database assertion in the E2E test passed. Only the assertion about what the SPONSOR
 * SEES failed.
 *
 * `used_at` is the discriminator: a used token is the record of this visitor's own
 * decision, not a leaked link. Revoked-and-never-used stays a 404.
 */
describe('sponsor-view does not 404 the sponsor who just decided', () => {
  const page = readCode('app/sponsor-view/[token]/page.tsx')

  it('a revoked token is only a 404 when it was never used', () => {
    expect(page).toContain('if (row.revoked_at && !row.used_at) return notFound()')
    // The unconditional form is what produced the 404.
    expect(page).not.toMatch(/if \(row\.revoked_at\) return notFound\(\)/)
  })

  it('the decided branch still renders read-only and announces the outcome', () => {
    // `decided` gates the decision controls off, so a used token cannot decide twice.
    expect(page).toContain('const decided = !!row.used_at')
    expect(page).toContain("role={decided ? 'status' : undefined}")
    expect(page).toContain('Decision recorded')
  })

  it('revocation itself is unchanged — every live token is still revoked on decision', () => {
    const followUp = read('lib/decision-followup.ts')
    expect(followUp).toContain('export async function revokeSubmissionAccessTokens')
    expect(followUp).toMatch(/\.is\('revoked_at', null\)/)
  })
})
