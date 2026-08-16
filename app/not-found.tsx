import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export default function NotFound() {
  return (
    <div className="container mx-auto max-w-md py-24 text-center">
      <p className="text-6xl font-bold text-muted-foreground">404</p>
      <h1 className="mt-4 text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 text-muted-foreground">
        The page you&apos;re looking for doesn&apos;t exist or you don&apos;t have access.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <Link href="/" className={cn(buttonVariants())}>Go home</Link>
        <Link href="/dashboard" className={cn(buttonVariants({ variant: 'outline' }))}>Dashboard</Link>
      </div>
    </div>
  )
}
