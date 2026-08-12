import { describe, it, expect } from 'vitest'
import { sha256Hex } from '../agreements/hash'
import { renderAgreement } from '../agreements/render'
import { exampleMergeContext } from '../agreements/merge-fields'
import { typedNameMatches } from '../agreements/typed-name-match'

describe('sha256Hex', () => {
  it('matches a fixed expected digest for a known string (guards against an encoding change)', () => {
    expect(sha256Hex('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    )
  })
})

describe('document hash stability', () => {
  it('rendering the same context twice yields the same hash', () => {
    const ctx = exampleMergeContext()
    const body = '<p>{{ sponsor_company_name }} — {{ amount_formatted }}</p>'
    const first = sha256Hex(renderAgreement(body, ctx).html)
    const second = sha256Hex(renderAgreement(body, ctx).html)
    expect(first).toBe(second)
  })

  it('changing a single merge value changes the hash', () => {
    const body = '<p>{{ sponsor_company_name }} — {{ amount_formatted }}</p>'
    const ctx = exampleMergeContext()
    const baseline = sha256Hex(renderAgreement(body, ctx).html)

    const changed = sha256Hex(
      renderAgreement(body, { ...ctx, amount_formatted: '$1.00' }).html
    )
    expect(changed).not.toBe(baseline)
  })
})

describe('typedNameMatches', () => {
  it('accepts a case-insensitive match', () => {
    expect(typedNameMatches('jane q. public', 'Jane Q. Public')).toBe(true)
  })

  it('accepts doubled internal spaces', () => {
    expect(typedNameMatches('Jane   Q.  Public', 'Jane Q. Public')).toBe(true)
  })

  it('accepts a trailing-period difference', () => {
    expect(typedNameMatches('Jane Q Public', 'Jane Q Public.')).toBe(true)
  })

  it('rejects a partial name', () => {
    expect(typedNameMatches('J. Public', 'Jane Q. Public')).toBe(false)
  })

  it('rejects an empty typed name', () => {
    expect(typedNameMatches('', 'Jane Q. Public')).toBe(false)
  })
})
