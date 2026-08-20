/**
 * One rendering of an appeal's status, shared by the list, the detail page, and the
 * dashboard row — so the five states cannot drift apart across three components.
 */
const STATUS: Record<string, { label: string; className: string }> = {
  open: {
    label: 'Awaiting review',
    className: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200',
  },
  under_review: {
    label: 'Under review',
    className: 'border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-200',
  },
  upheld: {
    label: 'Decision stands',
    className: 'border-border bg-muted text-muted-foreground',
  },
  overturned: {
    label: 'Appeal successful',
    className: 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200',
  },
  withdrawn: {
    label: 'Withdrawn',
    className: 'border-border bg-muted text-muted-foreground',
  },
}

export function AppealStatusPill({ status }: { status: string }) {
  const copy = STATUS[status] ?? STATUS.open
  return (
    <span
      className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${copy.className}`}
    >
      {copy.label}
    </span>
  )
}
