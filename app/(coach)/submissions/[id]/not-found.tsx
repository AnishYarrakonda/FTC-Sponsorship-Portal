import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export default function SubmissionNotFound() {
  return (
    <div className="container mx-auto max-w-md py-24 text-center">
      <p className="text-6xl font-bold text-muted-foreground/40">404</p>
      <h1 className="mt-4 text-2xl font-semibold">Pitch not found</h1>
      <p className="mt-2 text-muted-foreground">
        This pitch doesn&apos;t exist or was removed. It may have expired, or the link
        might be out of date.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <Link href="/dashboard?tab=pitches" className={cn(buttonVariants())}>
          Back to my pitches
        </Link>
        <Link href="/dashboard" className={cn(buttonVariants({ variant: 'outline' }))}>
          Dashboard
        </Link>
      </div>
    </div>
  )
}
