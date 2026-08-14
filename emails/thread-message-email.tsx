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

interface ThreadMessageEmailProps {
  recipientName: string
  counterpartyLabel: string
  teamName: string
  sponsorName: string
  messageBody: string
  ctaUrl?: string
  ctaLabel?: string
}

/**
 * A single released Q&A message, and nothing else.
 *
 * CORE MANDATE 2 BOUNDARY — read before editing. Sponsor-facing *pitch dispatch* goes
 * exclusively through dispatchApprovedSubmission (lib/dispatch.ts). This template is the
 * obvious place to accidentally rebuild it, so it deliberately carries no budget items, no
 * media URLs, no mission statement, no achievements, no team stats — no portfolio field of
 * any kind. If you find yourself importing lib/dispatch-budget.ts here, stop.
 *
 * The body is already plain text: it was stored through plainTextField, which flattens
 * markup, so nothing here can render an embedded image.
 */
export default function ThreadMessageEmail({
  recipientName,
  counterpartyLabel,
  teamName,
  sponsorName,
  messageBody,
  ctaUrl,
  ctaLabel,
}: ThreadMessageEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{`${counterpartyLabel} replied about ${teamName}`}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{counterpartyLabel} replied</Heading>
          <Text style={text}>
            Hi {recipientName} — a new message on the {teamName} proposal to {sponsorName}.
          </Text>
          <Container style={quote}>
            {messageBody
              .split('\n')
              .filter(Boolean)
              .map((line, i) => (
                <Text key={i} style={quoteText}>
                  {line}
                </Text>
              ))}
          </Container>
          {ctaUrl ? (
            <Button style={button} href={ctaUrl}>
              {ctaLabel || 'Open the conversation'}
            </Button>
          ) : null}
          <Text style={text}>— The FTC Pitfund team</Text>
          <Hr style={hr} />
          <Text style={footer}>
            FTC Pitfund · Messages on this thread are reviewed by our team before they reach
            you. Replies to this address go to support, not to the sender.
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
const quote = {
  backgroundColor: '#f6f9fc',
  borderLeft: '3px solid #111111',
  borderRadius: '4px',
  padding: '12px 16px',
  margin: '12px 0',
}
const quoteText = {
  color: '#111111',
  fontSize: '14px',
  lineHeight: '22px',
  margin: '0 0 6px',
  whiteSpace: 'pre-wrap' as const,
}
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
