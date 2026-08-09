import type { Metadata } from 'next'
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
      </div>
    </div>
  )
}
