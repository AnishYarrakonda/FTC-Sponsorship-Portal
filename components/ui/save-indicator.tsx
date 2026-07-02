'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, AlertCircle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

interface SaveIndicatorProps {
  state: SaveState
  className?: string
}

export function SaveIndicator({ state, className }: SaveIndicatorProps) {
  const [savedAt, setSavedAt] = useState<Date | null>(null)

  useEffect(() => {
    if (state === 'saved') setSavedAt(new Date())
  }, [state])

  const timeLabel = savedAt
    ? savedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : ''

  return (
    <span role="status" aria-live="polite">
      <AnimatePresence mode="wait">
        {state !== 'idle' && (
          <motion.span
          key={state}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          className={cn('inline-flex items-center gap-1.5 text-sm select-none', className)}
        >
          {state === 'saving' && (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              <span className="text-muted-foreground">Saving…</span>
            </>
          )}
          {state === 'saved' && (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
              <span className="text-muted-foreground">
                Last saved at <span className="tabular-nums">{timeLabel}</span>
              </span>
            </>
          )}
          {state === 'error' && (
            <>
              <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
              <span className="text-destructive">Autosave failed</span>
            </>
          )}
        </motion.span>
        )}
      </AnimatePresence>
    </span>
  )
}
