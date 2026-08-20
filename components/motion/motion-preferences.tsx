'use client'

import { MotionConfig } from 'framer-motion'

/**
 * Honours `prefers-reduced-motion` for every framer-motion animation in the tree.
 *
 * The CSS block in app/globals.css cannot reach these: framer-motion drives transforms
 * from JavaScript on each frame, so there is no CSS transition or animation for a media
 * query to shorten. `reducedMotion="user"` makes the library itself skip transform and
 * layout animation when the OS setting is on, while still allowing opacity — which is
 * what WCAG 2.3.3 is actually asking for (no motion, not no change).
 */
export function MotionPreferences({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>
}
