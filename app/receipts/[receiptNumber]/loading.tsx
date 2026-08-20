import { Skeleton } from '@/components/ui/skeleton'

export default function ReceiptLoading() {
  return (
    <div className="min-h-screen bg-muted/40 py-12 px-4 flex items-center justify-center">
      <div className="w-full max-w-3xl bg-background rounded-lg border p-8 space-y-6 shadow-xs">
        <div className="flex justify-between items-center">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-8 w-24" />
        </div>
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-20 w-full" />
      </div>
    </div>
  )
}
