import { Suspense } from 'react'
import { LoginForm } from '@/components/auth/login-form'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to your FTC Matchmaker coach, sponsor or admin account.',
}


export default function LoginPage() {
  // LoginForm reads useSearchParams() (e.g. ?next, ?deleted); a Suspense boundary is
  // required so static prerendering of this public page doesn't bail out.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}
