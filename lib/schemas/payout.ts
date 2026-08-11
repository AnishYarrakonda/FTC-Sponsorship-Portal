import { z } from 'zod'
import { LIMITS } from './limits'

export const taxClassificationSchema = z.enum([
  '501c3_org',
  'school_district',
  'fiscal_sponsor',
  'other_nonprofit',
  'unincorporated'
])

export type TaxClassification = z.infer<typeof taxClassificationSchema>

const einRegex = /^\d{9}$/
const postalCodeRegex = /^[0-9]{5}(-[0-9]{4})?$/

export const payoutProfileSchema = z.object({
  legalPayeeName: z.string().min(2, "Legal payee name is too short").max(LIMITS.legalPayeeName, "Legal payee name is too long"),
  taxClassification: taxClassificationSchema,
  ein: z.string().transform(val => val.replace(/\D/g, '')).refine(val => val === '' || einRegex.test(val), {
    message: "EIN must contain exactly 9 digits",
  }).optional(),
  isFiscallySponsored: z.boolean(),
  fiscalSponsorName: z.string().max(LIMITS.fiscalSponsorName, "Fiscal sponsor name is too long").optional(),
  fiscalSponsorEin: z.string().transform(val => val.replace(/\D/g, '')).refine(val => val === '' || einRegex.test(val), {
    message: "Fiscal sponsor EIN must contain exactly 9 digits",
  }).optional(),
  mailingAddressLine1: z.string().max(LIMITS.mailingLine, "Address line 1 is too long").optional(),
  mailingAddressLine2: z.string().max(LIMITS.mailingLine, "Address line 2 is too long").optional(),
  mailingCity: z.string().max(LIMITS.mailingCity, "City is too long").optional(),
  mailingState: z.string().length(2, "State must be a 2-letter code").optional(),
  mailingPostalCode: z.string().refine(val => !val || postalCodeRegex.test(val), {
    message: "Invalid ZIP code format",
  }).optional(),
  remittanceEmail: z.string().email("Invalid email").max(LIMITS.remittanceEmail, "Email is too long").optional().or(z.literal('')),
}).superRefine((data, ctx) => {
  if (data.isFiscallySponsored && (!data.fiscalSponsorName || data.fiscalSponsorName.trim() === '')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Fiscal sponsor name is required when fiscally sponsored",
      path: ["fiscalSponsorName"],
    })
  }
  if (data.taxClassification === 'fiscal_sponsor' && !data.isFiscallySponsored) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "isFiscallySponsored must be checked when tax classification is fiscal sponsor",
      path: ["isFiscallySponsored"],
    })
  }
})

export type PayoutProfileInput = z.input<typeof payoutProfileSchema>
export type PayoutProfileData = z.infer<typeof payoutProfileSchema>
