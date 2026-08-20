/**
 * ESIGN typed-name matching, shared between the server action (authoritative) and the
 * signing panel (a display-only hint). Case-insensitive, collapses internal whitespace,
 * strips trailing periods: "jane q. public" matches "Jane Q. Public"; "J. Public" does
 * not.
 */
export function normalizeTypedName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').replace(/\.+$/, '').toLowerCase()
}

export function typedNameMatches(typed: string, expected: string): boolean {
  if (!typed.trim() || !expected.trim()) return false
  return normalizeTypedName(typed) === normalizeTypedName(expected)
}
