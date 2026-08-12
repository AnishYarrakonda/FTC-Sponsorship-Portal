import { Skeleton } from '@/components/ui/skeleton'

export default function SponsorSignAgreementLoading() {
  return (
    <div className="container mx-auto max-w-3xl space-y-6 py-10">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8 w-72" />
      <Skeleton className="h-[60vh] rounded-xl" />
      <Skeleton className="h-48 rounded-xl" />
    </div>
  )
}
