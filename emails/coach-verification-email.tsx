import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import * as React from 'react'

interface CoachVerificationEmailProps {
  coachName: string
  appUrl?: string
}

export default function CoachVerificationEmail({
  coachName,
  appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
}: CoachVerificationEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Your FTC Sponsorship Portal coach account is now verified 🎉</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Hello {coachName},</Heading>
          <Heading style={h2}>Your account has been verified!</Heading>

          <Text style={text}>
            Great news — an FTC Sponsorship Portal admin has reviewed and approved your coach credentials. You now have full access to the platform.
          </Text>

          <Section style={ctaSection}>
            <Text style={{ ...text, fontWeight: 600, marginBottom: 16 }}>
              Here's what you can do next:
            </Text>
            <Text style={{ ...text, marginTop: 0 }}>
              ✅ Create your team&apos;s master portfolio<br />
              ✅ Browse our sponsor directory<br />
              ✅ Submit tailored pitches to sponsors
            </Text>
          </Section>

          <Button style={button} href={`${appUrl}/dashboard`}>
            Get Started →
          </Button>

          <Text style={text}>— The FTC Sponsorship Portal team</Text>
          <Hr style={hr} />
          <Text style={footer}>
            FTC Sponsorship Portal · You received this email because you created a coach account on our platform.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

const main = { backgroundColor: '#0a0a0a', fontFamily: 'sans-serif' }
const container = {
  backgroundColor: '#18181b',
  border: '1px solid #27272a',
  margin: '32px auto',
  padding: '32px',
  borderRadius: '12px',
  maxWidth: '580px',
}
const h1 = { fontSize: '20px', color: '#e4e4e7', marginBottom: '4px' }
const h2 = { fontSize: '24px', color: '#f4f4f5', fontWeight: 700, marginTop: 0 }
const text = { fontSize: '15px', color: '#a1a1aa', lineHeight: '1.7' }
const ctaSection = {
  backgroundColor: '#1c1c1e',
  border: '1px solid #3f3f46',
  borderRadius: '8px',
  padding: '20px 24px',
  margin: '20px 0',
}
const button = {
  display: 'inline-block',
  backgroundColor: '#f4f4f5',
  color: '#0a0a0a',
  fontSize: '14px',
  fontWeight: 600,
  padding: '12px 24px',
  borderRadius: '8px',
  textDecoration: 'none',
  margin: '8px 0 24px',
}
const hr = { borderColor: '#27272a', margin: '24px 0' }
const footer = { fontSize: '12px', color: '#52525b' }
