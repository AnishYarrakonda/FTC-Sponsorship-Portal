'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/status-badge'
import { FulfillmentOverrideDialog } from './fulfillment-override-dialog'
import { ChevronDown, ChevronUp, History } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function ReconciliationTable({
  title,
  fulfillments,
  tone,
}: {
  title: string
  fulfillments: any[]
  tone: 'success' | 'warning' | 'destructive'
}) {
  if (fulfillments.length === 0) return null

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-lg flex items-center gap-2">
          {title}
          <span className="text-sm font-normal text-muted-foreground ml-2">({fulfillments.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {fulfillments.map((f) => (
            <FulfillmentRow key={f.id} f={f} tone={tone} />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function FulfillmentRow({ f, tone }: { f: any, tone: string }) {
  const [expanded, setExpanded] = useState(false)
  
  const sponsorName = f.sponsors?.company_name || 'Unknown Sponsor'
  const teamName = f.teams?.team_name || 'Unknown Team'
  const events = f.funding_fulfillment_events || []
  
  let nudgedInfo = ''
  if (f.last_nudged_at) {
    const days = Math.floor((new Date().getTime() - new Date(f.last_nudged_at).getTime()) / (1000 * 60 * 60 * 24))
    nudgedInfo = `Last nudged ${days === 0 ? 'today' : `${days}d ago`}`
  } else {
    nudgedInfo = 'Never nudged'
  }

  return (
    <div className={cn("border rounded-lg overflow-hidden", expanded ? 'bg-muted/30' : '')}>
      <div className="flex flex-col md:flex-row md:items-center justify-between p-4 gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            <span className="truncate">{sponsorName}</span>
            <span className="text-muted-foreground">→</span>
            <span className="truncate">{teamName}</span>
          </div>
          <div className="text-xs text-muted-foreground mt-1 flex items-center gap-3">
            <span>Amount: ${(f.amount_cents / 100).toLocaleString()}</span>
            <span>•</span>
            <span>{nudgedInfo}</span>
          </div>
        </div>
        
        <div className="flex items-center gap-4 shrink-0">
          <div className="text-right">
            <StatusBadge status={f.status} />
          </div>
          <FulfillmentOverrideDialog fulfillment={f} />
          <Button variant="ghost" size="icon" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </div>
      
      {expanded && (
        <div className="bg-muted/50 p-4 border-t text-sm space-y-3">
          <div className="flex items-center gap-2 font-medium text-muted-foreground mb-2">
            <History className="h-4 w-4" /> Event History
          </div>
          {events.length > 0 ? (
            <div className="space-y-2">
              {events.map((e: any) => (
                <div key={e.id} className="flex gap-4">
                  <div className="text-muted-foreground w-24 shrink-0">
                    {new Date(e.created_at).toLocaleDateString()}
                  </div>
                  <div>
                    <span className="font-medium">{e.to_status}</span>
                    {e.reason && <span className="text-muted-foreground"> ({e.reason})</span>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-muted-foreground">No events recorded.</div>
          )}
        </div>
      )}
    </div>
  )
}
