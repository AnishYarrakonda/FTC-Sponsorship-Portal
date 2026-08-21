import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { objectLiteralsForKey, callExpressions } from './helpers/source-blocks'

describe('Payment Reference Invariants', () => {
  it('does not leak payment_reference to audit_log or notifications', () => {
    const fileContent = fs.readFileSync(path.join(process.cwd(), 'app/actions/fulfillment.ts'), 'utf-8')

    // Brace/paren balanced, so a leak that appears AFTER a nested object or argument closes
    // is still inside the extracted block. The `[^}]*` version this replaced stopped at the
    // first `}` and could not see it.
    const auditLogMatches = objectLiteralsForKey(fileContent, 'metadata')
    expect(auditLogMatches.length).toBeGreaterThan(0)
    for (const match of auditLogMatches) {
      expect(match).not.toContain('paymentReference')
      expect(match).not.toContain('payment_reference')
    }

    const notifyMatches = callExpressions(fileContent, 'createInAppNotification')
    expect(notifyMatches.length).toBeGreaterThan(0)
    for (const match of notifyMatches) {
      expect(match).not.toContain('paymentReference')
      expect(match).not.toContain('payment_reference')
    }
  })
})
