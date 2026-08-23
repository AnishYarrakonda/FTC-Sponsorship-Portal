/**
 * Regression cover for Group 6 (accessibility): A-08, B-04 and A-07.
 *
 * The contrast assertions compute the real WCAG ratio rather than pinning a hex, because
 * the whole point of A-08-02 was that a finding asserted a ratio against the wrong
 * background and its proposed fix would have caused the failure it claimed to fix.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
const css = read('app/globals.css')

function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)]
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}
function token(name: string): string {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`))
  if (!m) throw new Error(`token --${name} not found in globals.css`)
  return m[1]
}

describe('A-08-01 / B-04-16 — the credential dropzones are keyboard reachable', () => {
  it('both use a label + focusable input, not a click-only div', () => {
    for (const f of ['app/(auth)/upload-credentials/page.tsx', 'components/auth/signup-wizard.tsx']) {
      const src = read(f)
      // `hidden` is display:none, which removes the input from the tab order entirely —
      // that is what left /upload-credentials with a single tab stop.
      expect(src, f).not.toMatch(/type="file"[^>]*className="hidden"/)
      expect(src, f).toMatch(/type="file"[\s\S]{0,200}className="sr-only"/)
      expect(src, f).toContain('focus-within:ring')
    }
  })

  it('the upload page announces the selection and explains the disabled submit', () => {
    const src = read('app/(auth)/upload-credentials/page.tsx')
    expect(src).toContain('aria-live="polite"')
    expect(src).toContain('aria-describedby="credential-file-status"')
  })
})

describe('A-08-02 — DOES NOT REPRODUCE, and the proposed fix was harmful', () => {
  it('the metric label sits on charcoal and passes AA there', () => {
    // The finding computes #A39A88 against the cream page background (#F7F3EE) and gets
    // 2.52:1. But the element is inside a CharcoalCard. Against the surface it is
    // actually painted on, it passes comfortably.
    const ratio = contrast(token('text-muted'), token('surface-charcoal'))
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })

  it("the audit's proposed replacement would have FAILED on that surface", () => {
    // This is the assertion that matters. The finding says to swap `text-text-muted` for
    // `text-muted-foreground` (#6B6459). On the charcoal card that element actually sits
    // on, that lands around 2.9:1 — so applying the finding as written would have
    // introduced the WCAG violation it claimed to fix. Pinned so nobody "completes" the
    // finding later.
    const proposed = contrast(token('muted-foreground'), token('surface-charcoal'))
    expect(proposed).toBeLessThan(4.5)
  })

  it('the class is used in exactly one place, so there is no other context to check', () => {
    const page = read('app/page.tsx')
    expect((page.match(/text-text-muted/g) ?? []).length).toBe(1)
    expect(page).toMatch(/CharcoalCard[\s\S]{0,400}text-text-muted/)
  })
})

describe('B-04-02 — the pending badge passes AA', () => {
  it('badge-pending-text on badge-pending-bg clears 4.5:1', () => {
    // Was 4.493:1 — under by 0.007. Computed, not hardcoded, so a future token tweak
    // that reintroduces the failure is caught here rather than by an auditor.
    const ratio = contrast(token('badge-pending-text'), token('badge-pending-bg'))
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })
})

describe('B-04-01 — focus survives forced-colors mode', () => {
  it('globals.css has a forced-colors block using a system colour', () => {
    expect(css).toContain('@media (forced-colors: active)')
    // A system keyword, not an authored colour: forced-colors replaces author colours
    // with the user's palette, so `var(--ring)` can end up painted as the background.
    expect(css).toMatch(/outline:\s*3px solid Highlight/)
  })

  it('also re-asserts an outline for components that opt out with their own ring', () => {
    expect(css).toContain("[class*='focus-visible:ring']:focus-visible")
  })
})

describe('B-04-03 / B-04-04 — icon-only and unlabelled controls have names', () => {
  it('the member row menu is named PER ROW', () => {
    const src = read('components/sponsor/members-panel.tsx')
    expect(src).toContain('aria-label={`Actions for ${memberName}`}')
    // A generic "Options" on three identical rows is still unusable — nothing says which
    // member you are about to act on.
    expect(src).toContain('memberName={member.fullName ?? member.email')
  })

  it('the audit filter has an id and a visible label', () => {
    const src = read('components/admin/audit-log-table.tsx')
    expect(src).toContain('id="audit-action-filter"')
    expect(src).toContain('htmlFor="audit-action-filter"')
  })
})

describe('B-04-05 — the command palette is a real dialog', () => {
  const src = read('components/global-command-palette.tsx')

  it('renders through the project Dialog rather than a bare fixed overlay', () => {
    expect(src).toContain('<Dialog open={open} onOpenChange={setOpen}>')
    expect(src).toContain('aria-label="Command palette"')
    expect(src).not.toMatch(/className="fixed inset-0 z-50 flex items-start/)
  })

  it('no longer keeps a second Escape handler that would pre-empt focus restore', () => {
    expect(src).not.toMatch(/if \(e\.key === 'Escape'\) setOpen\(false\)/)
  })

  it('the illegal listbox child is gone', () => {
    // <span> directly inside role="listbox" fails aria-required-children (critical), and
    // the practical cost is that option count and position stop being announced.
    expect(src).not.toMatch(/<CommandGroup[^>]*>\s*<span/)
    expect(src).toContain('cmdk-group-heading')
  })
})

describe('B-04-06 — the graduation trigger has a focus ring', () => {
  const src = read('components/coach/dashboard-shell.tsx')

  it('renders through the shared Button', () => {
    expect(src).toContain('<DialogTrigger render={<Button />}>')
  })

  it('no longer opts out of the global outline without a replacement', () => {
    expect(src).not.toMatch(/DialogTrigger[\s\S]{0,300}focus-visible:outline-none[\s\S]{0,80}>\s*\n\s*I have a team now/)
  })
})

describe('A-07-01 — waiving a benefit is confirmed, and the copy is TRUE', () => {
  const src = read('components/sponsor/waive-benefit-button.tsx')

  it('is wrapped in an AlertDialog naming the benefit', () => {
    expect(src).toContain('AlertDialog')
    expect(src).toContain('Waive “{label}”?')
  })

  it('does not claim an admin cannot reverse it', () => {
    // record_benefit_delivery: "a waived row is the sponsor's decision and only an admin
    // may move it again." The sponsor cannot undo it; an admin can. Saying otherwise
    // sends a user away from support instead of towards it.
    expect(src).toContain('You cannot undo this yourself')
    expect(src).toMatch(/administrator has to reverse it/)
    expect(src).not.toMatch(/cannot be undone/i)
  })
})

describe('A-07-02 — the pitch textareas cap at the schema limit', () => {
  const src = read('components/portfolio-builder/portfolio-form.tsx')

  it('all three carry maxLength', () => {
    expect(src).toContain('maxLength={LIMITS.customPitchAlignment}')
    expect(src).toContain('maxLength={LIMITS.specificNeeds}')
    expect(src).toContain('maxLength={LIMITS.localConnection}')
  })

  it('reads them from LIMITS rather than hardcoding, so input and Zod cannot drift', () => {
    expect(src).toContain("from '@/lib/schemas/limits'")
    expect(src).not.toMatch(/maxLength=\{1500\}|maxLength=\{1000\}/)
  })
})
