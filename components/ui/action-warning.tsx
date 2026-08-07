import { AlertTriangle } from 'lucide-react'

/**
 * "It saved, but something after it did not."
 *
 * P0-11: several server actions compute a `warning` for exactly this case — the state
 * change committed, but a decision-critical side effect (the sponsor pitch email, the
 * coach notification, the profile link) failed. Nine actions returned one; **zero
 * components read it**. The admin saw a green "Approved & dispatched to sponsor!" toast
 * while the sponsor never received anything, capacity was already consumed, and no
 * retry path existed.
 *
 * Uses the --badge-warning-* tokens rather than Tailwind's `text-status-warning`, which the
 * accessibility pass measured at 2.68:1 against this background (needs 4.5:1). These
 * tokens were already defined in globals.css and unused.
 */
export function ActionWarning({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="flex w-full items-start gap-2 rounded-md border px-3 py-2 text-sm"
      style={{
        background: 'var(--badge-warning-bg)',
        color: 'var(--badge-warning-text)',
        borderColor: 'color-mix(in srgb, var(--badge-warning-text) 25%, transparent)',
      }}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </div>
  )
}
