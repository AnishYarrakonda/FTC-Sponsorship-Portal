import { Card } from '@/components/ui/card'

export default function PayoutLoading() {
  return (
    <div className="max-w-4xl mx-auto py-10 px-4 animate-pulse">
      <Card className="w-full max-w-2xl mx-auto h-[600px] bg-muted border-border" />
    </div>
  )
}
