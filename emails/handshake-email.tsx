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

          {/* This email IS the handoff. Replies are cross-wired (see sendHandshakeEmail in
              lib/notify.ts), so "reply to this email" reaches the other party directly and is
              the shortest path to the two of them talking. Nothing further happens on the
              platform, and the copy should not imply that it does. */}
          {isSponsor ? (
            <Text style={text}>
              From here it&apos;s between the two of you. Reply to this email to reach the team&apos;s
              coach ({coachEmail}) directly and arrange payment &mdash; most sponsors ask the team for
              a W-9 and payment instructions at this point.
            </Text>
          ) : (
            <Text style={text}>
              From here it&apos;s between the two of you. Reply to this email to reach {sponsorName}
              directly &mdash; they will usually need a W-9 and your payment instructions before their
              finance team can release the funds.
            </Text>
          )}

          <Section style={summaryBox}>
            <Text style={{ ...text, margin: 0 }}><strong>Sponsor:</strong> {sponsorName}</Text>
            <Text style={{ ...text, margin: '4px 0 0' }}><strong>Team:</strong> {teamLabel}</Text>
            <Text style={{ ...text, margin: '4px 0 0' }}><strong>Amount Agreed:</strong> {amountDisplay}</Text>
          </Section>

          {/* Stated once, plainly. Both parties are about to move real money and neither
              should be waiting on this platform to do something. */}
          <Text style={{ ...text, fontSize: '13px', color: '#64748b' }}>
            FTC Pitfund never receives, holds or transfers money, and does not track whether
            payment has been made. Everything from here happens directly between you.
          </Text>

          <Text style={text}>— The FTC Pitfund team</Text>
          <Hr style={hr} />
          <Text style={footer}>
            FTC Pitfund · You received this email because a sponsorship match involving
            you was made through FTC Pitfund.
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
