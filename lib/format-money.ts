/**
 * Canonical currency formatting.
 *
 * A-07-03. Money was rendered two different ways in the same product. Twenty-eight call
 * sites divided by 100 and called toLocaleString with no options, which drops the cents
 * entirely — 50000 renders as "$500" and 123450 renders as "$1,234.5" — while twenty-five
 * others passed minimumFractionDigits and got it right. A sponsor's funding page could
 * therefore show "$1,234.5" committed next to "$1,234.50" on the receipt for the same
 * money.
 *
 * All amounts in this system are integer CENTS. Never divide before you have to, never
 * store or compare the float, and never render one without both fraction-digit bounds:
 * `maximumFractionDigits` is what stops floating-point division producing "$12.340000001",
 * and `minimumFractionDigits` is what stops it producing "$12.3".
 */

const MONEY_FORMAT: Intl.NumberFormatOptions = {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}

/** Integer cents -> "$1,234.50". Null/undefined render as "$0.00". */
export function formatMoney(cents: number | null | undefined): string {
  const value = typeof cents === 'number' && Number.isFinite(cents) ? cents : 0
  return (value / 100).toLocaleString('en-US', MONEY_FORMAT)
}

/**
 * Integer cents -> "1,234.50", with no symbol, for call sites that render their own `$`
 * (a large stat tile that styles the sign separately, a CSV column). Same digit rules.
 */
export function formatMoneyAmount(cents: number | null | undefined): string {
  const value = typeof cents === 'number' && Number.isFinite(cents) ? cents : 0
  return (value / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}
