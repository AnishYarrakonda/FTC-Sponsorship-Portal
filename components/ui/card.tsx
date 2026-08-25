import * as React from "react"

import { cn } from "@/lib/utils"

function Card({
  className,
  size = "default",
  ...props
}: React.ComponentProps<"div"> & { size?: "default" | "sm" }) {
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn(
        "group/card flex flex-col gap-4 overflow-hidden text-sm data-[size=sm]:gap-3",
        className
      )}
      style={{
        backgroundColor: "rgba(255, 252, 247, 0.65)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        border: "1px solid rgba(231, 225, 214, 0.6)",
        borderRadius: "12px",
        padding: "20px 24px",
        color: "var(--text-primary)",
        boxShadow: "0 8px 32px rgba(0, 0, 0, 0.03)",
      }}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "@container/card-header grid auto-rows-min items-start gap-1 has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto]",
        className
      )}
      {...props}
    />
  )
}

/**
 * Two accessibility defects fixed here (report §14), across 31 usages in 20 files:
 *
 *  1. This rendered a <div>, so pages whose only title was a CardTitle had ZERO headings
 *     in the document — `document.querySelectorAll('h1..h6').length === 0` on both /login
 *     and /sponsors/apply. Screen-reader users navigate by heading; there was nothing to
 *     navigate. Now renders a real heading, with `as` to pick the right level for the
 *     page's outline (h3 is the safe default inside a card).
 *
 *  2. The inline `fontSize: "15px"` BEAT every className, so the 12 call sites passing
 *     `text-2xl` / `text-xl` silently rendered at 15px. Sizing moved into the default
 *     class list, where a caller's className can legitimately override it.
 */
function CardTitle({
  className,
  as: Comp = "h3",
  ...props
}: React.ComponentProps<"h3"> & { as?: "h1" | "h2" | "h3" | "h4" }) {
  return (
    <Comp
      data-slot="card-title"
      className={cn("text-[15px] font-medium leading-snug text-[var(--text-primary)]", className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm", className)}
      style={{ color: "var(--text-secondary)" }}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className)}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center", className)}
      style={{
        borderTop: "1px solid var(--border-color)",
        padding: "16px 0 0",
        marginTop: "auto",
      }}
      {...props}
    />
  )
}

function CardEmpty({
  icon: Icon,
  title,
  subtitle,
  action,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  icon?: React.ComponentType<any>
  title?: string
  subtitle?: string
  action?: React.ReactNode
}) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center text-center", className)}
      style={{ minHeight: "200px" }}
      {...props}
    >
      {Icon && (
        <Icon size={32} style={{ color: "var(--text-muted)" }} />
      )}
      {title && (
        <p style={{ fontSize: "15px", fontWeight: 500, color: "var(--text-primary)", marginTop: "12px" }}>
          {title}
        </p>
      )}
      {subtitle && (
        <p style={{ fontSize: "14px", color: "var(--text-secondary)", maxWidth: "320px", margin: "0 auto", lineHeight: 1.5 }}>
          {subtitle}
        </p>
      )}
      {action && <div style={{ marginTop: "16px" }}>{action}</div>}
    </div>
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
  CardEmpty,
}
