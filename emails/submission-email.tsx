import {
  Html, Head, Preview, Body, Container, Section,
  Heading, Text, Hr, Img, Button, Row, Column,
} from '@react-email/components'
import * as React from 'react'
import DOMPurify from 'isomorphic-dompurify'
import { htmlToPlainText } from '@/lib/utils'

// Rich-text fields are stored as sanitized HTML. Sanitize again on render (defense in depth)
// and strip tags where we need a short plaintext preview.
const sanitizeHtml = (s: string | null | undefined) => DOMPurify.sanitize(s ?? '')
const stripTags = (s: string | null | undefined) =>
  (s ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

interface BudgetItem {
  label: string
  qty: number
  unitCostCents: number
  totalCents: number
}

interface SubmissionEmailProps {
  teamName: string
  ftcTeamNumber: number | null
  state: string
  taxStatus: string
  missionStatement: string | null
  technicalSummary: string | null
  outreachSummary: string | null
  financialAskCents: number
  budgetItems: BudgetItem[]
  customPitchAlignment: string
  specificNeedsStatement: string
  heroImageUrl: string | null
  viewerUrl: string | null
  /**
   * The live recognition ladder, already formatted by lib/recognition.ts. Optional and
   * fully absent-safe: a team pitching before an admin has configured any tier must still
   * get a correct email, so an empty or missing array renders nothing at all.
   */
  recognitionTiers?: { name: string; range: string; benefits: string[] }[]
}

function taxBadgeLabel(taxStatus: string): string | null {
  if (taxStatus === '501c3') return '✓ IRS 501(c)(3) Tax-Exempt'
  if (taxStatus === 'School') return '✓ Public School Program'
  return null
}

export default function SubmissionEmail({
  teamName,
  ftcTeamNumber,
  state,
  taxStatus,
  missionStatement,
  technicalSummary,
  outreachSummary,
  financialAskCents,
  budgetItems,
  customPitchAlignment,
  specificNeedsStatement,
  heroImageUrl,
  viewerUrl,
  recognitionTiers,
}: SubmissionEmailProps) {
  const taxLabel = taxBadgeLabel(taxStatus)
  const totalDisplay = `$${(financialAskCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
  const teamLabel = ftcTeamNumber ? `Team #${ftcTeamNumber}` : 'Incubator Team'

  return (
    <Html>
      <Head />
      <Preview>Verified FTC Robotics Sponsorship Proposal: {teamLabel} ({state})</Preview>
      <Body style={main}>
        <Container style={container}>

          {/* Hero image */}
          {heroImageUrl && (
            <Section style={{ marginBottom: '24px' }}>
              <Img
                src={heroImageUrl}
                alt={`${teamName} robot photo`}
                width="580"
                style={{ borderRadius: '8px', objectFit: 'cover', maxHeight: '300px', width: '100%' }}
              />
            </Section>
          )}

          {/* Header */}
          <Section style={headerSection}>
            <Heading style={h1}>Sponsorship Proposal: {teamName}</Heading>
            <Text style={subhead}>{teamLabel} · {state}</Text>
            {taxLabel && (
              <Section style={taxBadge}>
                <Text style={taxBadgeText}>{taxLabel}</Text>
              </Section>
            )}
          </Section>

          {/* 2-sentence summary */}
          <Section style={summaryBox}>
            {missionStatement && (
              <Text style={text}>
                {stripTags(missionStatement).slice(0, 300)}{stripTags(missionStatement).length > 300 ? '…' : ''}
              </Text>
            )}
            <Text style={{ ...text, marginTop: '8px' }}>
              <strong>Total Sponsorship Request: {totalDisplay}</strong>
            </Text>
          </Section>

          <Hr style={hr} />

          {/* Custom pitch */}
          <Section style={pitchBox}>
            <Heading style={h2}>Why We Align With You</Heading>
            <Text style={{ ...text, whiteSpace: 'pre-wrap' }}>{htmlToPlainText(customPitchAlignment)}</Text>
          </Section>

          <Section style={{ marginTop: '16px' }}>
            <Heading style={h2}>Our Specific Needs</Heading>
            <Text style={{ ...text, whiteSpace: 'pre-wrap' }}>{htmlToPlainText(specificNeedsStatement)}</Text>
          </Section>

          <Hr style={hr} />

          {/* Portfolio */}
          <Heading style={h2}>Team Portfolio</Heading>
          {technicalSummary && (
            <Section style={{ marginBottom: '12px' }}>
              <Text style={label}>Technical Summary</Text>
              <div style={text} dangerouslySetInnerHTML={{ __html: sanitizeHtml(technicalSummary) }} />
            </Section>
          )}
          {outreachSummary && (
            <Section style={{ marginBottom: '12px' }}>
              <Text style={label}>Community Outreach</Text>
              <div style={text} dangerouslySetInnerHTML={{ __html: sanitizeHtml(outreachSummary) }} />
            </Section>
          )}

          <Hr style={hr} />

          {/* Budget */}
          <Heading style={h2}>
            Budget Breakdown — Total Ask: <strong>{totalDisplay}</strong>
          </Heading>
          <Section style={budgetTable}>
            {budgetItems && budgetItems.map((item, i) => (
              <Row key={i} style={budgetRow}>
                <Column style={{ ...budgetCell, width: '60%' }}>
                  {item.qty}× {item.label}
                </Column>
                <Column style={{ ...budgetCell, textAlign: 'right', fontWeight: 'bold' }}>
                  ${(item.totalCents / 100).toFixed(2)}
                </Column>
              </Row>
            ))}
            <Row style={{ ...budgetRow, borderTop: '2px solid #e2e8f0', marginTop: '4px' }}>
              <Column style={{ ...budgetCell, width: '60%', fontWeight: 'bold' }}>Total</Column>
              <Column style={{ ...budgetCell, textAlign: 'right', fontWeight: 'bold', fontSize: '16px' }}>
                {totalDisplay}
              </Column>
            </Row>
          </Section>

          {/* What the sponsor gets back. Reuses the budget table's styles deliberately —
              this is the most important email the product sends and is not the place to
              introduce a second visual language. */}
          {recognitionTiers && recognitionTiers.length > 0 && (
            <>
              <Hr style={hr} />
              <Heading style={h2}>What your sponsorship earns</Heading>
              <Section style={budgetTable}>
                {recognitionTiers.map((tier, i) => (
                  <Row key={i} style={budgetRow}>
                    <Column style={{ ...budgetCell, width: '38%', fontWeight: 'bold' }}>
                      {tier.name}
                      <br />
                      <span style={{ fontWeight: 'normal', color: '#64748b' }}>{tier.range}</span>
                    </Column>
                    <Column style={budgetCell}>{tier.benefits.join(' · ')}</Column>
                  </Row>
                ))}
              </Section>
              <Text style={{ ...footer, marginTop: '8px' }}>
                Recognition levels are indicative and are confirmed when a sponsorship is finalised.
              </Text>
            </>
          )}

          <Hr style={hr} />

          {/* CTA */}
          {viewerUrl ? (
            <Section style={{ textAlign: 'center' as const, marginTop: '24px' }}>
              <Text style={text}>
                View the full portfolio and respond to this proposal using the secure link below.
                This link expires in 14 days.
              </Text>
              <Button href={viewerUrl} style={ctaButton}>
                View Proposal & Respond →
              </Button>
            </Section>
          ) : (
            <Text style={{ ...text, color: '#6b7280' }}>
              Reply to this email to get in touch with the team coach directly.
            </Text>
          )}

          <Hr style={hr} />
          <Text style={footer}>
            This proposal was verified and dispatched by the FTC Pitfund team. You
            received it because your organization is registered as a prospective FTC robotics
            sponsor with FTC Pitfund.
            {taxLabel ? ' Contributions may be tax-deductible — consult your tax advisor.' : ''}
          </Text>

        </Container>
      </Body>
    </Html>
  )
}

const main = { backgroundColor: '#f8fafc', fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }
const container = { margin: '0 auto', padding: '32px 20px 48px', maxWidth: '600px', backgroundColor: '#ffffff', borderRadius: '12px' }
const headerSection = { marginBottom: '20px' }
const h1 = { fontSize: '26px', fontWeight: '700', color: '#0f172a', margin: '0 0 4px' }
const h2 = { fontSize: '18px', fontWeight: '600', color: '#1e293b', margin: '0 0 8px' }
const subhead = { fontSize: '14px', color: '#64748b', margin: '0 0 12px' }
const text = { fontSize: '14px', lineHeight: '22px', color: '#334155', margin: '0' }
const label = { fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase' as const, letterSpacing: '0.08em', margin: '0 0 4px' }
const hr = { borderColor: '#e2e8f0', margin: '24px 0' }
const taxBadge = { display: 'inline-block', backgroundColor: '#dcfce7', borderRadius: '6px', padding: '4px 12px', marginTop: '4px' }
const taxBadgeText = { fontSize: '12px', fontWeight: '700', color: '#15803d', margin: '0' }
const summaryBox = { backgroundColor: '#f1f5f9', borderRadius: '8px', padding: '16px 20px', marginBottom: '20px' }
const pitchBox = { backgroundColor: '#eff6ff', borderRadius: '8px', padding: '16px 20px', border: '1px solid #bfdbfe' }
const budgetTable = { backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px 16px' }
const budgetRow = { padding: '4px 0' }
const budgetCell = { fontSize: '13px', color: '#334155', padding: '4px 0' }
const ctaButton = { backgroundColor: '#2563eb', color: '#ffffff', padding: '14px 28px', borderRadius: '8px', fontWeight: '700', fontSize: '15px', textDecoration: 'none', display: 'inline-block', margin: '16px auto' }
const footer = { fontSize: '11px', color: '#94a3b8', lineHeight: '18px', marginTop: '16px' }
