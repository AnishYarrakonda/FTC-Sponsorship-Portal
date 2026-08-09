import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Text,
} from '@react-email/components'
import * as React from 'react'

interface NotificationEmailProps {
  title: string
  body?: string
  ctaUrl?: string
  ctaLabel?: string
}

/**
 * Generic transactional notification email. Mirrors an in-app inbox alert so the
 * two channels always stay in sync (see createInAppNotification in lib/notify.ts).
 */
export default function NotificationEmail({
  title,
  body,
  ctaUrl,
  ctaLabel,
}: NotificationEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{title}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{title}</Heading>
          {body
            ? body.split('\n').filter(Boolean).map((line, i) => (
                <Text key={i} style={text}>
                  {line}
                </Text>
              ))
            : null}
          {ctaUrl ? (
            <Button style={button} href={ctaUrl}>
              {ctaLabel || 'Open the portal'}
            </Button>
          ) : null}
          <Text style={text}>— The FTC Pitfund team</Text>
          <Hr style={hr} />
          <Text style={footer}>
            FTC Pitfund · You received this email because you have an account on the
            portal; it mirrors an alert waiting in your portal inbox.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

const main = {
  backgroundColor: '#f6f9fc',
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif',
}
const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '32px',
  maxWidth: '480px',
  borderRadius: '8px',
}
const h1 = { color: '#111111', fontSize: '20px', fontWeight: 600 as const, margin: '0 0 12px' }
const text = { color: '#444444', fontSize: '14px', lineHeight: '22px', margin: '0 0 8px' }
const button = {
  backgroundColor: '#111111',
  color: '#ffffff',
  borderRadius: '6px',
  padding: '10px 18px',
  fontSize: '14px',
  textDecoration: 'none',
  display: 'inline-block',
  marginTop: '12px',
}
const hr = { borderColor: '#eeeeee', margin: '24px 0' }
const footer = { color: '#9aa0a6', fontSize: '12px', margin: 0 }
