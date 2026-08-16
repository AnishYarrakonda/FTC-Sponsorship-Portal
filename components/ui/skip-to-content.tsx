/**
 * WCAG 2.2 — 2.4.1 Bypass Blocks.
 *
 * Every portal layout renders a persistent sidebar of 8–14 links before its `<main>`.
 * Without this, a keyboard or screen-reader user tabs through all of them on every
 * single page before reaching the content they came for.
 *
 * Rendered as the first child of the layout so it is the first focusable element in
 * the document, and styled off-canvas until focused (see `.skip-to-content` in
 * app/globals.css — `display:none` would make it unfocusable and therefore useless).
 *
 * The target `<main>` carries `id="main-content"` and `tabIndex={-1}`: without the
 * negative tabindex the browser moves the *scroll* position to the fragment but leaves
 * focus on the link, so the next Tab returns to the navigation and the skip does nothing.
 */
export function SkipToContent() {
  return (
    <a href="#main-content" className="skip-to-content">
      Skip to main content
    </a>
  )
}
