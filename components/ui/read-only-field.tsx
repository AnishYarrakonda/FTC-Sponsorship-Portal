import { cn } from '@/lib/utils'

/**
 * A value the user can see but never edit.
 *
 * B-04-07. Read-only values were rendered as `<input disabled value="…">` with no `id`,
 * no `<label htmlFor>` and no `aria-label`, while every genuinely editable field beside
 * them was labelled correctly. A screen reader announced "disabled edit text,
 * sponsor@example.com" with no indication of what the value was — and on the payout form
 * the value is a masked EIN, where "which field is this" is the entire question.
 * WCAG 4.1.2 Name, Role, Value (A) and 1.3.1 Info and Relationships (A).
 *
 * The fix is not to bolt a label onto the input. A disabled input is the wrong element for
 * a value that can never be edited: it claims a form-control role it does not have, sits in
 * a form's value space, and carries a naming obligation it was failing. Rendering the pair
 * as a description list removes the obligation rather than satisfying it — `<dt>` IS the
 * name of `<dd>`, natively, with no id wiring to get wrong.
 *
 * Styled to sit in the same visual rhythm as the Input it replaces, so the forms still read
 * as forms.
 */
export function ReadOnlyField({
  label,
  value,
  hint,
  className,
  valueClassName,
}: {
  label: string
  value: React.ReactNode
  /** Optional helper text below the value. */
  hint?: React.ReactNode
  className?: string
  valueClassName?: string
}) {
  return (
    <dl className={cn('flex flex-col gap-1.5', className)}>
      <dt className="text-sm font-medium leading-none">{label}</dt>
      <dd
        className={cn(
          'flex h-9 w-full items-center rounded-md border border-input bg-muted px-3 py-1 text-base text-muted-foreground md:text-sm',
          valueClassName
        )}
      >
        {value}
      </dd>
      {hint && <dd className="text-xs text-muted-foreground">{hint}</dd>}
    </dl>
  )
}
