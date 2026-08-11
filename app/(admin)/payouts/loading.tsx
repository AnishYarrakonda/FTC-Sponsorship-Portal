import { PageHeader } from '@/components/page-header'
import { Card } from '@/components/ui/card'

export default function PayoutsLoading() {
  return (
    <div className="flex flex-col gap-10 animate-pulse">
      <PageHeader
        title="Payout Profiles & W-9s"
        subtitle="Verify team W-9s and tax information. Sponsors cannot see payout details until a W-9 is verified."
      />
      <section className="flex flex-col gap-4">
        <div className="h-5 w-40 bg-muted rounded"></div>
        <div className="flex flex-col gap-3">
          <Card className="h-40 bg-card rounded-xl border border-border" />
          <Card className="h-40 bg-card rounded-xl border border-border" />
        </div>
      </section>
    </div>
  )
}
