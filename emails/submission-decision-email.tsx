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

type Decision = 'approved' | 'declined' | 'changes_requested'

interface SubmissionDecisionEmailProps {
  coachName: string
  submissionTitle: string
  decision: Decision
  feedback?: string | null
}

const DECISION_COPY: Record<Decision, { subject: string; headline: string; body: string }> = {
  approved: {
    subject: 'Your submission has been approved 🎉',
    headline: 'Great news — your submission is approved!',
    body: "We've reviewed your submission and it's been approved. Sponsor outreach emails are now being sent on your behalf. Replies from sponsors will go directly to your email.",
  },
  declined: {
    subject: 'Update on your submission',
    headline: 'Your submission was not approved',
    body: "After review, we were unable to approve this submission at this time. Please see the admin's feedback below.",
  },
  changes_requested: {
    subject: 'Changes requested on your submission',
    headline: 'Your submission needs some changes',
    body: 'Our team reviewed your submission and would like you to make a few changes before we can approve it. Please log in, update your portfolio or the custom pitch, and resubmit.',
  },
}

export default function SubmissionDecisionEmail({
  coachName,
  submissionTitle,
  decision,
  feedback,
}: SubmissionDecisionEmailProps) {
  const copy = DECISION_COPY[decision]

  return (
    <Html>
      <Head />
      <Preview>{copy.subject}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Hello {coachName},</Heading>
          <Heading style={h2}>{copy.headline}</Heading>
          <Text style={text}>
            Submission: <strong>{submissionTitle}</strong>
          </Text>
          <Text style={text}>{copy.body}</Text>

          {feedback && (
            <Section style={feedbackBox}>
              <Text style={{ ...text, fontWeight: 600, marginBottom: 4 }}>Admin Feedback:</Text>
              <Text style={{ ...text, marginTop: 0 }}>{feedback}</Text>
            </Section>
          )}

          <Text style={text}>— The FTC Sponsorship Portal team</Text>
          <Hr style={hr} />
          <Text style={footer}>
            FTC Sponsorship Portal · You received this email because you submitted a sponsorship
            pitch on our platform.
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
  maxWidth: '600px',
}
const h1 = { fontSize: '22px', color: '#1a1a1a', marginBottom: '4px' }
const h2 = { fontSize: '18px', color: '#333', marginTop: '0' }
const text = { fontSize: '15px', color: '#444', lineHeight: '1.6' }
const feedbackBox = {
  backgroundColor: '#f4f4f5',
  borderLeft: '4px solid #888',
  padding: '12px 16px',
  borderRadius: '4px',
  margin: '16px 0',
}
const hr = { borderColor: '#e4e4e7', margin: '24px 0' }
const footer = { fontSize: '12px', color: '#999' }
