import { SponsorSignupWizard } from '@/components/auth/sponsor-signup-wizard'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Become a sponsor',
  description: 'Apply to sponsor FIRST Tech Challenge teams through a moderated pipeline.',
}


export default function SponsorApplicationPage() {
  return (
    <SponsorSignupWizard />
  )
}
