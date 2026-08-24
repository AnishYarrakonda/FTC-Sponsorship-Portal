'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from 'cmdk'
import { LayoutDashboard, BookOpen, Target, Inbox, Settings, LogOut, Building2, Users, Search } from 'lucide-react'
import { useClerk } from '@clerk/nextjs'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent } from '@/components/ui/dialog'

interface RunCtx {
  router: ReturnType<typeof useRouter>
  signOut: () => void
}

interface PaletteAction {
  label: string
  group: string
  icon: React.ReactNode
  run: (ctx: RunCtx) => void
}

const coachActions: PaletteAction[] = [
  { label: 'Home',           group: 'Navigate', icon: <LayoutDashboard className="h-4 w-4" />, run: ({ router }) => router.push('/dashboard') },
  { label: 'Portfolio',      group: 'Navigate', icon: <BookOpen className="h-4 w-4" />,        run: ({ router }) => router.push('/dashboard?tab=portfolio') },
  { label: 'Sponsors',       group: 'Navigate', icon: <Target className="h-4 w-4" />,          run: ({ router }) => router.push('/dashboard?tab=sponsors') },
  { label: 'Inbox',          group: 'Navigate', icon: <Inbox className="h-4 w-4" />,           run: ({ router }) => router.push('/dashboard?tab=inbox') },
  { label: 'Settings',       group: 'Navigate', icon: <Settings className="h-4 w-4" />,        run: ({ router }) => router.push('/dashboard?tab=settings') },
]

const adminActions: PaletteAction[] = [
  { label: 'Dashboard',       group: 'Navigate', icon: <LayoutDashboard className="h-4 w-4" />, run: ({ router }) => router.push('/admin') },
  { label: 'Review',          group: 'Navigate', icon: <Inbox className="h-4 w-4" />,           run: ({ router }) => router.push('/moderation') },
  { label: 'Sponsors',        group: 'Navigate', icon: <Building2 className="h-4 w-4" />,       run: ({ router }) => router.push('/sponsors') },
  { label: 'Teams',           group: 'Navigate', icon: <Users className="h-4 w-4" />,           run: ({ router }) => router.push('/coaches') },
]

const accountActions: PaletteAction[] = [
  { label: 'Sign Out', group: 'Account', icon: <LogOut className="h-4 w-4" />, run: ({ signOut }) => signOut() },
]

interface Props {
  role?: 'coach' | 'admin' | 'sponsor' | null
}

