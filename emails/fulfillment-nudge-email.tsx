import { Html } from '@react-email/html'
import { Head } from '@react-email/head'
import { Preview } from '@react-email/preview'
import { Body } from '@react-email/body'
import { Container } from '@react-email/container'
import { Section } from '@react-email/section'
import { Text } from '@react-email/text'
import { Link } from '@react-email/link'

export interface FulfillmentNudgeEmailProps {
  recipientName: string
  audience: 'sponsor' | 'coach' | 'admin'
  sponsorName: string
  teamName: string
  ftcTeamNumber: number | null
  amountCents: number
  status: 'pledged' | 'agreement_signed' | 'payment_sent'
  daysOpen: number
  ctaUrl: string
  ctaLabel: string
}

export default function FulfillmentNudgeEmail({
  recipientName = 'Team Lead',
  audience = 'coach',
  sponsorName = 'Sponsor',
  teamName = 'Team',
  ftcTeamNumber = null,
  amountCents = 0,
  status = 'pledged',
  daysOpen = 0,
  ctaUrl = 'https://ftc-sponsorship-portal.vercel.app/dashboard',
  ctaLabel = 'View details',
}: FulfillmentNudgeEmailProps) {
  const formattedAmount = `$${(amountCents / 100).toLocaleString('en-US')}`
  const fullTeamName = ftcTeamNumber ? `${teamName} (#${ftcTeamNumber})` : teamName

  let bodyText = ''
  if (audience === 'sponsor' && (status === 'pledged' || status === 'agreement_signed')) {
    bodyText = `You committed ${formattedAmount} to ${fullTeamName} ${daysOpen} days ago. Once you've sent the check or transfer, mark it sent so the team knows to watch for it.`
  } else if (audience === 'sponsor' && status === 'payment_sent') {
    bodyText = `${fullTeamName} still hasn't confirmed receipt of the ${formattedAmount} you marked sent ${daysOpen} days ago. It may be worth checking with your AP team.`
  } else if (audience === 'coach') {
    bodyText = `${sponsorName} marked a ${formattedAmount} payment as sent ${daysOpen} days ago. Confirm it when it lands — that's what closes the loop and triggers your acknowledgment letter.`
  } else if (audience === 'admin') {
    bodyText = `${sponsorName} → ${fullTeamName}, ${formattedAmount}, ${status} for ${daysOpen} days. Both sides have stopped responding to automated reminders.`
  } else {
    bodyText = `Update regarding ${formattedAmount} commitment between ${sponsorName} and ${fullTeamName}.`
  }

  return (
    <Html>
      <Head />
      <Preview>Fulfillment update: {sponsorName} &amp; {fullTeamName}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={section}>
            <Text style={text}>Hi {recipientName},</Text>
            <Text style={text}>{bodyText}</Text>
            <Section style={buttonContainer}>
              <Link href={ctaUrl} style={button}>{ctaLabel}</Link>
            </Section>
            <Text style={text}>
              Best,<br />
              The FTC Sponsorship Portal Team
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

const main = {
  backgroundColor: '#f6f9fc',
  fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
}

const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '20px 0 48px',
  marginBottom: '64px',
}

const section = {
  padding: '0 48px',
}

const text = {
  color: '#333',
  fontSize: '16px',
  lineHeight: '24px',
}

const buttonContainer = {
  padding: '24px 0',
  textAlign: 'center' as const,
}

const button = {
  backgroundColor: '#000',
  borderRadius: '4px',
  color: '#fff',
  fontSize: '16px',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
  padding: '12px 24px',
}

