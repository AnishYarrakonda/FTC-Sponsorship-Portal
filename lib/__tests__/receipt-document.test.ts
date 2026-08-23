import { describe, it, expect } from 'vitest'
import { renderReceiptDocument, ReceiptDocumentContext } from '@/lib/receipt-document'

describe('renderReceiptDocument', () => {
  const sampleCtx: ReceiptDocumentContext = {
    receiptNumber: 'PF-2026-000123',
    issuedAt: '2026-08-10',
    contributionDate: '2026-08-05',
    amountCents: 100000,
    variant: 'charitable_501c3',
    payeeLegalName: 'Robotics Booster Club',
    payeeEinLast4: '6789',
    sponsorLegalName: 'Acme Technologies',
  }

  it('renders deterministically: same context yields identical html and sha256', async () => {
    const res1 = await renderReceiptDocument(sampleCtx)
    const res2 = await renderReceiptDocument(sampleCtx)

    expect(res1.html).toBe(res2.html)
    expect(res1.sha256).toBe(res2.sha256)
    expect(res1.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changing amount_cents changes the output hash', async () => {
    const res1 = await renderReceiptDocument(sampleCtx)
    const res2 = await renderReceiptDocument({ ...sampleCtx, amountCents: 100001 })

    expect(res1.sha256).not.toBe(res2.sha256)
  })

  it('contains no script tags, no external image/http assets, and no payment_reference', async () => {
    const { html } = await renderReceiptDocument(sampleCtx)

    expect(html).not.toContain('<script')
    // @react-email/render emits an XHTML DOCTYPE with http://www.w3.org/ — that's
    // expected boilerplate. What we guard against is external image/link assets.
    expect(html).not.toMatch(/src=["']https?:\/\/(?!www\.w3\.org)/i)
    expect(html).not.toMatch(/href=["']https?:\/\/(?!www\.w3\.org)/i)
    expect(html).not.toContain('payment_reference')
    expect(html).not.toContain('paymentReference')
  })

  it('non_charitable render contains no nine-digit EIN string', async () => {
    const nonCharCtx: ReceiptDocumentContext = {
      ...sampleCtx,
      variant: 'non_charitable',
      payeeEinLast4: '7776',
    }
    const { html } = await renderReceiptDocument(nonCharCtx)

    expect(html).not.toContain('99-8887776')
    expect(html).not.toContain('EIN')
  })

  // Regression guard for audit A-06-01. The rendered document is persisted verbatim in
  // funding_receipts.document_html and emailed via Resend, so a full EIN reaching this
  // HTML escapes the PAYOUT_ENCRYPTION_KEY boundary permanently and survives key
  // rotation. The context type no longer carries a full-EIN field; this asserts the
  // rendered output too, so reintroducing one fails here.
  it('never emits a full nine-digit EIN — only the last four, labelled as partial', async () => {
    const { html } = await renderReceiptDocument(sampleCtx)

    expect(html).toContain('ending in 6789')
    // No NN-NNNNNNN or NNNNNNNNN anywhere in the document.
    expect(html).not.toMatch(/\b\d{2}-\d{7}\b/)
    expect(html).not.toMatch(/\b\d{9}\b/)
  })
})
