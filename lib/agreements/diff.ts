// Pure line diff — no dependency. Classic LCS-based algorithm, adequate at the
// hundreds-of-lines scale of an agreement template body.
export type DiffOp =
  | { type: 'unchanged'; line: string }
  | { type: 'added'; line: string }
  | { type: 'removed'; line: string }

export function diffLines(from: string, to: string): DiffOp[] {
  const a = from.length ? from.split('\n') : []
  const b = to.length ? to.split('\n') : []

  const n = a.length
  const m = b.length
  // lcs[i][j] = length of the LCS of a[i:] and b[j:]
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const ops: DiffOp[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'unchanged', line: a[i] })
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ type: 'removed', line: a[i] })
      i++
    } else {
      ops.push({ type: 'added', line: b[j] })
      j++
    }
  }
  while (i < n) {
    ops.push({ type: 'removed', line: a[i] })
    i++
  }
  while (j < m) {
    ops.push({ type: 'added', line: b[j] })
    j++
  }
  return ops
}
