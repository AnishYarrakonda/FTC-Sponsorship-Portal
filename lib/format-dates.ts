/**
 * Canonical date formatting for financial surfaces.
 *
 * B-03-14. One receipt reported two different issue dates depending on which page you
 * printed it from. `/sponsor/funding` rendered `issued_at` through
 * `new Date(...).toLocaleDateString()` — the *viewer's* timezone — while the rendered
 * document at `/receipts/<n>` printed the UTC calendar date. For a sponsor west of UTC any
 * receipt issued before ~17:00 local reads a day earlier in the table than on the document
 * it links to. The same off-by-one landed on `payment_sent_at` / `payment_received_at`,
 * which both parties use to reconcile a cheque.
 *
 * The rule these helpers enforce:
 *
 *   A date that means "which calendar day did this happen on" is NOT a moment in the
 *   viewer's life. It is a fact about the transaction. Render it in UTC, always, on every
 *   surface, in one format.
 *
 * That is why nothing here calls `toLocaleDateString` without `timeZone: 'UTC'`. Use
 * `formatTransactionDate` for both `timestamptz` columns (issued_at, payment_sent_at, …)
 * and `date` columns (contribution_date) — it normalises both to the same string, which is
 * the property the finding actually needed.
 */

const TRANSACTION_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
}

/**
 * A bare `YYYY-MM-DD` is parsed by `new Date()` as UTC midnight, but a full timestamp is
 * parsed as an instant. Both are then formatted in UTC, so a `date` column and a
 * `timestamptz` column recorded on the same day render identically.
 */
export function formatTransactionDate(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-US', TRANSACTION_DATE_FORMAT)
}

/**
 * The compact form used inside dense timelines ("Sent 22 Aug"). Same UTC guarantee, and
 * `en-US` rather than the `en-GB` that had drifted into components/coach/funding-tab.tsx
 * while every other surface in the app used `en-US`.
 */
export function formatTransactionDateShort(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/**
 * The ISO calendar day, for anything that needs a sortable/machine value (CSV exports, the
 * receipt document's own stored fields). Also UTC.
 */
export function toUtcCalendarDate(value: string | Date | null | undefined): string {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().split('T')[0]
}
