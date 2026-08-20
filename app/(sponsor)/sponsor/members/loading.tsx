import { Skeleton } from '@/components/ui/skeleton'

export default function SponsorMembersLoading() {
  return (
    <div className="space-y-8">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-64 rounded-xl" />
    </div>
  )
}
