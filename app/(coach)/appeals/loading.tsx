import { Skeleton } from '@/components/ui/skeleton'

export default function CoachAppealsLoading() {
  return (
    <div className="container mx-auto max-w-3xl space-y-6 py-8">
      <div className="space-y-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <Skeleton className="h-48 w-full rounded-xl" />
      <Skeleton className="h-56 w-full rounded-xl" />
    </div>
  )
}
