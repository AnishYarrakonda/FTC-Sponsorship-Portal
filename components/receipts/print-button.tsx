'use client'

import { Button } from '@/components/ui/button'
import { Printer } from 'lucide-react'

export function PrintButton() {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => window.print()}
      className="print:hidden flex items-center gap-2"
    >
      <Printer className="h-4 w-4" />
      Print / Save as PDF
    </Button>
  )
}
