/**
 * Brace-balanced source extraction for the invariant tests.
 *
 * The invariant tests read source files as TEXT and assert that a secret never appears
 * inside a particular construct. That only works if the construct is delimited correctly,
 * and the regexes these replaced were not:
 *
 *  - `/metadata:\s*\{[^}]*\}/` stops at the FIRST `}`, so for
 *    `metadata: { a: { b: 1 }, paymentReference: x }` it captured `metadata: { a: { b: 1 }`
 *    and the leak after the nested object closed was never seen. The invariant held; the
 *    test did not enforce it.
 *  - `/export async function foo[\s\S]*?^}/m` relies on the closing brace sitting in
 *    column 0, which is true of the current formatting and of nothing else. One indent —
 *    wrapping the function, or Prettier changing its mind — silently extends the match to
 *    the next column-0 `}` or fails to match at all, and a non-match yields '' which
 *    passes every `not.toContain`.
 *
 * Both helpers below count braces instead, and both THROW on a construct they cannot
 * find, so a silent empty match can no longer masquerade as a pass.
 */

/** Reads from `start` (which must index an opening delimiter) to its balanced partner. */
function balancedFrom(source: string, openIndex: number): string {
  const open = source[openIndex]
  const close = open === '{' ? '}' : open === '(' ? ')' : null
  if (!close) throw new Error(`balancedFrom: index ${openIndex} is not { or (`)

  let depth = 0
  for (let i = openIndex; i < source.length; i++) {
    const c = source[i]
    if (c === open) depth++
    else if (c === close) {
      depth--
      if (depth === 0) return source.slice(openIndex, i + 1)
    }
  }
  throw new Error(`balancedFrom: unbalanced ${open} at index ${openIndex}`)
}

/**
 * Every `<key>:` object literal in `source`, each returned brace-balanced and complete —
 * nested objects and all.
 */
export function objectLiteralsForKey(source: string, key: string): string[] {
  const out: string[] = []
  const marker = new RegExp(`\\b${key}\\s*:\\s*\\{`, 'g')
  let m: RegExpExecArray | null
  while ((m = marker.exec(source)) !== null) {
    const braceIndex = source.indexOf('{', m.index)
    out.push(balancedFrom(source, braceIndex))
  }
  return out
}

/** Every `<name>(...)` call in `source`, each returned paren-balanced and complete. */
export function callExpressions(source: string, callee: string): string[] {
  const out: string[] = []
  const marker = new RegExp(`\\b${callee.replace(/\./g, '\\.')}\\s*\\(`, 'g')
  let m: RegExpExecArray | null
  while ((m = marker.exec(source)) !== null) {
    const parenIndex = source.indexOf('(', m.index)
    out.push(balancedFrom(source, parenIndex))
  }
  return out
}

/**
 * The body of a top-level function declaration, delimited by brace counting rather than by
 * a column-0 `}`. Throws if the declaration is absent — a renamed function must break the
 * test loudly, not quietly stop checking anything.
 */
export function functionBody(source: string, name: string): string {
  const decl = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\b`)
  const m = decl.exec(source)
  if (!m) throw new Error(`functionBody: no declaration of ${name} found`)
  const braceIndex = source.indexOf('{', source.indexOf(')', m.index))
  if (braceIndex === -1) throw new Error(`functionBody: no body for ${name}`)
  return balancedFrom(source, braceIndex)
}
