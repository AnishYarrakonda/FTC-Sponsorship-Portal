import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Verify your email',
}


// Email verification now happens inline during the signup wizard (Clerk email
// code), so this page is informational. It stays reachable as a friendly
// fallback / bookmark target and links users back to where they need to go.
export default function VerifyEmailPage() {
  return (
    <div className="container mx-auto flex items-center justify-center min-h-screen py-12">
      <Card className="w-full max-w-md mx-auto text-center">
        <CardHeader>
          <CardTitle>You&apos;re all set</CardTitle>
          <CardDescription>
            Email verification is handled during sign up. If you&apos;ve already created your
            account, you can continue from here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Coaches: finish uploading your credential photo. Sponsors: your application is under review.
          </p>
          <div className="flex flex-col gap-2">
            <Link href="/login" className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}>
              Go to Login
            </Link>
            <Link href="/signup" className={cn(buttonVariants({ variant: 'ghost' }), 'w-full')}>
              Back to Sign Up
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
