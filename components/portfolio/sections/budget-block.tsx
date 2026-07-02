interface BudgetItem {
  label: string
  qty: number
  unit_cost_cents: number
  total_cents: number
}

interface Props {
  items: BudgetItem[]
  totalCents: number
  sustainabilityPlan?: string | null
  seedFundingGoalsCents?: number | null
}

export function BudgetBlock({ items, totalCents, sustainabilityPlan, seedFundingGoalsCents }: Props) {
  const seedGoal = seedFundingGoalsCents && seedFundingGoalsCents > 0 ? seedFundingGoalsCents : null
  if (items.length === 0 && !sustainabilityPlan && !seedGoal) return null
  const fmt = (cents: number) =>
    '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })

  return (
    <section className="grid gap-x-12 gap-y-6 md:grid-cols-12">
      <div className="md:col-span-4">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Goals &amp; Funding Ask</span>
        {(items.length > 0 || totalCents > 0) && (
          <>
            <p className="mt-2 text-3xl font-semibold tabular-nums text-foreground">{fmt(totalCents)}</p>
            <p className="text-xs text-muted-foreground">total request</p>
          </>
        )}
        {seedGoal && (
          <>
            <p className="mt-3 text-xl font-semibold tabular-nums text-foreground">{fmt(seedGoal)}</p>
            <p className="text-xs text-muted-foreground">seed funding goal</p>
          </>
        )}
      </div>
      <div className="md:col-span-8 md:col-start-5 space-y-5">
        {items.length > 0 && (
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {items.map((item, i) => (
              <div key={i} className="flex items-center justify-between gap-4 bg-card px-4 py-3 text-sm">
                <span className="text-foreground">{item.label}</span>
                <div className="flex items-center gap-4 shrink-0 text-muted-foreground">
                  <span className="tabular-nums">{item.qty} × {fmt(item.unit_cost_cents)}</span>
                  <span className="font-medium text-foreground tabular-nums w-20 text-right">{fmt(item.total_cents)}</span>
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between bg-accent/40 px-4 py-3 text-sm font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{fmt(totalCents)}</span>
            </div>
          </div>
        )}
        {sustainabilityPlan && (
          <div>
            <p className="mb-1 text-[11px] font-mono uppercase tracking-widest text-muted-foreground">Sustainability plan</p>
            <p className="text-sm leading-relaxed text-foreground/80">{sustainabilityPlan}</p>
          </div>
        )}
      </div>
    </section>
  )
}
