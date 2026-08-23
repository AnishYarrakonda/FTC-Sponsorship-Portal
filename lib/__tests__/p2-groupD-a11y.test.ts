/**
 * Regression cover for P2 Group D (accessibility): B-04-07…12 and A-08-04.
 *
 * Contrast is COMPUTED here, never pinned as a hex. A-08-02 was a phantom precisely
 * because an audit asserted a ratio against the wrong ancestor background and its proposed
 * fix would have introduced the failure it claimed to fix. Every ratio below states which
 * background it is measured against.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

const root = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

/**
 * Comments stripped. Several of these fixes are documented by quoting the markup or the
 * skip-reason they removed, which a naive `not.toContain` would match against the
 * explanation rather than the code.
 */
const readCode = (p: string) =>
  read(p)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

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

/** AA for normal-size text. */
const AA_NORMAL = 4.5

describe('B-04-07 — read-only values are named, not unlabelled disabled inputs', () => {
  it('a dl/dt/dd renders the pair, so the name is native rather than wired by id', () => {
    const src = readCode('components/ui/read-only-field.tsx')
    expect(src).toContain('<dl')
    expect(src).toContain('<dt')
    expect(src).toContain('<dd')
    // If it were still an input, it would need an id + label and could get them wrong.
    expect(src).not.toContain('<input')
    expect(src).not.toContain('<Input')
  })

  it('account settings no longer renders unlabelled disabled inputs for email and role', () => {
    const src = read('components/account/account-settings.tsx')
    expect(src).toContain('<ReadOnlyField')
    expect(src).not.toContain('<Input value={email} disabled')
    expect(src).not.toContain('<Input value={role} disabled')
  })

  it('the masked EINs on the payout form are named', () => {
    // The field where "which identifier is this" is the entire question.
    const src = read('components/coach/payout-profile-form.tsx')
    expect(src).toContain('label="EIN"')
    expect(src).toContain('label="Fiscal Sponsor EIN"')
    expect(src).not.toMatch(/<Input disabled value=\{`•••••-••\$\{initialData/)
  })

  it('no disabled Input in the app is left without an accessible name', () => {
    // A disabled <Input> is only acceptable inside a FormItem/FormLabel pair, which does
    // associate the label. The bare ones are what this finding was about.
    const hits = execSync(
        `grep -rn '<Input' app components | grep 'disabled' | grep -v 'FormControl' || true`,
        { cwd: root, encoding: 'utf8' }
      )
      .trim()
    expect(hits, `unlabelled disabled inputs remain:\n${hits}`).toBe('')
  })
})

describe('B-04-08 — the landing page reflows at 320px', () => {
  const src = read('components/landing/product-showcase.tsx')

  it('both grid children can shrink below their min-content width', () => {
    // Grid items default to `min-width: auto`. That is the entire mechanism: the mock's
    // min-content width (its monospace URL and mock table) forced the column, and
    // therefore the document, to 331px against a 320px viewport.
    const grid = src.slice(src.indexOf('lg:grid-cols-2'))
    expect((grid.match(/min-w-0/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })

  it('the long monospace URLs truncate inside the mock instead of widening the page', () => {
    expect(src).toMatch(/truncate[^>]*app\.ftcpitfund\.com\/portfolio|app\.ftcpitfund\.com\/portfolio/)
    for (const url of ['app.ftcpitfund.com/portfolio', 'app.ftcpitfund.com/admin/review']) {
      const line = src.split('\n').find((l) => l.includes(url))!
      expect(line, url).toContain('truncate')
      expect(line, url).toContain('min-w-0')
    }
  })
})

describe('B-04-09 — horizontally scrollable regions are keyboard operable', () => {
  const cases: [string, string][] = [
    ['app/(admin)/analytics/page.tsx', 'Recent activity table'],
    ['components/admin/analytics-charts.tsx', 'Sponsor funding breakdown table'],
    ['app/(admin)/admin/capacity/page.tsx', 'The capacity invariant formula'],
  ]

  it.each(cases)('%s exposes its scroll region to the keyboard', (file, label) => {
    const src = read(file)
    const line = src.split('\n').find((l) => l.includes('overflow-x-auto'))!
    expect(line, file).toContain('tabIndex={0}')
    expect(line, file).toContain('role="region"')
    expect(line, file).toContain(label)
  })

  it('the admin shell <main> is NOT given tabIndex={0}, and the exemption is written down', () => {
    // Doing so would put the whole page shell in the tab order ahead of its contents on
    // every admin page. It is already focusable at -1 as the skip-link target.
    const layout = read('app/(admin)/layout.tsx')
    expect(layout).toContain('<main id="main-content" tabIndex={-1}')
    expect(layout).not.toContain('id="main-content" tabIndex={0}')
    expect(layout).toContain('DOCUMENTED EXEMPTION')
  })
})

describe('B-04-10 — destructive TEXT passes AA on both page backgrounds', () => {
  const destructiveText = token('destructive-text')
  const bgApp = token('bg-app')
  const bgSurface = token('bg-surface')

  it('passes on the app background', () => {
    expect(contrast(destructiveText, bgApp)).toBeGreaterThanOrEqual(AA_NORMAL)
  })

  it('passes on the card background, which is where the legal-review banner renders', () => {
    expect(contrast(destructiveText, bgSurface)).toBeGreaterThanOrEqual(AA_NORMAL)
  })

  it('has real headroom, not a hairline pass', () => {
    // --badge-pending-text failed by 0.007 once. Scraping the line is how that happens.
    expect(Math.min(contrast(destructiveText, bgApp), contrast(destructiveText, bgSurface)))
      .toBeGreaterThan(5)
  })

  it('the destructive FILL token is untouched, so buttons are not repainted', () => {
    // Darkening --destructive would change every destructive button background, where the
    // white foreground is already correct. That is a redesign, not an a11y fix.
    expect(css).toContain('--destructive: oklch(0.577 0.245 27.325)')
  })

  it('every destructive TEXT utility uses the new token', () => {
    const stale = execSync(
        `grep -rn 'text-destructive\\b' app components | grep -v 'text-destructive-text' | grep -v 'text-destructive-foreground' | grep -v globals.css || true`,
        { cwd: root, encoding: 'utf8' }
      )
      .trim()
    expect(stale, `still using the fill token as text:\n${stale}`).toBe('')
  })
})

describe('B-04-11 — the payout status badges pass AA', () => {
  const pairs: [string, string, string][] = [
    ['warning (Awaiting W-9)', 'badge-warning-text', 'badge-warning-bg'],
    ['success (Verified)', 'badge-success-text', 'badge-success-bg'],
    ['pending (In review)', 'badge-pending-text', 'badge-pending-bg'],
    ['rejected (Needs attention)', 'badge-rejected-text', 'badge-rejected-bg'],
  ]

  it.each(pairs)('%s clears 4.5:1 on its own badge background', (_name, fg, bg) => {
    expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(AA_NORMAL)
  })

  it('the badges no longer use raw Tailwind palette classes', () => {
    // amber-600 measures 3.11:1 and emerald-600 3.68:1 over --bg-surface. The finding
    // named only the amber one; all five in this element are fixed together.
    const src = read('components/coach/portfolio-tab.tsx')
    const jsx = src.split('\n').filter((l) => l.includes('payoutStatus ===') || l.includes('rounded-full'))
    for (const cls of ['text-amber-600', 'text-emerald-600', 'text-blue-600', 'text-red-600']) {
      expect(jsx.join('\n'), cls).not.toContain(cls)
    }
  })

  it('and the raw classes they replaced really did fail', () => {
    // Stated so the fix cannot be "simplified" back later by someone who assumes the
    // Tailwind palette is fine on this canvas.
    const surface = token('bg-surface')
    expect(contrast('#D97706', surface)).toBeLessThan(AA_NORMAL) // amber-600
    expect(contrast('#059669', surface)).toBeLessThan(AA_NORMAL) // emerald-600
  })
})

describe('B-04-12 — the dialog focus test can actually run', () => {
  const spec = read('tests/e2e/accessibility.spec.ts')

  it('it no longer skips when the fixture is in the wrong state', () => {
    expect(readCode('tests/e2e/accessibility.spec.ts')).not.toContain(
      'no dialog trigger on this dashboard state'
    )
  })

  it('it creates the state it needs and restores it', () => {
    const t = spec.slice(spec.indexOf('a dialog traps focus'))
    expect(t).toContain("update({ status: 'incubator' })")
    expect(t).toContain('finally')
    expect(t).toContain('update({ status: originalStatus })')
  })

  it('it asserts focus CONTAINMENT, forwards and backwards — not just entry', () => {
    // Entry alone passes for a dialog whose Tab walks straight out the back, which is the
    // failure mode both this and A-08-04 describe.
    const t = spec.slice(spec.indexOf('a dialog traps focus'), spec.indexOf('the global command palette traps focus'))
    expect(t).toContain("keyboard.press('Tab')")
    expect(t).toContain("keyboard.press('Shift+Tab')")
    expect(t).toContain('focus escaped the dialog')
  })

  it('and it still checks Escape plus focus restoration', () => {
    const t = spec.slice(spec.indexOf('a dialog traps focus'), spec.indexOf('the global command palette traps focus'))
    expect(t).toContain("keyboard.press('Escape')")
    expect(t).toContain('toBeFocused()')
  })
})

describe('A-08-04 — DID NOT REPRODUCE; the palette is already on a real Dialog', () => {
  const src = read('components/global-command-palette.tsx')

  it('it is rendered through the project Dialog, not a bare fixed-inset div', () => {
    // The finding describes a hand-rolled overlay. B-04-05 in the P1 sweep had already
    // rebuilt it on base-ui's Dialog, which supplies the focus trap, Escape handling and
    // focus restoration the finding asks for. Pinned so it cannot regress to a div.
    expect(src).toContain("from '@/components/ui/dialog'")
    expect(src).toContain('<Dialog open={open}')
    expect(src).toContain('<DialogContent')
  })

  it('Escape is left to the Dialog rather than being hand-handled', () => {
    // Two competing Escape handlers is how focus restoration breaks.
    expect(src).toContain('Escape is handled by the Dialog')
  })

  it('a live end-to-end check exists rather than inspection only', () => {
    // The finding was INFERRED and the P1 fix was build-verified only, because the palette
    // does not mount under the preview harnesses.
    const spec = read('tests/e2e/accessibility.spec.ts')
    expect(spec).toContain('the global command palette traps focus and restores it on Escape')
    expect(spec).toContain('focus escaped the palette')
    expect(spec).toContain('focus was dropped to <body>')
  })
})
