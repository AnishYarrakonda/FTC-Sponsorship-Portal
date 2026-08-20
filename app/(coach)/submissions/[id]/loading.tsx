import { Skeleton } from '@/components/ui/skeleton'

export default function SubmissionDetailLoading() {
  return (
    <div className="container mx-auto max-w-3xl flex flex-col gap-6 py-8">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
        <Skeleton className="h-6 w-24 rounded-full" />
      </div>
      <Skeleton className="h-20 w-full rounded-md" />
      <Skeleton className="h-28 w-full rounded-md" />
      <Skeleton className="h-64 w-full rounded-md" />
    </div>
  )
}
