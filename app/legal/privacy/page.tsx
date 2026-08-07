import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'How FTC Matchmaker collects, uses and safeguards your information.',
}

export default function PrivacyPolicyPage() {
  return (
    <div className="container mx-auto max-w-3xl py-12 space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Privacy Policy</h1>
        <p className="text-muted-foreground mt-2" suppressHydrationWarning>Last updated: {new Date().toLocaleDateString()}</p>
      </div>

      <div className="prose prose-invert">
        <h2>1. Introduction</h2>
        <p>
          The FTC Matchmaker ("we," "our," or "us") is committed to protecting the privacy of its users. This policy outlines how we collect, use, and safeguard information.
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

        <h2>5. Data Security</h2>
        <p>
          We employ industry-standard security measures, including Row-Level Security (RLS) in our database, to ensure that team and sponsor data is isolated and protected.
        </p>
      </div>
    </div>
  )
}
