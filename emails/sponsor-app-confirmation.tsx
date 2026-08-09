import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Text,
} from '@react-email/components'
import * as React from 'react'

interface SponsorAppConfirmationProps {
  companyName: string
  contactName?: string
  proposedCapCents: number
}

function formatUsd(cents: number) {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}

export default function SponsorAppConfirmation({
  companyName,
  contactName,
  proposedCapCents,
}: SponsorAppConfirmationProps) {
  return (
    <Html>
      <Head />
      <Preview>We received your sponsor application — thank you</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Hi {contactName || 'there'},</Heading>
          <Text style={text}>
            Thanks for applying to sponsor FTC teams through our portal on behalf of{' '}
            <strong>{companyName}</strong>. We received your application and our team is reviewing
            it.
          </Text>
          <Text style={text}>
            Proposed funding cap: <strong>{formatUsd(proposedCapCents)}</strong>
          </Text>
          <Text style={text}>
            Reviews typically take 3–5 business days. We&rsquo;ll reach out at this email address
            with next steps. No further action is needed from you right now.
          </Text>
          <Text style={text}>— The FTC Pitfund team</Text>
          <Hr style={hr} />
          <Text style={footer}>
            FTC Pitfund · You received this email because you applied to sponsor FTC
            teams.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

const main = { backgroundColor: '#f6f9fc', fontFamily: 'sans-serif' }
const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '24px',
  borderRadius: '8px',
  maxWidth: '560px',
}
const h1 = { fontSize: '20px', color: '#1a1a1a', marginBottom: '8px' }
const text = { fontSize: '15px', color: '#444', lineHeight: '1.6' }
const hr = { borderColor: '#e4e4e7', margin: '24px 0' }
const footer = { fontSize: '12px', color: '#999' }
