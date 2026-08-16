import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        premium:
          "bg-foreground text-background shadow-[0_8px_24px_-8px_rgba(0,0,0,0.4)] hover:-translate-y-px hover:shadow-[0_14px_28px_-10px_rgba(0,0,0,0.5)]",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        touch: "h-11 px-5",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {/*
          asChild MUST receive exactly one child. Radix's Slot calls
          React.Children.only, and `{loading && …}{children}` is two children — an array
          of [false, <Link/>] when not loading — so every `<Button asChild>` in the app
          threw "React.Children.only expected to receive a single React element child"
          and took its whole page down with it (the coach Portfolio, Funding and
          Recognition tabs all rendered the error boundary instead of the form).

          In asChild mode the caller owns the rendered element, so the spinner is theirs
          to place; injecting a sibling was never something Slot could honour.
        */}
        {asChild ? (
          children
        ) : (
          <>
            {/* Decorative — `aria-busy` on the button already conveys the loading state,
                so announcing the spinner as well is duplication, not information. */}
            {loading && <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />}
            {children}
          </>
        )}
      </Comp>
    )
  },
)
Button.displayName = "Button"

export { Button, buttonVariants }
