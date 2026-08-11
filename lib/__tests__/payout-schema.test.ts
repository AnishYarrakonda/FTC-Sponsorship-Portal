import { describe, it, expect } from 'vitest'
import { payoutProfileSchema } from '../schemas/payout'
import { LIMITS } from '../schemas/limits'

describe('payoutProfileSchema', () => {
  it('allows valid 501c3 without fiscal sponsor', () => {
    const data = {
      legalPayeeName: 'Test Team',
      taxClassification: '501c3_org',
      ein: '123456789',
      isFiscallySponsored: false,
      fiscalSponsorName: '',
      fiscalSponsorEin: '',
      mailingAddressLine1: '123 Main St',
      mailingCity: 'Town',
      mailingState: 'CA',
      mailingPostalCode: '12345'
    }
    const result = payoutProfileSchema.safeParse(data)
    expect(result.success).toBe(true)
  })

  it('normalises EIN formatting and enforces 9-digit requirement', () => {
    const validFormats = ['12-3456789', '123456789', '12 345 6789']
    for (const rawEin of validFormats) {
      const res = payoutProfileSchema.safeParse({
        legalPayeeName: 'Test Team',
        taxClassification: '501c3_org',
        ein: rawEin,
        isFiscallySponsored: false,
      })
      expect(res.success).toBe(true)
      if (res.success && res.data.ein) {
        expect(res.data.ein).toBe('123456789')
        expect(res.data.ein.slice(-4)).toBe('6789')
      }
    }

    const invalidEins = ['12-345678', '1234567890', '12-ABCDEF']
    for (const rawEin of invalidEins) {
      const res = payoutProfileSchema.safeParse({
        legalPayeeName: 'Test Team',
        taxClassification: '501c3_org',
        ein: rawEin,
        isFiscallySponsored: false,
      })
      expect(res.success).toBe(false)
    }
  })

  it('validates mailingPostalCode formats', () => {
    const validZips = ['75024', '75024-1234']
    for (const zip of validZips) {
      const res = payoutProfileSchema.safeParse({
        legalPayeeName: 'Test Team',
        taxClassification: '501c3_org',
        isFiscallySponsored: false,
        mailingPostalCode: zip,
      })
      expect(res.success).toBe(true)
    }

    const invalidZips = ['7502', 'ABCDE', '750241234']
    for (const zip of invalidZips) {
      const res = payoutProfileSchema.safeParse({
        legalPayeeName: 'Test Team',
        taxClassification: '501c3_org',
        isFiscallySponsored: false,
        mailingPostalCode: zip,
      })
      expect(res.success).toBe(false)
    }
  })

  it('rejects fiscal_sponsor classification without isFiscallySponsored checked', () => {
    const data = {
      legalPayeeName: 'Test Team',
      taxClassification: 'fiscal_sponsor',
      ein: '123456789',
      isFiscallySponsored: false,
    }
    const result = payoutProfileSchema.safeParse(data)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('isFiscallySponsored must be checked')
    }
  })

  it('rejects missing fiscal sponsor details when isFiscallySponsored is true', () => {
    const data = {
      legalPayeeName: 'Test Team',
      taxClassification: '501c3_org',
      ein: '123456789',
      isFiscallySponsored: true,
      fiscalSponsorName: '',
    }
    const result = payoutProfileSchema.safeParse(data)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('Fiscal sponsor name is required')
    }
  })

  it('asserts max lengths by reference to LIMITS constant', () => {
    const overlyLongName = 'A'.repeat(LIMITS.legalPayeeName + 1)
    const res = payoutProfileSchema.safeParse({
      legalPayeeName: overlyLongName,
      taxClassification: '501c3_org',
      isFiscallySponsored: false,
    })
    expect(res.success).toBe(false)
    expect(LIMITS.legalPayeeName).toBe(200)
    expect(LIMITS.fiscalSponsorName).toBe(200)
    expect(LIMITS.mailingLine).toBe(200)
    expect(LIMITS.mailingCity).toBe(120)
    expect(LIMITS.remittanceEmail).toBe(254)
  })
})
