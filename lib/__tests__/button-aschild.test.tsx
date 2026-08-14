// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button } from '@/components/ui/button'

/**
 * Regression: `<Button asChild>` used to throw
 * "React.Children.only expected to receive a single React element child".
 *
 * Radix's Slot accepts exactly one child, and Button rendered
 * `{loading && <Loader2/>}{children}` — two children, `[false, <a/>]` in the common case.
 * The throw happened during SSR, so the whole route fell to its error boundary: the coach
 * Portfolio, Funding and Recognition tabs each rendered "Something went wrong" instead of
 * their content, with no failing test and a passing build.
 *
 * The build cannot catch this (it is a runtime render error on dynamic routes) and neither
 * typecheck nor lint models Slot's arity, so it has to be a render test.
 */
describe('Button asChild', () => {
  it('renders its single child without throwing', () => {
    expect(() =>
      render(
        <Button asChild>
          <a href="/team/payout">Manage Payout Details</a>
        </Button>
      )
    ).not.toThrow()

    const link = screen.getByRole('link', { name: 'Manage Payout Details' })
    expect(link.getAttribute('href')).toBe('/team/payout')
    // Slot merges Button's classes onto the child rather than wrapping it in a <button>.
    expect(link.className).toContain('inline-flex')
  })

  it('still renders the spinner when it owns the element', () => {
    const { container } = render(<Button loading>Saving</Button>)
    expect(container.querySelector('button')).not.toBeNull()
    expect(container.querySelector('.animate-spin')).not.toBeNull()
  })

  it('asChild + loading does not smuggle a second child into Slot', () => {
    // The caller owns the element in asChild mode, so the spinner is theirs to place.
    // What must NOT happen is a throw.
    expect(() =>
      render(
        <Button asChild loading>
          <a href="/x">Go</a>
        </Button>
      )
    ).not.toThrow()
    expect(screen.getByRole('link', { name: 'Go' }).getAttribute('aria-busy')).toBe('true')
  })
})
