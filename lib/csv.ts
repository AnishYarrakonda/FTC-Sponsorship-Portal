/**
 * CSV emission helpers, lifted verbatim out of app/api/admin/export/route.ts so the
 * sponsor and admin impact-report routes cannot drift from the admin export's escaping.
 *
 * This is a pure move: no behaviour change. The formula-injection defence matters just as
 * much on a CSR report as on the admin export — team and company names are
 * attacker-influenced and a CFO opens the file in Excel.
 */

export function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  let str = String(value)
  // CSV formula-injection defense: a cell beginning with = + - @ (or tab/CR) is
  // interpreted as a formula by Excel/Sheets. Prefix with a tab so the spreadsheet
  // treats it as literal text.
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `\t${str}`
  }
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export function rowToCsv(row: unknown[]): string {
  return row.map(escapeCell).join(',')
}

/** PostgREST caps an unbounded select at 1000 rows and says nothing about it. */
export const CSV_PAGE_SIZE = 1000
