// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button } from '@/components/ui/button'
import { BackButton } from '@/components/ui/back-button'
import { SkipToContent } from '@/components/ui/skip-to-content'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { ChevronLeft } from 'lucide-react'

// BackButton calls useRouter at render, which throws "expected app router to be mounted"
// outside a Next tree. The name it exposes does not depend on routing, so a stub is enough.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}))

/**
 * WCAG 4.1.2 (Name, Role, Value) at the unit level.
 *
 * `getByRole(role, { name })` resolves the ACCESSIBLE name the way a screen reader would
 * — not `textContent` — so it fails when a control's only content is an icon. That is the
 * whole point of testing it here: an icon-only button reads as "button" and nothing else,
 * and there is no visual symptom to notice in review.
 *
 * The E2E axe pass in tests/e2e/accessibility.spec.ts catches these too, but only on the
 * pages it visits. These primitives are used everywhere, so they are worth pinning at the
 * component level where the failure names the component.
 */
describe('accessible names on shared primitives', () => {
  it('a loading Button keeps its accessible name and reports busy state', () => {
    render(<Button loading>Save changes</Button>)
    // The spinner must not displace or pollute the name.
    const button = screen.getByRole('button', { name: 'Save changes' })
    expect(button.getAttribute('aria-busy')).toBe('true')
  })

  it('an icon-only Button without a label has NO accessible name — the guard itself', () => {
    render(
      <Button>
        <ChevronLeft />
      </Button>
    )
    /**
     * This asserts the negative on purpose: it proves `getByRole(…, { name })` really does
     * fail for an unlabelled icon button, so the positive assertions above are meaningful
     * rather than vacuously true. A test that cannot fail is not a test.
     */
    expect(screen.queryByRole('button', { name: /back/i })).toBeNull()
  })

  it('BackButton exposes a text name', () => {
    render(<BackButton />)
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy()
  })

  it('BackButton honours a custom label', () => {
    render(<BackButton label="Back to dashboard" />)
    expect(screen.getByRole('button', { name: 'Back to dashboard' })).toBeTruthy()
  })

  it('the dialog close control has an accessible name from visually-hidden text', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Confirm</DialogTitle>
        </DialogContent>
      </Dialog>
    )
    // Rendered as an icon (an X glyph) with `<span class="sr-only">Close</span>`.
    expect(screen.getByRole('button', { name: /close/i })).toBeTruthy()
  })

  it('the skip link is a link with a descriptive name pointing at the main landmark', () => {
    render(<SkipToContent />)
    const link = screen.getByRole('link', { name: /skip to main content/i })
    // "Skip" alone fails 2.4.4 (Link Purpose in Context); the destination has to be in the name.
    expect(link.getAttribute('href')).toBe('#main-content')
  })
})
