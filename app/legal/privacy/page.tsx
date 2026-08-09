import type { Metadata } from 'next'
import { BackButton } from '@/components/ui/back-button'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'How FTC Pitfund collects, uses and safeguards your information.',
}

export default function PrivacyPolicyPage() {
  return (
    <div className="container mx-auto max-w-3xl py-12 space-y-8">
      <BackButton />

      <div>
        <h1 className="text-3xl font-bold">Privacy Policy</h1>
        <p className="text-muted-foreground mt-2" suppressHydrationWarning>Last updated: {new Date().toLocaleDateString()}</p>
      </div>

      <div className="prose prose-invert">
        <h2>1. Introduction</h2>
        <p>
          FTC Pitfund ("we," "our," or "us") is committed to protecting the privacy of its users. This policy outlines how we collect, use, and safeguard information.
        </p>

        <h2>2. COPPA Compliance & Student Data</h2>
        <p>
          <strong>We do not collect, store, or process any Personally Identifiable Information (PII) from individuals under the age of 13.</strong> 
          Our platform is exclusively designed for use by verified adult coaches, mentors, and corporate sponsors. 
          If we discover that an account has been created by a minor, it will be immediately deleted.
        </p>

        <h2>3. Information We Collect</h2>
        <ul>
          <li><strong>Coach Information:</strong> Name, email address, and verification credentials (e.g., school ID, FIRST certification).</li>
          <li><strong>Team Information:</strong> Team number, location, mission statement, and public achievements.</li>
          <li><strong>Sponsor Information:</strong> Company name, contact details, and funding capacity.</li>
        </ul>

        <h2>4. How We Use Information</h2>
        <p>
          Information is used solely to facilitate the matching of robotics teams with corporate sponsors. We do not sell data to third parties.
        </p>

        <h2>5. Data Retention</h2>
        <p>
          <strong>Identity documents are deleted as soon as they have been reviewed.</strong> A coach&apos;s photo ID
          exists for one purpose — confirming that an adult is behind the account — and once an administrator
          approves or denies that account, the file is permanently erased from our storage. We keep only a
          timestamp recording that the check took place. We never retain a copy, and there is no way for us to
          recover one.
        </p>
        <p>
          Deleting your account removes your profile and every file you have uploaded, including your team logo
          and any pitch images.
        </p>

        <h2>6. Data Security</h2>
        <p>
          We employ industry-standard security measures, including Row-Level Security (RLS) in our database, to ensure that team and sponsor data is isolated and protected.
        </p>
      </div>
    </div>
  )
}
