import React from 'react'
import {
  Html,
  Head,
  Preview,
  Body,
  Container,
  Text,
  Section,
} from '@react-email/components'
import { ReceiptDocumentBody, ReceiptDocumentContext } from '@/lib/receipt-document'

export function FundingReceiptEmail(ctx: ReceiptDocumentContext) {
  const previewText = `Official receipt ${ctx.receiptNumber} for contribution to ${ctx.payeeLegalName}`

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={mainStyle}>
        <Container style={containerStyle}>
          <Text style={ledeStyle}>
            Here is your official contribution record and receipt for your sponsorship of{' '}
            <strong>{ctx.payeeLegalName}</strong>.
          </Text>

          <Section style={wrapperStyle}>
            <ReceiptDocumentBody {...ctx} />
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export default FundingReceiptEmail

const mainStyle: React.CSSProperties = {
  backgroundColor: '#f1f5f9',
  fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  padding: '24px 0',
}

const containerStyle: React.CSSProperties = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '32px 24px',
  borderRadius: '12px',
  maxWidth: '720px',
}

const ledeStyle: React.CSSProperties = {
  fontSize: '15px',
  color: '#334155',
  lineHeight: '1.6',
  marginBottom: '24px',
}

const wrapperStyle: React.CSSProperties = {
  marginTop: '16px',
}
