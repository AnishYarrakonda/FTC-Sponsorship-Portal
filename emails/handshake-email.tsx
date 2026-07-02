import {
  Html, Head, Preview, Body, Container, Heading, Text, Hr, Section,
} from '@react-email/components'
import * as React from 'react'

interface HandshakeEmailProps {
  recipientName: string
  sponsorName: string
  teamName: string
  ftcTeamNumber: number | null
  amountCents: number
  coachEmail: string
  isSponsor: boolean
}

export default function HandshakeEmail({
  recipientName,
  sponsorName,
  teamName,
  ftcTeamNumber,
  amountCents,
  coachEmail,
  isSponsor,
}: HandshakeEmailProps) {
  const amountDisplay = `$${(amountCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
  const teamLabel = ftcTeamNumber ? `Team #${ftcTeamNumber}` : teamName

  return (
    <Html>
      <Head />
      <Preview>Match Made! {sponsorName} × {teamLabel} — {amountDisplay}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={badge}>
            <Text style={badgeText}>🎉 Match Made!</Text>
          </Section>

          <Heading style={h1}>Congratulations, {recipientName}!</Heading>

          <Text style={text}>
            <strong>{sponsorName}</strong> has agreed to sponsor <strong>{teamLabel}</strong> for{' '}
            <strong>{amountDisplay}</strong>.
          </Text>

          {isSponsor ? (
            <Text style={text}>
              To complete the transaction, please reply to this email with your preferred payment method.
              The team coach ({coachEmail}) will send W-9 and payment instructions.
            </Text>
          ) : (
            <Text style={text}>
              To complete the transaction, reply to this email with your team&apos;s W-9 and preferred payment
              instructions. A copy of this message has been sent to {sponsorName}.
            </Text>
          )}

          <Section style={summaryBox}>
            <Text style={{ ...text, margin: 0 }}><strong>Sponsor:</strong> {sponsorName}</Text>
            <Text style={{ ...text, margin: '4px 0 0' }}><strong>Team:</strong> {teamLabel}</Text>
            <Text style={{ ...text, margin: '4px 0 0' }}><strong>Amount Agreed:</strong> {amountDisplay}</Text>
          </Section>

          <Text style={text}>— The FTC Matchmaker team</Text>
          <Hr style={hr} />
          <Text style={footer}>
            FTC Matchmaker · You received this email because a sponsorship match involving
            you was made through the FTC Matchmaker.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

const main = { backgroundColor: '#f0fdf4', fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }
const container = { backgroundColor: '#ffffff', margin: '0 auto', padding: '32px 24px', borderRadius: '12px', maxWidth: '600px' }
const badge = { backgroundColor: '#dcfce7', borderRadius: '8px', padding: '10px 20px', marginBottom: '20px', display: 'inline-block' }
const badgeText = { fontSize: '18px', fontWeight: '700', color: '#15803d', margin: 0 }
const h1 = { fontSize: '24px', color: '#0f172a', marginBottom: '12px' }
const text = { fontSize: '15px', color: '#334155', lineHeight: '1.6' }
const summaryBox = { backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '16px 20px', margin: '20px 0' }
const hr = { borderColor: '#e2e8f0', margin: '24px 0' }
const footer = { fontSize: '12px', color: '#94a3b8' }
