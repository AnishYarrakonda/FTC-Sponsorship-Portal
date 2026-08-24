"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

/**
 * P3 (accessibility polish). The audit noted that base-ui's `Popup` carries no
 * `aria-modal` and that nothing outside it is `inert`.
 *
 * The fix is NOT to hand-add `aria-modal`. That attribute is a promise that the rest of
 * the page is unreachable; adding it without making that true tells assistive tech to
 * ignore content the user can still tab into, which is worse than saying nothing.
 *
 * base-ui's own `modal` prop is the real mechanism: `true` traps focus, locks page scroll
 * and disables pointer interaction outside. It already defaults to `true`, so this is
 * explicit rather than a behaviour change — it is here so that passing `modal={false}`
 * becomes a visible, deliberate decision at the call site instead of an accident, and so
 * the reason is written down next to it.
 *
 * Containment is asserted end-to-end in tests/e2e/accessibility.spec.ts (B-04-12), for
 * both a page dialog and the command palette.
 */
function Dialog({ modal = true, ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" modal={modal} {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

/**
 * A real Tab/Shift+Tab wrap inside the dialog.
 *
 * WHY THIS EXISTS — found by driving a real dialog with a keyboard, not by inspection.
 *
 * base-ui 1.4.0 marks the rest of the document with `aria-hidden` and its own
 * `data-base-ui-inert` marker and relies on focus GUARD sentinels to keep Tab inside the
 * popup (floating-ui-react/utils/markOthers.js — `ariaHidden: modal`; it does NOT set the
 * native `inert` attribute, and `aria-hidden` does not remove anything from the tab order).
 * The guards leak. Measured on the coach dashboard's graduation dialog:
 *
 *   Tab 1-3   input -> Cancel -> Close        correct, inside the dialog
 *   Tab 4     focus guard                     the trap's sentinel
 *   Tab 5     <body>
 *   Tab 6     <a>Skip to main content</a>     ESCAPED into the page behind
 *   Tab 7-9   FTC Pitfund / Dashboard / Portfolio
 *
 * Shift+Tab leaked the same way, onto "View Inbox". So a keyboard user tabbing a modal
 * dialog ended up in the sidebar navigation while the dialog stayed on top and the page
 * behind was announced as hidden — the exact failure A-08-04 described.
 *
 * (It was previously judged "does not reproduce" because the component demonstrably renders
 * through a real `<Dialog>`. It does — the library's trap simply does not hold. This is why
 * the finding had to be driven rather than read; the audit's own hand-check stopped at Tab 4.)
 *
 * WHY A KEYDOWN WRAP RATHER THAN MAKING THE BACKGROUND `inert`
 *
 * Adding the native `inert` attribute to the background also fixes containment, and was
 * tried first. But `inert` has to be REMOVED before focus is restored to the trigger, and
 * base-ui's focus manager is a descendant of this component — React runs child cleanups
 * before parent cleanups, so the background was still inert at the moment of restoration
 * and the trigger silently refused focus. This wraps focus locally instead: it never
 * touches anything outside the popup, so nothing about restoration changes.
 */
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

function useFocusWrap(popupRef: React.RefObject<HTMLElement | null>) {
  return React.useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== 'Tab' || event.defaultPrevented) return
      const popup = popupRef.current
      if (!popup) return

      const focusable = Array.from(popup.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        // offsetParent is null for display:none; a zero-size element is not reachable either.
        (el) => el.offsetParent !== null || el.getClientRects().length > 0
      )
      if (focusable.length === 0) {
        // Nothing to move to — keep focus on the popup rather than letting it leave.
        event.preventDefault()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement as HTMLElement | null

      if (event.shiftKey && (active === first || !popup.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !popup.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    },
    [popupRef]
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
}) {
  const popupRef = React.useRef<HTMLElement | null>(null)
  const onKeyDown = useFocusWrap(popupRef)

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        ref={popupRef as never}
        onKeyDown={onKeyDown}
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-2 right-2 h-6 w-6 rounded-md"
                size="icon"
              />
            }
          >
            <XIcon
            />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
