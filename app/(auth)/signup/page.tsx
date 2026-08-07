import { SignupWizard } from '@/components/auth/signup-wizard'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Create a coach account',
  description: 'Create a verified FTC coach account and start building your team portfolio.',
}


export default function SignupPage() {
  return <SignupWizard />
}
