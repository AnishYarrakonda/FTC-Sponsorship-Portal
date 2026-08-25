'use client'

import { useEffect, useState } from 'react'
import { motion, useMotionValue, useSpring } from 'framer-motion'

export function RoboticsCursor() {
  const [isVisible, setIsVisible] = useState(false)
  
  // Motion values for the custom cursor ring
  const cursorX = useMotionValue(-100)
  const cursorY = useMotionValue(-100)

  // Smooth springs for the trailing effect
  const springConfig = { damping: 25, stiffness: 300, mass: 0.5 }
  const cursorXSpring = useSpring(cursorX, springConfig)
  const cursorYSpring = useSpring(cursorY, springConfig)

  useEffect(() => {
    // Disable on touch devices
    if (window.matchMedia('(pointer: coarse)').matches) return

    const updateCursor = (e: MouseEvent) => {
      cursorX.set(e.clientX - 16) // Offset by half the width/height (32/2)
      cursorY.set(e.clientY - 16)
      if (!isVisible) setIsVisible(true)
    }

    const handleMouseLeave = () => setIsVisible(false)
    const handleMouseEnter = () => setIsVisible(true)

    window.addEventListener('mousemove', updateCursor)
    document.addEventListener('mouseleave', handleMouseLeave)
    document.addEventListener('mouseenter', handleMouseEnter)

    return () => {
      window.removeEventListener('mousemove', updateCursor)
      document.removeEventListener('mouseleave', handleMouseLeave)
      document.removeEventListener('mouseenter', handleMouseEnter)
    }
  }, [cursorX, cursorY, isVisible])

  return (
    <motion.div
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        width: 32,
        height: 32,
        x: cursorXSpring,
        y: cursorYSpring,
        pointerEvents: 'none',
        zIndex: 99999,
        opacity: isVisible ? 1 : 0,
      }}
      className="hidden md:flex items-center justify-center mix-blend-difference"
    >
      <div className="w-8 h-8 rounded-full border border-primary/50 shadow-[0_0_10px_rgba(31,111,92,0.5)] transition-transform duration-300 ease-out" />
    </motion.div>
  )
}
