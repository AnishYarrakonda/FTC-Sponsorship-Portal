import { describe, it, expect } from 'vitest'
import { diffLines } from '../agreements/diff'

describe('diffLines', () => {
  it('marks identical inputs as entirely unchanged', () => {
    const text = 'line one\nline two\nline three'
    const ops = diffLines(text, text)
    expect(ops.every((op) => op.type === 'unchanged')).toBe(true)
    expect(ops.map((op) => op.line)).toEqual(['line one', 'line two', 'line three'])
  })

  it('detects a pure insertion', () => {
    const ops = diffLines('a\nb', 'a\nx\nb')
    expect(ops).toEqual([
      { type: 'unchanged', line: 'a' },
      { type: 'added', line: 'x' },
      { type: 'unchanged', line: 'b' },
    ])
  })

  it('detects a pure deletion', () => {
    const ops = diffLines('a\nx\nb', 'a\nb')
    expect(ops).toEqual([
      { type: 'unchanged', line: 'a' },
      { type: 'removed', line: 'x' },
      { type: 'unchanged', line: 'b' },
    ])
  })

  it('detects a replacement as a removal plus an addition', () => {
    const ops = diffLines('a\nold\nb', 'a\nnew\nb')
    expect(ops).toEqual([
      { type: 'unchanged', line: 'a' },
      { type: 'removed', line: 'old' },
      { type: 'added', line: 'new' },
      { type: 'unchanged', line: 'b' },
    ])
  })

  it('does not throw on empty inputs', () => {
    expect(diffLines('', '')).toEqual([])
    expect(diffLines('', 'a\nb')).toEqual([
      { type: 'added', line: 'a' },
      { type: 'added', line: 'b' },
    ])
    expect(diffLines('a\nb', '')).toEqual([
      { type: 'removed', line: 'a' },
      { type: 'removed', line: 'b' },
    ])
  })
})
