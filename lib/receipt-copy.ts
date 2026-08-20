/**
 * Receipt copy, variant resolution, and Pub 1771 template wording.
 *
 * Pure module: no DB, no React, no non-deterministic dates.
 */

/** ISO date on which counsel signed off on the template copy. NULL until they have. */
export const RECEIPT_COPY_REVIEWED_AT: string | null = null

export const RECEIPT_COPY_VERSION = '2026-08-v1'

export type ReceiptVariant = 'charitable_501c3' | 'governmental_school' | 'non_charitable'

export type PayeeTaxClassification =
  | '501c3_org'
  | 'school_district'
  | 'fiscal_sponsor'
  | 'other_nonprofit'
  | 'unincorporated'

export function resolveReceiptVariant(input: {
  teamTaxStatus: '501c3' | 'School' | 'None' | null
  taxClassification: PayeeTaxClassification | null
  w9VerifiedAt: string | null
}): ReceiptVariant {
  const isVerified = input.w9VerifiedAt != null

  if (
    isVerified &&
    input.teamTaxStatus === '501c3' &&
    (input.taxClassification === '501c3_org' || input.taxClassification === 'fiscal_sponsor')
  ) {
    return 'charitable_501c3'
  }

  if (
    isVerified &&
    (input.teamTaxStatus === 'School' || input.taxClassification === 'school_district')
  ) {
    return 'governmental_school'
  }

  return 'non_charitable'
}

export function formatReceiptNumber(year: number, seq: number): string {
  return `PF-${year}-${String(seq).padStart(6, '0')}`
}

export interface ReceiptCopyContext {
  payeeLegalName: string
  ein?: string | null
  amountCents: number
  contributionDate: string
  sponsorLegalName: string
  goodsOrServicesDescription?: string | null
  goodsOrServicesFmvCents?: number | null
  isFiscallySponsored?: boolean
  fiscalSponsorName?: string | null
  whenNoVerifiedProfile?: boolean
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export function receiptCopy(
  variant: ReceiptVariant,
  ctx: ReceiptCopyContext
): {
  heading: string
  bodyLines: string[]
  deductibilityStatement: string
  goodsAndServicesStatement: string
  disclaimer: string
  showEin: boolean
  draftBanner: string | null
} {
  const draftBanner =
    RECEIPT_COPY_REVIEWED_AT === null
      ? 'DRAFT — this acknowledgment uses template language that has not been reviewed by counsel.'
      : null

  const amountStr = formatCents(ctx.amountCents)
  const fmvStr =
    ctx.goodsOrServicesFmvCents != null ? formatCents(ctx.goodsOrServicesFmvCents) : '$0.00'

  const hasQqp = Boolean(ctx.goodsOrServicesDescription)

  if (variant === 'charitable_501c3') {
    const einStr = ctx.ein ? ` (EIN ${ctx.ein})` : ''
    const bodyLines: string[] = [
      `${ctx.payeeLegalName}${einStr} acknowledges receipt of a cash contribution of ${amountStr} from ${ctx.sponsorLegalName} on ${ctx.contributionDate}.`,
    ]
    if (ctx.isFiscallySponsored && ctx.fiscalSponsorName) {
      bodyLines.push(
        `${ctx.payeeLegalName} receives this contribution through its fiscal sponsor, ${ctx.fiscalSponsorName}.`
      )
    }

    const goodsAndServicesStatement = hasQqp
      ? `In exchange for this contribution, ${ctx.payeeLegalName} provided: ${ctx.goodsOrServicesDescription}. The good-faith estimate of the value of those goods or services is ${fmvStr}. Under IRS rules the deductible amount, if any, is limited to the excess of the contribution over that value.`
      : `No goods or services were provided by ${ctx.payeeLegalName} in exchange for this contribution.`

    return {
      heading: 'Contribution acknowledgment',
      bodyLines,
      deductibilityStatement: `${ctx.payeeLegalName} states that it is an organization described in section 501(c)(3) of the Internal Revenue Code and that contributions to it are deductible under section 170.`,
      goodsAndServicesStatement,
      disclaimer: `Retain this acknowledgment with your tax records. ${ctx.payeeLegalName} does not provide tax advice; consult your tax advisor regarding the deductibility of this contribution.`,
      showEin: true,
      draftBanner,
    }
  }

  if (variant === 'governmental_school') {
    const einStr = ctx.ein ? ` (EIN ${ctx.ein})` : ''
    const bodyLines: string[] = [
      `${ctx.payeeLegalName}${einStr} acknowledges receipt of ${amountStr} from ${ctx.sponsorLegalName} on ${ctx.contributionDate} in support of its FIRST Tech Challenge robotics program.`,
    ]

    const goodsAndServicesStatement = hasQqp
      ? `In exchange for this contribution, ${ctx.payeeLegalName} provided: ${ctx.goodsOrServicesDescription}. The good-faith estimate of the value of those goods or services is ${fmvStr}. Under IRS rules the deductible amount, if any, is limited to the excess of the contribution over that value.`
      : `No goods or services were provided in exchange for this payment.`

    return {
      heading: 'Contribution acknowledgment',
      bodyLines,
      deductibilityStatement: `${ctx.payeeLegalName} is a public school or governmental unit. Contributions to a governmental unit may be deductible under section 170(c)(1) when made exclusively for public purposes. Whether that applies to this contribution is a determination for your tax advisor; this document is not a determination of deductibility.`,
      goodsAndServicesStatement,
      disclaimer: `Retain this acknowledgment with your tax records. ${ctx.payeeLegalName} does not provide tax advice; consult your tax advisor regarding the deductibility of this contribution.`,
      showEin: Boolean(ctx.ein),
      draftBanner,
    }
  }

  // non_charitable
  const bodyLines: string[] = [
    `${ctx.payeeLegalName} acknowledges receipt of ${amountStr} from ${ctx.sponsorLegalName} on ${ctx.contributionDate}.`,
  ]
  if (ctx.whenNoVerifiedProfile) {
    bodyLines.push(
      'This team has not completed verified payout and tax information. If it does, future contributions can be acknowledged with the appropriate tax language.'
    )
  }

  const goodsAndServicesStatement = hasQqp
    ? `In exchange for this contribution, ${ctx.payeeLegalName} provided: ${ctx.goodsOrServicesDescription}. The good-faith estimate of the value of those goods or services is ${fmvStr}.`
    : `Your payment may be deductible as an ordinary and necessary business expense under section 162. That is a determination for your tax advisor.`

  return {
    heading: 'Payment record — not a charitable contribution receipt',
    bodyLines,
    deductibilityStatement: `${ctx.payeeLegalName} is not a section 501(c)(3) organization, and this document must not be used to substantiate a charitable contribution deduction.`,
    goodsAndServicesStatement,
    disclaimer: `Retain this record with your business files. ${ctx.payeeLegalName} does not provide tax advice; consult your tax advisor.`,
    showEin: false, // ALWAYS false for non_charitable
    draftBanner,
  }
}
