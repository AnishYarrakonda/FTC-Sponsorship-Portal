import { Skeleton } from '@/components/ui/skeleton'

export default function AdminTeamLoading() {
  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      {/* Add an admin */}
      <div className="rounded-xl border border-border bg-card/60 p-5 space-y-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-72 max-w-full" />
        <div className="flex flex-col gap-3 sm:flex-row">
          <Skeleton className="h-9 flex-1" />
          <Skeleton className="h-9 w-full sm:w-52" />
          <Skeleton className="h-9 w-28" />
        </div>
      </div>

      {/* Roster */}
      <div className="rounded-xl border border-border bg-card/60 p-5 space-y-4">
        <Skeleton className="h-4 w-28" />
        {[...Array(3)].map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-4 py-2">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-56" />
              <Skeleton className="h-3 w-72 max-w-full" />
            </div>
            <Skeleton className="h-8 w-32 rounded-md shrink-0" />
          </div>
        ))}
      </div>
    </div>
  )
}
