import { describe, it, expect } from 'vitest'
import { payoutProfileSchema } from '../schemas/payout'

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

  it('rejects fiscal_sponsor classification without isFiscallySponsored checked', () => {
    const data = {
      legalPayeeName: 'Test Team',
      taxClassification: 'fiscal_sponsor',
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
      fiscalSponsorEin: '',
      mailingAddressLine1: '123 Main St',
      mailingCity: 'Town',
      mailingState: 'CA',
      mailingPostalCode: '12345'
    }
    const result = payoutProfileSchema.safeParse(data)
    expect(result.success).toBe(false)
  })

  it('validates 9-digit EIN', () => {
    const data = {
      legalPayeeName: 'Test Team',
      taxClassification: '501c3_org',
      ein: '12-34', // Too short
      isFiscallySponsored: false,
      fiscalSponsorName: '',
      fiscalSponsorEin: '',
      mailingAddressLine1: '123 Main St',
      mailingCity: 'Town',
      mailingState: 'CA',
      mailingPostalCode: '12345'
    }
    const result = payoutProfileSchema.safeParse(data)
    expect(result.success).toBe(false)
  })
})
