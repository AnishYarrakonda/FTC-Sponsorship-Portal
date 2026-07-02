import * as React from 'react'
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
  Button,
} from '@react-email/components'

interface CoachDenialEmailProps {
  coachName: string
  reason: string
}

export const CoachDenialEmail = ({
  coachName,
  reason,
}: CoachDenialEmailProps) => {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  return (
    <Html>
      <Head />
      <Preview>Update required for your FTC Sponsorship Portal application</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Application Update Required</Heading>
          
          <Text style={text}>Hi {coachName},</Text>
          
          <Text style={text}>
            Thank you for applying to join the FTC Sponsorship Portal. We have reviewed your application and, unfortunately, we are unable to verify your account at this time.
          </Text>

          <Section style={reasonBox}>
            <Text style={reasonHeading}>Reason for Denial:</Text>
            <Text style={reasonText}>{reason}</Text>
          </Section>

          <Text style={text}>
            For your security, we have cleared the team data and credentials you previously uploaded. To continue with your application, please log in and submit your details again, making sure to address the issue mentioned above.
          </Text>

          <Button style={button} href={`${appUrl}/login`}>
            Log In and Re-apply
          </Button>

          <Text style={text}>— The FTC Sponsorship Portal team</Text>
          <Hr style={hr} />
          <Text style={footer}>
            FTC Sponsorship Portal · You received this email because you applied for a coach
            account on the portal. If you believe this was a mistake or need further assistance,
            please contact our support team.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export default CoachDenialEmail

// ── Styles ───────────────────────────────────────────────────────────────────

const main = {
  backgroundColor: '#f6f9fc',
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
}

const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '40px 20px',
  borderRadius: '8px',
  boxShadow: '0 4px 6px rgba(0, 0, 0, 0.05)',
  maxWidth: '600px',
}

const h1 = {
  color: '#333',
  fontSize: '24px',
  fontWeight: 'bold',
  paddingTop: '10px',
  paddingBottom: '20px',
  borderBottom: '1px solid #eaeaea',
  marginBottom: '20px',
}

const text = {
  color: '#555',
  fontSize: '16px',
  lineHeight: '24px',
  marginBottom: '20px',
}

const reasonBox = {
  backgroundColor: '#fff5f5',
  border: '1px solid #ffcccc',
  borderRadius: '6px',
  padding: '16px',
  marginBottom: '20px',
}

const reasonHeading = {
  color: '#cc0000',
  fontSize: '14px',
  fontWeight: 'bold',
  margin: '0 0 8px 0',
}

const reasonText = {
  color: '#333',
  fontSize: '15px',
  lineHeight: '22px',
  margin: '0',
}

const button = {
  backgroundColor: '#000',
  borderRadius: '6px',
  color: '#fff',
  fontSize: '16px',
  fontWeight: 'bold',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
  padding: '12px 24px',
  marginTop: '10px',
  marginBottom: '20px',
}

const hr = {
  borderColor: '#eaeaea',
  margin: '30px 0',
}

const footer = {
  color: '#8898aa',
  fontSize: '12px',
  lineHeight: '16px',
}
