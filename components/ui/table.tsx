import * as React from "react"
import { cn } from "@/lib/utils"

const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
  <div className="relative w-full overflow-auto">
    <table
      ref={ref}
      className={cn("w-full caption-bottom", className)}
      style={{ fontSize: "14px" }}
      {...props}
    />
  </div>
))
Table.displayName = "Table"

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn("", className)} {...props} />
))
TableHeader.displayName = "TableHeader"

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn("", className)} {...props} />
))
TableBody.displayName = "TableBody"

const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn("group/row transition-[background] duration-100 linear hover:bg-[var(--bg-hover)]", className)}
    style={{
      height: "44px",
      borderBottom: "1px solid var(--border-color)",
    }}
    {...props}
  />
))
TableRow.displayName = "TableRow"

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    /* P3. No `scope` existed anywhere in the codebase while seven files render <th>.
       Without it a screen reader has to guess which cells a header governs, and guesses
       wrong on any table that is not trivially rectangular. `scope="col"` is right for
       every current use; a row header would pass scope="row" through ...props. */
    scope="col"
    className={cn("px-2 text-left align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]", className)}
    style={{
      fontSize: "12px",
      textTransform: "uppercase",
      letterSpacing: "0.02em",
      color: "var(--text-muted)",
      fontWeight: 500,
      borderBottom: "1px solid var(--border-color)",
      paddingBottom: "8px",
    }}
    {...props}
  />
))
TableHead.displayName = "TableHead"

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement> & { isFirst?: boolean }
>(({ className, isFirst, ...props }, ref) => (
  <td
    ref={ref}
    className={cn("p-2 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]", className)}
    style={{
      color: isFirst ? "var(--text-primary)" : "var(--text-secondary)",
      fontWeight: isFirst ? 500 : 400,
    }}
    {...props}
  />
))
TableCell.displayName = "TableCell"

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn("mt-4 text-sm", className)}
    style={{ color: "var(--text-secondary)" }}
    {...props}
  />
))
TableCaption.displayName = "TableCaption"

function MonoChip({ children, className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn("", className)}
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: "12px",
        background: "var(--bg-elevated)",
        padding: "2px 6px",
        borderRadius: "4px",
        color: "var(--text-primary)",
      }}
      {...props}
    >
      {children}
    </span>
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
  MonoChip,
}
