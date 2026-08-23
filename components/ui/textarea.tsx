import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * P3 (accessibility polish), plus one real defect the pack did not name.
 *
 * WHAT THE AUDIT SAID, AND WHAT IT GOT RIGHT
 *
 * The finding measured the focus treatment at 4.49:1 between rest and focus and 5.29:1
 * against the field background, and concluded it **passes** 2.4.7 Focus Visible and 1.4.11
 * Non-text Contrast. Both figures reproduce exactly. It asked only that the 1px border be
 * aligned with the 2px ring the rest of the app uses, for consistency — not as a fix.
 *
 * WHAT IT MISSED
 *
 * The REST border was `--border-color` (#E7E1D6), which is **1.18:1** against this field's
 * own background (`--bg-app` #F7F3EE). 1.4.11 requires 3:1 for the boundary of a UI
 * component, so the unfocused textarea failed it — the field read as a ghost.
 *
 * `Input` had exactly this problem and was already fixed: `globals.css` defines `--input`
 * (#95886F) as "form-control borders only", chosen as the lightest value in the hue family
 * clearing 3:1 on all three app surfaces. It measures **3.15:1** here. Textarea simply
 * never got the same treatment, because it hand-rolled its border in an inline style
 * instead of using the `border-input` class the rest of the controls share.
 *
 * So this component now uses the shared tokens and the shared focus ring, which fixes the
 * rest-state contrast AND delivers the consistency the finding asked for. The inline
 * onFocus/onBlur border swap is gone with it — it fought `:focus-visible`, so a keyboard
 * user and a mouse user got the same treatment when only one of them should.
 */
function Textarea({ className, style, ...props }: React.ComponentProps<"textarea"> & { style?: React.CSSProperties }) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
        "ring-offset-background placeholder:text-muted-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      style={{ resize: "vertical", ...style }}
      {...props}
    />
  )
}
Textarea.displayName = "Textarea"

export { Textarea }
