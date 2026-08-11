export const FULFILLMENT_STATUSES = ['pledged', 'agreement_signed', 'payment_sent', 'payment_received', 'receipted', 'cancelled'] as const
export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number]

/** Money committed but not yet in the team's account. Drives the aging report. */
export const OPEN_FULFILLMENT_STATUSES = ['pledged', 'agreement_signed', 'payment_sent'] as const
export const TERMINAL_FULFILLMENT_STATUSES = ['receipted', 'cancelled'] as const

/** The authoritative transition table. Mirrors record_fulfillment_transition in 0076. */
export const LEGAL_TRANSITIONS: Record<FulfillmentStatus, readonly FulfillmentStatus[]> = {
  pledged: ['agreement_signed', 'payment_sent', 'cancelled'],
  agreement_signed: ['payment_sent', 'cancelled'],
  payment_sent: ['payment_received', 'pledged', 'cancelled'],
  payment_received: ['receipted', 'payment_sent'],
  receipted: [],
  cancelled: [],
}

export function canTransition(from: FulfillmentStatus, to: FulfillmentStatus, role: 'sponsor' | 'coach' | 'admin' | 'system'): boolean {
  if (!LEGAL_TRANSITIONS[from].includes(to)) return false
  
  if (to === 'agreement_signed') {
    return role === 'admin' || role === 'system'
  }
  if (to === 'payment_sent') {
    if (from === 'payment_received') return role === 'admin'
    return role === 'sponsor' || role === 'admin'
  }
  if (to === 'cancelled') {
    if (from === 'payment_sent') return role === 'admin'
    return role === 'sponsor' || role === 'admin'
  }
  if (to === 'payment_received') {
    return role === 'coach' || role === 'admin'
  }
  if (to === 'pledged') {
    return role === 'admin'
  }
  if (to === 'receipted') {
    return role === 'admin' || role === 'system'
  }
  return false
}

export function isOpenFulfillment(s?: string | null): boolean {
  if (!s) return false
  return OPEN_FULFILLMENT_STATUSES.includes(s as any)
}

export function fulfillmentStatusLabel(s: FulfillmentStatus): string {
  switch (s) {
    case 'pledged': return 'Pledged'
    case 'agreement_signed': return 'Agreement signed'
    case 'payment_sent': return 'Payment sent'
    case 'payment_received': return 'Payment received'
    case 'receipted': return 'Receipted'
    case 'cancelled': return 'Cancelled'
    default: return s
  }
}
