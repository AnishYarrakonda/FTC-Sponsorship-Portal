import type { LucideIcon } from 'lucide-react'
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FileEdit,
  MailCheck,
  MailOpen,
  MailWarning,
  PauseCircle,
  PlayCircle,
  Send,
  TimerOff,
  XCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Canonical status badge for submission / sponsor / application statuses.
 * Always renders icon + label (never color-only) so states stay
 * distinguishable for colorblind users.
 */

type Tone = 'success' | 'pending' | 'warning' | 'rejected' | 'neutral'

const TONE_STYLES: Record<Tone, string> = {
  success: 'bg-[var(--badge-success-bg)] text-[var(--badge-success-text)] border-[var(--badge-success-text)]/25',
  pending: 'bg-[var(--badge-pending-bg)] text-[var(--badge-pending-text)] border-[var(--badge-pending-text)]/25',
  warning: 'bg-[var(--badge-warning-bg)] text-[var(--badge-warning-text)] border-[var(--badge-warning-text)]/25',
  rejected: 'bg-[var(--badge-rejected-bg)] text-[var(--badge-rejected-text)] border-[var(--badge-rejected-text)]/25',
  neutral: 'bg-muted text-muted-foreground border-border',
}

export const STATUS_CONFIG: Record<string, { label: string; tone: Tone; icon: LucideIcon }> = {
  // Submission lifecycle
  draft: { label: 'Draft', tone: 'pending', icon: FileEdit },
  pending: { label: 'Pending review', tone: 'pending', icon: Clock },
  dispatched: { label: 'Sent to sponsor', tone: 'warning', icon: Send },
  // `delivered` and `opened` are real submission_status values written by the Resend
  // webhook (app/api/webhooks/resend/route.ts). Neither had a config here, so a live
  // pitch rendered through FALLBACK as the raw lowercase string and effectively fell
  // out of both the admin and coach dashboards mid-flight.
  delivered: { label: 'Delivered to sponsor', tone: 'warning', icon: MailCheck },
  opened: { label: 'Opened by sponsor', tone: 'warning', icon: MailOpen },
  approved: { label: 'Approved', tone: 'success', icon: CheckCircle2 },
  declined: { label: 'Declined', tone: 'rejected', icon: XCircle },
  changes_requested: { label: 'Changes requested', tone: 'warning', icon: AlertCircle },
  expired: { label: 'Expired', tone: 'neutral', icon: TimerOff },
  bounced: { label: 'Bounced', tone: 'rejected', icon: MailWarning },
  // Sponsor directory
  active: { label: 'Active', tone: 'success', icon: PlayCircle },
  paused: { label: 'Paused', tone: 'warning', icon: PauseCircle },
  inactive: { label: 'Inactive', tone: 'neutral', icon: PauseCircle },
  // Sponsor applications
  rejected: { label: 'Rejected', tone: 'rejected', icon: XCircle },
}

const FALLBACK = { label: '', tone: 'neutral' as Tone, icon: AlertCircle }

export function statusLabel(status: string | null | undefined): string {
  if (!status) return 'Unknown'
  return STATUS_CONFIG[status]?.label ?? status.replace(/_/g, ' ')
}

export function StatusBadge({
  status,
  label,
  className,
  hideIcon = false,
}: {
  status: string | null | undefined
  /** Override the default label for this status (e.g. "New Request" for dispatched, sponsor-side). */
  label?: string
  className?: string
  hideIcon?: boolean
}) {
  const config = (status && STATUS_CONFIG[status]) || FALLBACK
  const Icon = config.icon
  const text = label ?? (config.label || statusLabel(status))

  return (
    <span
      className={cn(
        'inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium',
        TONE_STYLES[config.tone],
        className,
      )}
    >
      {!hideIcon && <Icon aria-hidden="true" className="h-3 w-3 shrink-0" strokeWidth={2} />}
      {text}
    </span>
  )
}
