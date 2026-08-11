import { describe, it, expect } from 'vitest'
import {
  resolveReceiptVariant,
  formatReceiptNumber,
  receiptCopy,
  RECEIPT_COPY_REVIEWED_AT,
} from '@/lib/receipt-copy'

describe('resolveReceiptVariant', () => {
  it('resolves 501c3 when team is 501c3, profile is 501c3_org, and W-9 is verified', () => {
    const res = resolveReceiptVariant({
      teamTaxStatus: '501c3',
      taxClassification: '501c3_org',
      w9VerifiedAt: '2026-01-01T00:00:00Z',
    })
    expect(res).toBe('charitable_501c3')
  })

  it('resolves 501c3 when team is 501c3, profile is fiscal_sponsor, and W-9 is verified', () => {
    const res = resolveReceiptVariant({
      teamTaxStatus: '501c3',
      taxClassification: 'fiscal_sponsor',
      w9VerifiedAt: '2026-01-01T00:00:00Z',
    })
    expect(res).toBe('charitable_501c3')
  })

  it('defaults to non_charitable when W-9 is unverified', () => {
    const res = resolveReceiptVariant({
      teamTaxStatus: '501c3',
      taxClassification: '501c3_org',
      w9VerifiedAt: null,
    })
    expect(res).toBe('non_charitable')
  })

  it('defaults to non_charitable when tax classifications disagree (e.g. unincorporated)', () => {
    const res = resolveReceiptVariant({
      teamTaxStatus: '501c3',
      taxClassification: 'unincorporated',
      w9VerifiedAt: '2026-01-01T00:00:00Z',
    })
    expect(res).toBe('non_charitable')
  })

  it('resolves governmental_school for School team and school_district classification with verified W-9', () => {
    const res = resolveReceiptVariant({
      teamTaxStatus: 'School',
      taxClassification: 'school_district',
      w9VerifiedAt: '2026-01-01T00:00:00Z',
    })
    expect(res).toBe('governmental_school')
  })

  it('defaults to non_charitable when payout profile is null', () => {
    const res = resolveReceiptVariant({
      teamTaxStatus: null,
      taxClassification: null,
      w9VerifiedAt: null,
    })
    expect(res).toBe('non_charitable')
  })
})

describe('formatReceiptNumber', () => {
  it('formats year and sequence with leading zeroes', () => {
    expect(formatReceiptNumber(2026, 1)).toBe('PF-2026-000001')
    expect(formatReceiptNumber(2026, 123)).toBe('PF-2026-000123')
  })
})

describe('receiptCopy content variants', () => {
  const baseCtx = {
    payeeLegalName: 'Test Robotics',
    ein: '12-3456789',
    amountCents: 50000,
    contributionDate: '2026-08-10',
    sponsorLegalName: 'Acme Corp',
  }

  it('charitable_501c3 copy contains exact Pub 1771 no goods statement', () => {
    const copy = receiptCopy('charitable_501c3', baseCtx)
    expect(copy.goodsAndServicesStatement).toContain('No goods or services were provided')
    expect(copy.deductibilityStatement).toContain('section 170')
    expect(copy.showEin).toBe(true)
  })

  it('non_charitable copy contains warning and never asserts deductibility or shows EIN', () => {
    const copy = receiptCopy('non_charitable', { ...baseCtx, ein: '99-9999999' })
    expect(copy.deductibilityStatement).toContain('not a section 501(c)(3) organization')
    expect(copy.deductibilityStatement).toContain('must not be used to substantiate a charitable contribution deduction')
    expect(copy.deductibilityStatement).not.toContain('deductible under section 170')
    expect(copy.deductibilityStatement).not.toContain('tax-deductible')
    expect(copy.showEin).toBe(false)
  })

  it('governmental_school copy contains non-determination statement', () => {
    const copy = receiptCopy('governmental_school', baseCtx)
    expect(copy.deductibilityStatement).toContain('not a determination of deductibility')
    expect(copy.deductibilityStatement).not.toContain('is deductible')
  })

  it('quid pro quo disclosure replaces negative statement when goods/services are provided', () => {
    const copy = receiptCopy('charitable_501c3', {
      ...baseCtx,
      goodsOrServicesDescription: 'Logo placement on competition robot',
      goodsOrServicesFmvCents: 5000,
    })
    expect(copy.goodsAndServicesStatement).toContain('Logo placement on competition robot')
    expect(copy.goodsAndServicesStatement).toContain('$50.00')
    expect(copy.goodsAndServicesStatement).toContain('good-faith estimate')
  })

  it('draftBanner is present while RECEIPT_COPY_REVIEWED_AT is null', () => {
    expect(RECEIPT_COPY_REVIEWED_AT).toBeNull()
    const copy = receiptCopy('charitable_501c3', baseCtx)
    expect(copy.draftBanner).toContain('DRAFT — this acknowledgment uses template language')
  })
})
