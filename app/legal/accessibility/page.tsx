import type { Metadata } from 'next'
import { BackButton } from '@/components/ui/back-button'
import { SUPPORT_EMAIL } from '@/lib/site-config'

export const metadata: Metadata = {
  title: 'Accessibility Statement',
  description:
    'How FTC Pitfund conforms to WCAG 2.2 Level AA, what has been verified, and the gaps we know about.',
}

/**
 * A VPAT-style conformance statement. Procurement and compliance teams ask for one in
 * writing before they will approve a vendor.
 *
 * The review date is HARDCODED, not `new Date()`. A statement that always claims to have
 * been reviewed today is worse than no statement: it is a false assertion about when a
 * human last looked, and the whole point of the document is that a human did. Update the
 * constant when an audit actually happens.
 */
const LAST_REVIEWED = 'August 15, 2026'
const STANDARD = 'WCAG 2.2 Level AA'

export default function AccessibilityStatementPage() {
  return (
    <div className="container mx-auto max-w-3xl py-12 space-y-8">
      <BackButton />

      <div>
        <h1 className="text-3xl font-bold">Accessibility Statement</h1>
        <p className="text-muted-foreground mt-2">Last reviewed: {LAST_REVIEWED}</p>
      </div>

      <div className="prose prose-invert">
        <h2>Our commitment</h2>
        <p>
          FTC Pitfund is used by coaches, school staff and corporate sponsorship teams, and it
          handles decisions about real money. Everyone who needs to use it should be able to,
          including people who navigate by keyboard, use a screen reader or other assistive
          technology, need magnification, or are sensitive to motion.
        </p>

        <h2>Standard we target</h2>
        <p>
          We target <strong>{STANDARD}</strong>, the level referenced by Section 508 of the US
          Rehabilitation Act and by EN 301 549 in the EU.
        </p>

        <h2>Current conformance status</h2>
        <p>
          <strong>Partially conformant.</strong> Partially conformant means most of the
          platform meets the standard, but some content does not yet fully conform. We are
          stating this rather than claiming full conformance because we have verified some
          areas and not others, and it would be misleading to imply otherwise.
        </p>

        <h3>What has been verified</h3>
        <p>
          An automated audit at {STANDARD} (axe-core, run against every release as part of our
          test suite) covers the public marketing and legal pages, the coach signup flow, the
          pitch submission form, the sponsor review and decision screens, and the
          sponsor-facing pitch page reached from an emailed link. These pages are also checked
          for landmark regions, heading order, and a working skip-to-content link. In addition:
        </p>
        <ul>
          <li>
            The sponsor funding decision can be completed using only the keyboard, with no
            pointing device.
          </li>
          <li>
            Dialogs trap focus while open, close on <kbd>Escape</kbd>, and return focus to the
            control that opened them.
          </li>
          <li>
            Animation is removed — not merely shortened — when the operating system requests
            reduced motion.
          </li>
          <li>
            Form validation errors are associated with their field programmatically and
            announced, not signalled by colour alone.
          </li>
        </ul>

        <h3>Known gaps</h3>
        <p>These are the areas we know fall short today:</p>
        <ul>
          <li>
            <strong>Administrator screens.</strong> The internal moderation, analytics and
            audit surfaces have not been through the same audit as the coach and sponsor
            journeys. They are staff-only, so they are lower priority, but they are not
            verified.
          </li>
          <li>
            <strong>Data visualisations.</strong> Charts on the analytics and impact-report
            screens convey trend information graphically. Underlying figures are available as
            CSV export, but the charts themselves do not yet have full text alternatives.
          </li>
          <li>
            <strong>Rich text editing.</strong> The portfolio and pitch editors are usable by
            keyboard, but their formatting toolbars have not been tested against every
            screen-reader and browser combination.
          </li>
          <li>
            <strong>Third-party components.</strong> Sign-in, sign-up and password screens are
            rendered by Clerk, our authentication provider. We do not control their markup.
          </li>
          <li>
            <strong>Uploaded content.</strong> Team photographs and documents are uploaded by
            coaches. We prompt for alternative text but cannot guarantee it is supplied or
            accurate.
          </li>
          <li>
            <strong>Screen-reader coverage.</strong> Manual testing has been done with
            VoiceOver on macOS. NVDA and JAWS on Windows have not been tested.
          </li>
        </ul>

        <h2>Technical approach</h2>
        <p>
          The interface is built on accessible component primitives (Radix UI) and is tested
          automatically with axe-core on every change, so a new accessibility defect fails the
          build rather than accumulating quietly. Suppressing a rule requires a written
          justification in the change itself.
        </p>

        <h2>Compatibility</h2>
        <p>
          The platform is designed to work with current versions of Chrome, Edge, Firefox and
          Safari, with the screen reader built into the operating system. It is not tested
          against browsers more than two major versions old.
        </p>

        <h2>Feedback and enforcement</h2>
        <p>
          If you encounter a barrier, please tell us — reports from real use are the most
          valuable thing we get. Email{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> with the page address, what
          you were trying to do, and the assistive technology and browser you were using. We
          aim to respond within five business days.
        </p>
        <p>
          If our response does not resolve the problem, say so in reply and it will be
          escalated rather than closed.
        </p>

        <h2>Formal evaluation</h2>
        <p>
          This statement is a self-assessment. It has not been prepared or reviewed by an
          independent third-party accessibility auditor. If you require a full VPAT prepared
          under third-party review as a condition of procurement, contact us at the address
          above and we will arrange one.
        </p>
      </div>
    </div>
  )
}
