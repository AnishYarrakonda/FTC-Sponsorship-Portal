
import {
  Body,
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

interface CoachSignupWelcomeEmailProps {
  coachName: string
}

export default function CoachSignupWelcomeEmail({
  coachName,
}: CoachSignupWelcomeEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Welcome to FTC Pitfund!</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Welcome, {coachName}!</Heading>
          <Text style={text}>
            Thank you for creating an account on FTC Pitfund. We&apos;re excited to help you secure funding for your team.
          </Text>
          
          <Section style={section}>
            <Heading style={h2}>Next Steps</Heading>
            <Text style={text}>
              Our team is currently reviewing your photo ID and credentials. This typically takes 24-48 hours.
            </Text>
            <Text style={text}>
              Once verified, you&apos;ll be able to:
            </Text>
            <ul style={list}>
              <li>Build your team&apos;s digital portfolio</li>
              <li>Browse available sponsors</li>
              <li>Submit funding requests</li>
            </ul>
          </Section>

          <Text style={text}>
            In the meantime, you can explore the portal and get familiar with the dashboard.
          </Text>
          
          <Text style={text}>— The FTC Pitfund team</Text>
          <Hr style={hr} />
          <Text style={footer}>
            FTC Pitfund · Supporting the next generation of engineers. You received
            this email because you created a coach account on the portal.
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
  padding: '32px',
  borderRadius: '8px',
  maxWidth: '560px',
}
const h1 = { fontSize: '24px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '16px' }
const h2 = { fontSize: '18px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '12px' }
const section = { margin: '24px 0' }
const text = { fontSize: '16px', color: '#444', lineHeight: '1.6', margin: '12px 0' }
const list = { fontSize: '16px', color: '#444', lineHeight: '1.6', paddingLeft: '20px' }
const hr = { borderColor: '#e4e4e7', margin: '32px 0' }
const footer = { fontSize: '12px', color: '#999' }
