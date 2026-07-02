import { cn } from '@/lib/utils'

/**
 * macOS-style browser-chrome traffic-light dots, used by the landing-page
 * product mocks. Colors come from the design tokens in globals.css.
 */
export function WindowDots({
  size = 'sm',
  className,
}: {
  /** sm = 10px dots (product mocks), md = 12px dots (hero chrome) */
  size?: 'sm' | 'md'
  className?: string
}) {
  const dot = cn('rounded-full', size === 'md' ? 'h-3 w-3' : 'h-2.5 w-2.5')
  return (
    <span aria-hidden="true" className={cn('flex items-center gap-1.5', className)}>
      <span className={cn(dot, 'bg-window-dot-close')} />
      <span className={cn(dot, 'bg-window-dot-minimize')} />
      <span className={cn(dot, 'bg-window-dot-maximize')} />
    </span>
  )
}
