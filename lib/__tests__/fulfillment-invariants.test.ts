import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

describe('Payment Reference Invariants', () => {
  it('does not leak payment_reference to audit_log or notifications', () => {
    const fileContent = fs.readFileSync(path.join(process.cwd(), 'app/actions/fulfillment.ts'), 'utf-8')
    
    const auditLogMatches = fileContent.match(/metadata:\s*\{[^}]*\}/g) || []
    for (const match of auditLogMatches) {
      expect(match).not.toContain('paymentReference')
      expect(match).not.toContain('payment_reference')
    }
    
    const notifyMatches = fileContent.match(/createInAppNotification\([^)]*\)/g) || []
    for (const match of notifyMatches) {
      expect(match).not.toContain('paymentReference')
      expect(match).not.toContain('payment_reference')
    }
  })
})
