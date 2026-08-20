import { Skeleton } from '@/components/ui/skeleton'

export default function AppealsLoading() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="flex flex-col gap-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="rounded-xl border p-5 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-4 w-56" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-20 w-full rounded-lg" />
            <Skeleton className="h-8 w-36 rounded-md" />
          </div>
        ))}
      </div>
    </div>
  )
}