export function GlobalCommandPalette({ role }: Props) {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const { signOut } = useClerk()

  const navActions = role === 'admin' ? adminActions : coachActions
  const allActions = [...navActions, ...accountActions]

  const handleSelect = useCallback((action: PaletteAction) => {
    setOpen(false)
    action.run({ router, signOut: () => signOut({ redirectUrl: '/login' }) })
  }, [router, signOut])

  /**
   * A-08-04, second half. The palette has no `<DialogTrigger>` — it is opened by a global
   * Cmd/Ctrl-K handler — so base-ui has no opener element to hand focus back to, and
   * closing it dropped focus to `<body>`. Verified live: Escape left `document.activeElement
   * === document.body`, which is the "forcing them to traverse the entire page again"
   * outcome the finding describes (WCAG 2.4.3 Focus Order).
   *
   * A dialog opened from a keyboard shortcut still has an opener — it is simply whatever
   * had focus at the moment the shortcut fired. Capture it on the way in, and hand it to
   * base-ui as the dialog's `finalFocus` so its OWN restoration targets it.
   *
   * Restoring from a `useEffect` here was tried first and does not hold: base-ui runs its
   * focus restoration during the same close, so a `requestAnimationFrame` restore either
   * fires before base-ui's (and is overwritten with `body`) or after it (and fights it).
   * `finalFocus` is the supported seam — there is exactly one restoration, and it goes to
   * the right element.
   */
  const openerRef = useRef<HTMLElement | null>(null)

  /**
   * A detached opener means `handleSelect` navigated and the destination page owns focus
   * now; `true` hands base-ui back its default behaviour rather than focusing a node that
   * is no longer in the document.
   */
  const finalFocus = useCallback(
    () => (openerRef.current?.isConnected ? openerRef.current : true),
    []
  )

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        // Captured here rather than inside the `setOpen` updater: React may call an
        // updater during render (and twice under StrictMode), which is the wrong moment
        // to be reading `document.activeElement`.
        //
        // The "is it already open" test is the DOM rather than a ref mirroring `open`,
        // because a ref written during render is a render-phase side effect. Cmd+K while
        // the palette is open means focus is inside the popup, and capturing that would
        // replace the real opener with a node that is about to unmount.
        const active = document.activeElement
        const insidePalette =
          active instanceof HTMLElement && !!active.closest('[role="dialog"]')
        if (!insidePalette) {
          openerRef.current =
            active instanceof HTMLElement && active !== document.body ? active : null
        }
        setOpen((o) => !o)
      }
      // Escape is handled by the Dialog now. Keeping a second handler here would close the
      // palette before the Dialog could run its own teardown.
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [])

  /**
   * B-04-05 (1, 2, 3). This was a bare `fixed inset-0` div: no role="dialog", no
   * aria-modal, no accessible name, no focus containment and no focus restoration.
   * Querying `[role="dialog"]` while it was open returned null, Tab walked straight out
   * into the page behind it while the palette stayed on top, and Escape left focus on
   * whatever background nav link Tab had reached.
   *
   * Rendered through the project's own base-ui Dialog rather than hand-rolling a focus
   * trap: that component already contains focus and restores it to the trigger, and it
   * was measured doing so correctly in the same audit. A hand-rolled trap is exactly the
   * kind of thing that works in a demo and fails on the one control nobody tested.
   */
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        finalFocus={finalFocus}
        aria-label="Command palette"
        className="top-[15vh] left-1/2 w-full max-w-lg -translate-x-1/2 translate-y-0 gap-0 overflow-hidden rounded-2xl border border-border bg-card p-0 shadow-2xl sm:max-w-lg"
      >
        {/* The visible chrome lives inside the dialog popup, so the popup itself is the
            focus scope — the panel div no longer needs to exist. */}
        <div className="w-full">
        <Command className="flex flex-col" shouldFilter>
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <CommandInput
              placeholder="Search actions…"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              autoFocus
            />
            <kbd className="hidden sm:inline-flex items-center rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              esc
            </kbd>
          </div>

          <CommandList className="max-h-80 overflow-y-auto py-2">
            <CommandEmpty className="py-6 text-center text-sm text-muted-foreground">
              No results found.
            </CommandEmpty>

            {(['Navigate', 'Account'] as const).map((group) => {
              const items = allActions.filter((a) => a.group === group)
              if (items.length === 0) return null
              // B-04-05 (4). The extra <span> sat DIRECTLY inside cmdk's role="listbox",
              // which may only contain option/group children — axe flags it
              // aria-required-children (critical), and the consequence is real: option
              // count and position stop being conveyed, so a screen reader cannot say
              // "2 of 5". CommandGroup's own `heading` prop already renders this text
              // with the correct role, so the span was pure duplication. Styled through
              // cmdk's heading part instead.
              return (
                <CommandGroup
                  key={group}
                  heading={group}
                  className="px-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-muted-foreground"
                >
                  {items.map((action) => (
                    <CommandItem
                      key={action.label}
                      value={action.label}
                      onSelect={() => handleSelect(action)}
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-sm text-foreground',
                        'aria-selected:bg-accent aria-selected:text-foreground',
                        'data-[selected=true]:bg-accent data-[selected=true]:text-foreground',
                      )}
                    >
                      <span className="text-muted-foreground">{action.icon}</span>
                      {action.label}
                    </CommandItem>
                  ))}
                  {group !== 'Account' && <CommandSeparator className="my-1 border-t border-border" />}
                </CommandGroup>
              )
            })}
          </CommandList>

          <div className="border-t border-border px-4 py-2 flex items-center gap-3 text-[10px] text-muted-foreground">
            <span><kbd className="font-mono">↑↓</kbd> navigate</span>
            <span><kbd className="font-mono">↵</kbd> open</span>
            <span><kbd className="font-mono">esc</kbd> close</span>
          </div>
        </Command>
        </div>
      </DialogContent>
    </Dialog>
  )
}
