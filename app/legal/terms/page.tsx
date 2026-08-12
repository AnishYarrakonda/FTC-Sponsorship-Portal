import type { Metadata } from 'next'
import Link from 'next/link'
import { BackButton } from '@/components/ui/back-button'

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'The terms governing use of the FTC Pitfund sponsorship platform.',
}

export default function TermsOfServicePage() {
  return (
    <div className="container mx-auto max-w-3xl py-12 space-y-8">
      <BackButton />

      <div>
        <h1 className="text-3xl font-bold">Terms of Service</h1>
        <p className="text-muted-foreground mt-2" suppressHydrationWarning>Last updated: {new Date().toLocaleDateString()}</p>
      </div>

      <div className="prose prose-invert">
        <h2>1. Acceptance of Terms</h2>
        <p>
          By creating an account on FTC Pitfund, you agree to comply with these terms. This platform connects FIRST Tech Challenge (FTC) robotics teams with potential corporate sponsors.
        </p>

        <h2>2. Eligibility</h2>
        <p>
          You must be an adult (18 years or older) coach, lead mentor, or verified school official to register a team. Students are strictly prohibited from creating accounts. By registering, you attest that you are an authorized adult representative.
        </p>

        <h2>3. Prohibited Conduct</h2>
        <ul>
          <li>Misrepresenting your team's status, achievements, or financial needs.</li>
          <li>Submitting fraudulent financial asks.</li>
          <li>Attempting to bypass the review system or contact sponsors directly without platform approval.</li>
          <li>Uploading or sharing personally identifiable information (PII) of minors.</li>
        </ul>

        <h2>4. Review & Email Dispatch</h2>
        <p>
          All pitch submissions are subject to review and approval by our administrative team. We reserve the right to edit, reject, or request changes to any pitch. An approved pitch will be dispatched via email to selected sponsors; however, we do not guarantee funding or a response from sponsors.
        </p>

        <h2>5. Sponsor Funding Caps</h2>
        <p>
          We respect sponsor funding caps. If a sponsor has reached their allocated budget, they will be removed from the active directory. The platform is not responsible for fulfilling any financial shortfalls.
        </p>

        <h2>6. Termination</h2>
        <p>
          We reserve the right to suspend or terminate accounts that violate these terms, specifically focusing on COPPA violations or fraudulent activity.
        </p>

        {/* ATTORNEY REVIEW REQUIRED */}
        <h2>7. Our Role — Facilitator, Not Fiduciary</h2>
        <p>
          FTC Pitfund introduces teams to sponsors and tracks the state of a sponsorship commitment
          from pitch to payment. The platform is not a party to any sponsorship, is not an agent of
          either the sponsor or the team, is not a fiduciary to either party, and is not a
          broker-dealer, charity, or fiscal sponsor.
        </p>

        {/* ATTORNEY REVIEW REQUIRED */}
        <h2>8. How Funds Move</h2>
        <p>
          <strong>The platform never receives, holds, escrows, or transmits sponsorship funds.</strong>{' '}
          Payment is made directly by the sponsor to the team or its fiscal host, outside the
          platform. The platform records what the parties tell it about that payment; a record here
          is not proof that payment occurred and creates no obligation on the platform to pay
          anyone.
        </p>

        {/* ATTORNEY REVIEW REQUIRED */}
        <h2>9. The Sponsorship Agreement</h2>
        <p>
          Each funded sponsorship is governed by the Sponsorship Agreement executed between the
          sponsor and the team. A specimen of the current Sponsorship Agreement is available at{' '}
          <Link href="/legal/agreement">/legal/agreement</Link>. Where these Terms and an executed
          Sponsorship Agreement conflict as to the sponsorship itself, the Sponsorship Agreement
          governs; these Terms continue to govern your use of the platform.
        </p>

        {/* ATTORNEY REVIEW REQUIRED */}
        <h2>10. Electronic Signatures</h2>
        <p>
          By using the platform's signing flow, you consent to conduct transactions electronically
          and agree that a typed name submitted through that flow is a legally binding signature
          under the U.S. Electronic Signatures in Global and National Commerce Act (ESIGN) and
          applicable state UETA law. You may request a copy of any document you have signed, and you
          may withdraw your consent to transact electronically prospectively by contacting us.
        </p>

        {/* ATTORNEY REVIEW REQUIRED */}
        <h2>11. No Warranty; Limitation of Liability</h2>
        <p>
          The platform is provided "as is." We do not guarantee that any team will receive funding,
          that any sponsor will respond, or that any payment will be made. To the fullest extent
          permitted by law, our aggregate liability to you arising out of or relating to the
          platform is capped at the greater of the fees you have paid us (currently zero) or one
          hundred U.S. dollars (US$100), and we are not liable for any indirect, incidental, or
          consequential damages.
        </p>

        {/* ATTORNEY REVIEW REQUIRED */}
        <h2>12. Indemnification</h2>
        <p>
          You agree to indemnify and hold the platform harmless from claims arising out of your
          misuse of sponsorship funds, your misrepresentation of any information provided to the
          platform or to a counterparty, and your violation of COPPA or of these Terms.
        </p>

        {/* ATTORNEY REVIEW REQUIRED */}
        <h2>13. Governing Law and Venue</h2>
        <p>TODO(legal): jurisdiction to be set by counsel.</p>

        {/* ATTORNEY REVIEW REQUIRED */}
        <h2>14. Changes to These Terms</h2>
        <p>
          We may update these Terms from time to time. If we make a material change, we will notify
          you through the platform or by email before it takes effect. Your continued use of the
          platform after a change takes effect constitutes acceptance of the updated Terms.
        </p>
      </div>
    </div>
  )
}
