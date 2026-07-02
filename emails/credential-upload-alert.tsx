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

interface CredentialUploadAlertProps {
  coachName: string
  coachEmail: string
  teamName?: string | null
  reviewUrl: string
  /** Override the default credential-upload copy (e.g. sponsor application alerts). */
  heading?: string
  description?: string
}

export default function CredentialUploadAlert({
  coachName,
  coachEmail,
  teamName,
  reviewUrl,
  heading = 'Coach credential uploaded',
  description = 'just uploaded their credential for verification.',
}: CredentialUploadAlertProps) {
  return (
    <Html>
      <Head />
      <Preview>{heading} — action required</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{heading}</Heading>
          <Text style={text}>
            <strong>{coachName}</strong> ({coachEmail}) {description}
          </Text>
          {teamName && (
            <Text style={text}>
              Team: <strong>{teamName}</strong>
            </Text>
          )}
          <Section style={{ textAlign: 'center', margin: '24px 0' }}>
            <Button href={reviewUrl} style={button}>
              Review in admin console
            </Button>
          </Section>
          <Text style={text}>— The FTC Sponsorship Portal team</Text>
          <Hr style={hr} />
          <Text style={footer}>
            FTC Sponsorship Portal · You received this automated alert because you are an
            administrator of the portal.
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
const button = {
  backgroundColor: '#1a1a1a',
  color: '#ffffff',
  padding: '10px 18px',
  borderRadius: '6px',
  fontSize: '14px',
  textDecoration: 'none',
  display: 'inline-block',
}
const hr = { borderColor: '#e4e4e7', margin: '24px 0' }
const footer = { fontSize: '12px', color: '#999' }
