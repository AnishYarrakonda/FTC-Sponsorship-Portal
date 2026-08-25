'use client'

import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { GooeyText } from '@/components/ui/gooey-text-morphing'

const SEEN_KEY = 'ftcmm:intro-seen'
const LOADER_MS = 3500

export function InitialLoader() {
  // Start hidden and opt IN on the client. Measured against production, this overlay is
  // the LCP element of the marketing page (a GooeyText span, not any real content) and
  // holds document.body.style.overflow = 'hidden' for 3.5 s plus a 0.6 s fade — ~4.1 s
  // of scroll-locked screen before a visitor can read anything. With no persistence, a
  // repeat visitor paid it on every single navigation to `/`.
  const [isLoading, setIsLoading] = useState(false)
  const loaderTexts = useMemo(() => ["FTC", "Sponsorships", "Simplified"], [])

  useEffect(() => {
    // Show it at most once per browser session, and never to someone who has asked for
    // reduced motion (WCAG 2.3.3 / 2.2.2 — it is a non-essential looping animation).
    let alreadySeen = false
    try {
      alreadySeen = window.sessionStorage.getItem(SEEN_KEY) === '1'
    } catch {
      // Private mode / storage disabled: treat as unseen rather than crashing.
    }

    const prefersReducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (alreadySeen || prefersReducedMotion) {
      setIsLoading(false)
      document.body.style.overflow = ''
      document.documentElement.style.overflow = ''
      window.dispatchEvent(new CustomEvent('initial-loader-complete'))
      return
    }

    try {
      window.sessionStorage.setItem(SEEN_KEY, '1')
    } catch {
      // Non-fatal.
    }

    setIsLoading(true)

    // Lock scroll on both body and html element for maximum compatibility
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'

    const timer = setTimeout(() => {
      setIsLoading(false)
      // Unlock scroll
      document.body.style.overflow = ''
      document.documentElement.style.overflow = ''
      window.dispatchEvent(new CustomEvent('initial-loader-complete'))
    }, LOADER_MS)

    return () => {
      clearTimeout(timer)
      document.body.style.overflow = ''
      document.documentElement.style.overflow = ''
    }
  }, [])

  return (
    <AnimatePresence>
      {isLoading && (
        <motion.div
          key="loader"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6, ease: "easeInOut" }}
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background"
          style={{ willChange: "opacity" }}
          // The overlay set neither, so during the freeze a keyboard user could Tab onto
          // controls they could not see, and a screen reader announced the page behind it.
          aria-hidden="true"
          inert
        >
          <div className="flex flex-col items-center justify-center w-full max-w-sm h-full">
            <GooeyText 
              texts={loaderTexts}
              morphTime={0.8}
              cooldownTime={0.7}
              loop={false}
              className="w-full"
              textClassName="text-foreground font-bold tracking-tighter"
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
