'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'
import Link from 'next/link'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { cn } from '@/lib/utils'

export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  useEffect(() => {
    // A11-02. This boundary only console.error'd. Sentry auto-captures Server Component
    // crashes through captureRequestError in instrumentation.ts, but a client-side error
    // that lands HERE renders a 200 and vanishes — the operator sees a healthy request and
    // the user sees "Something went wrong". Capturing here is the only report there is.
    Sentry.captureException(error, {
      tags: { boundary: 'app/error' },
      // The digest is how a client-side error is correlated with the server-side log
      // entry for the same failure; without it the two are unmatchable.
      extra: { digest: error.digest },
    })
    console.error('[app/error] Unhandled error:', error)
  }, [error])

  const showDetails = process.env.NODE_ENV !== 'production'

  return (
    <div className="container mx-auto flex min-h-[60vh] items-center justify-center py-16">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Something went wrong</CardTitle>
          <CardDescription>
            We hit an unexpected error while loading this page. You can try again or head back home.
          </CardDescription>
        </CardHeader>
        {showDetails && (
          <CardContent>
            <pre className="whitespace-pre-wrap break-words rounded bg-muted p-3 font-mono text-xs text-muted-foreground">
              {error.message}
              {error.digest ? `\n\ndigest: ${error.digest}` : ''}
            </pre>
          </CardContent>
        )}
        <CardFooter className="flex gap-2">
          <Button onClick={() => unstable_retry()}>Try again</Button>
          <Link href="/" className={cn(buttonVariants({ variant: 'outline' }))}>
            Go home
          </Link>
        </CardFooter>
      </Card>
    </div>
  )
}
