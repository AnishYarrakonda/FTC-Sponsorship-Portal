'use client'

import { useOptimistic, useState, useTransition } from 'react'
import { Bell, Calendar, CheckCircle2, ChevronDown, ChevronUp, XCircle, AlertCircle } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import { markNotificationRead } from '@/app/actions/notifications'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Notification } from '@/lib/supabase/types'

function getIcon(type: string) {
  switch (type) {
    case 'submission_declined': return <XCircle aria-hidden="true" className="text-rose-500 h-5 w-5" />
    case 'submission_approved': return <CheckCircle2 aria-hidden="true" className="text-emerald-600 h-5 w-5" />
    case 'submission_changes_requested': return <AlertCircle aria-hidden="true" className="text-amber-500 h-5 w-5" />
    default: return <AlertCircle aria-hidden="true" className="text-muted-foreground h-5 w-5" />
  }
}

function NotificationCard({
  notification: n,
  onOpen,
  onMarkRead,
}: {
  notification: Notification
  onOpen: () => void
  onMarkRead: (id: string) => void
}) {
  const unread = !n.read_at
  return (
    <motion.div
      layout
      animate={{ opacity: unread ? 1 : 0.65 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className={cn(
        'p-5 rounded-xl border flex items-start gap-4 cursor-pointer transition-all shadow-sm bg-card',
        unread
          ? 'border-primary/25 hover:border-primary/40 hover:shadow-md'
          : 'border-border border-dashed hover:border-border/80',
      )}
      onClick={onOpen}
    >
      <div className="mt-0.5 shrink-0">{getIcon(n.type)}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {unread && (
            <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
          )}
          <h3 className={cn('text-sm truncate text-foreground', unread ? 'font-semibold' : 'font-medium')}>
            {n.title}
            {unread && <span className="sr-only"> (unread)</span>}
          </h3>
        </div>
        <div className="text-sm text-muted-foreground mt-1.5 whitespace-pre-wrap leading-relaxed">{n.body}</div>
        <div className="text-xs text-muted-foreground mt-3 flex items-center gap-1.5 font-mono">
          <Calendar aria-hidden="true" className="h-3 w-3" />
          {new Date(n.created_at).toLocaleDateString()}
        </div>
      </div>
      {unread && (
        <button
          onClick={(e) => { e.stopPropagation(); onMarkRead(n.id) }}
          aria-label={`Mark "${n.title}" as read`}
          className="text-xs font-medium text-primary hover:text-primary/90 bg-primary/5 hover:bg-primary/10 px-2.5 py-1.5 rounded-md transition-colors whitespace-nowrap shrink-0 border border-primary/10"
        >
          Mark as read
        </button>
      )}
    </motion.div>
  )
}

export function InboxTab({ notifications, switchTab }: { notifications: Notification[], switchTab: (t: string) => void }) {
  const [, startTransition] = useTransition()
  const [showRead, setShowRead] = useState(false)

  const [optimisticNotifications, markRead] = useOptimistic(
    notifications,
    (state, id: string) =>
      state.map(n => n.id === id ? { ...n, read_at: new Date().toISOString() } : n)
  )

  const handleRead = (id: string) => {
    startTransition(async () => {
      markRead(id)
      const result = await markNotificationRead(id)
      if (result?.error) {
        toast.error('Could not mark notification as read. Please try again.')
      }
    })
  }

  const unread = optimisticNotifications.filter(n => !n.read_at)
  const read = optimisticNotifications.filter(n => !!n.read_at)

  if (optimisticNotifications.length === 0) {
    return (
      <div className="max-w-3xl mx-auto pb-20">
        <EmptyState
          icon={Bell}
          title="No notifications yet"
          description="Decisions and updates about your pitches will land here — and in your email."
          action={
            <Button variant="outline" size="sm" onClick={() => switchTab('pitches')}>
              View your pitches
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="space-y-4 max-w-3xl mx-auto pb-20">
      {/* Unread */}
      <AnimatePresence initial={false}>
        {unread.map((n) => (
          <NotificationCard
            key={n.id}
            notification={n}
            onOpen={() => n.submission_id && switchTab('submissions')}
            onMarkRead={handleRead}
          />
        ))}
      </AnimatePresence>

      {unread.length === 0 && (
        <p className="rounded-xl border border-dashed border-border bg-card/50 px-6 py-6 text-center text-sm text-muted-foreground">
          All caught up — no unread notifications.
        </p>
      )}

      {/* Read — collapsed by default to keep the inbox focused */}
      {read.length > 0 && (
        <div className="pt-2">
          <button
            onClick={() => setShowRead(s => !s)}
            aria-expanded={showRead}
            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-mono uppercase tracking-widest text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
          >
            <span>Read ({read.length})</span>
            {showRead
              ? <ChevronUp aria-hidden="true" className="h-3.5 w-3.5" />
              : <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />}
          </button>
          {showRead && (
            <div className="mt-3 space-y-4">
              <AnimatePresence initial={false}>
                {read.map((n) => (
                  <NotificationCard
                    key={n.id}
                    notification={n}
                    onOpen={() => n.submission_id && switchTab('submissions')}
                    onMarkRead={handleRead}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
