import React from 'react'
import { createHash } from 'crypto'
import { render } from '@react-email/render'
import { Section, Text, Hr } from '@react-email/components'
import { receiptCopy, ReceiptVariant } from '@/lib/receipt-copy'

export interface ReceiptDocumentContext {
  receiptNumber: string
  issuedAt: string
  contributionDate: string
  amountCents: number
  variant: ReceiptVariant
  payeeLegalName: string
  payeeEinLast4?: string | null
  payeeEinFull?: string | null
  payeeTaxClassification?: string | null
  sponsorLegalName: string
  sponsorContactEmail?: string | null
  goodsOrServicesDescription?: string | null
  goodsOrServicesFmvCents?: number | null
  isFiscallySponsored?: boolean
  fiscalSponsorName?: string | null
  whenNoVerifiedProfile?: boolean
}

/**
 * Shared document body. NO <Html>, NO <Body> — safe to embed in an email shell or web page.
 */
export function ReceiptDocumentBody(ctx: ReceiptDocumentContext): React.ReactElement {
  const einToPrint = ctx.payeeEinFull || ctx.payeeEinLast4 || null
  const copy = receiptCopy(ctx.variant, {
    payeeLegalName: ctx.payeeLegalName,
    ein: einToPrint,
    amountCents: ctx.amountCents,
    contributionDate: ctx.contributionDate,
    sponsorLegalName: ctx.sponsorLegalName,
    goodsOrServicesDescription: ctx.goodsOrServicesDescription,
    goodsOrServicesFmvCents: ctx.goodsOrServicesFmvCents,
    isFiscallySponsored: ctx.isFiscallySponsored,
    fiscalSponsorName: ctx.fiscalSponsorName,
    whenNoVerifiedProfile: ctx.whenNoVerifiedProfile,
  })

  const amountDisplay = `$${(ctx.amountCents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

  return (
    <div style={containerStyle}>
      {copy.draftBanner && (
        <Section style={bannerStyle}>
          <Text style={bannerTextStyle}>{copy.draftBanner}</Text>
        </Section>
      )}

      <Text style={headingStyle}>{copy.heading}</Text>

      <Section style={summaryBoxStyle}>
        <Text style={summaryRowStyle}>
          <strong>Receipt Number:</strong> {ctx.receiptNumber}
        </Text>
        <Text style={summaryRowStyle}>
          <strong>Issue Date:</strong> {ctx.issuedAt}
        </Text>
        <Text style={summaryRowStyle}>
          <strong>Contribution Date:</strong> {ctx.contributionDate}
        </Text>
        <Text style={summaryRowStyle}>
          <strong>Payee Legal Name:</strong> {ctx.payeeLegalName}
          {copy.showEin && einToPrint ? ` (EIN ${einToPrint})` : ''}
        </Text>
        {ctx.isFiscallySponsored && ctx.fiscalSponsorName && (
          <Text style={summaryRowStyle}>
            <strong>Fiscal Sponsor:</strong> {ctx.fiscalSponsorName}
          </Text>
        )}
        <Text style={summaryRowStyle}>
          <strong>Sponsor:</strong> {ctx.sponsorLegalName}
        </Text>
        <Text style={summaryRowStyle}>
          <strong>Amount Received:</strong> {amountDisplay}
        </Text>
      </Section>

      {copy.bodyLines.map((line, idx) => (
        <Text key={idx} style={textStyle}>
          {line}
        </Text>
      ))}

      <Text style={textStyle}>{copy.deductibilityStatement}</Text>
      <Text style={textStyle}>
        <strong>{copy.goodsAndServicesStatement}</strong>
      </Text>
      <Text style={textStyle}>{copy.disclaimer}</Text>

      <Hr style={hrStyle} />
      <Text style={footerStyle}>
        Prepared through FTC Pitfund on behalf of {ctx.payeeLegalName}. FTC Pitfund is not a party
        to this contribution and does not provide tax advice.
      </Text>
    </div>
  )
}

/**
 * Deterministic document rendering engine.
 * Same context in => byte-identical HTML and SHA-256 out.
 */
export async function renderReceiptDocument(
  ctx: ReceiptDocumentContext
): Promise<{ html: string; sha256: string }> {
  const element = React.createElement(ReceiptDocumentBody, ctx)
  const html = await render(element, { pretty: false })
  const sha256 = createHash('sha256').update(html).digest('hex')
  return { html, sha256 }
}

const containerStyle: React.CSSProperties = {
  fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  color: '#0f172a',
  backgroundColor: '#ffffff',
  padding: '24px',
  borderRadius: '8px',
  border: '1px solid #e2e8f0',
  maxWidth: '680px',
  margin: '0 auto',
}

const bannerStyle: React.CSSProperties = {
  backgroundColor: '#fef2f2',
  border: '1px solid #fca5a5',
  borderRadius: '6px',
  padding: '12px 16px',
  marginBottom: '20px',
}

const bannerTextStyle: React.CSSProperties = {
  color: '#991b1b',
  fontSize: '13px',
  fontWeight: '600',
  margin: 0,
}

const headingStyle: React.CSSProperties = {
  fontSize: '22px',
  fontWeight: '700',
  color: '#0f172a',
  marginBottom: '16px',
  marginTop: 0,
}

const summaryBoxStyle: React.CSSProperties = {
  backgroundColor: '#f8fafc',
  border: '1px solid #cbd5e1',
  borderRadius: '6px',
  padding: '16px',
  marginBottom: '20px',
}

const summaryRowStyle: React.CSSProperties = {
  fontSize: '14px',
  color: '#334155',
  margin: '4px 0',
  lineHeight: '1.5',
}

const textStyle: React.CSSProperties = {
  fontSize: '14px',
  color: '#334155',
  lineHeight: '1.6',
  marginBottom: '14px',
}

const hrStyle: React.CSSProperties = {
  borderColor: '#cbd5e1',
  margin: '24px 0 16px',
}

const footerStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#64748b',
  lineHeight: '1.5',
  margin: 0,
}
