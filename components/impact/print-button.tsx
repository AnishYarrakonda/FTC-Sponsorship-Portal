'use client'

import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Browser print is the PDF path. There is deliberately no PDF library and no headless
 * browser in this project: @react-pdf/renderer is a second layout engine (every style
 * written twice), Chromium blows the serverless function size budget, and an HTML→PDF
 * vendor means every sponsor's report leaving our infrastructure — for a document we
 * restrict precisely because of what it contains.
 *
 * The tradeoff: no byte-identical archived file. The SNAPSHOT is what we archive, so the
 * document is reproducible even though the PDF is not byte-identical.
 */
export function PrintButton() {
  return (
    <Button variant="outline" data-print-hide onClick={() => window.print()}>
      <Printer className="mr-2 h-4 w-4" aria-hidden />
      Print / Save as PDF
    </Button>
  )
}
