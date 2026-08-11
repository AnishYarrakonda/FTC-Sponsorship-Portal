import { describe, expect, it } from 'vitest'
import {
  LEGAL_TRANSITIONS,
  canTransition,
  isOpenFulfillment
} from '../fulfillment-status'

describe('Fulfillment Status State Machine', () => {
  it('defines the correct legal transitions', () => {
    expect(LEGAL_TRANSITIONS).toEqual({
      pledged: ['agreement_signed', 'payment_sent', 'cancelled'],
      agreement_signed: ['payment_sent', 'cancelled'],
      payment_sent: ['payment_received', 'pledged', 'cancelled'],
      payment_received: ['receipted', 'payment_sent'],
      receipted: [],
      cancelled: [],
    })
  })

  it('enforces role-based transition rules', () => {
    // payment_sent -> payment_received
    expect(canTransition('payment_sent', 'payment_received', 'sponsor')).toBe(false)
    expect(canTransition('payment_sent', 'payment_received', 'coach')).toBe(true)
    expect(canTransition('payment_sent', 'payment_received', 'admin')).toBe(true)

    // pledged -> payment_sent
    expect(canTransition('pledged', 'payment_sent', 'coach')).toBe(false)
    expect(canTransition('pledged', 'payment_sent', 'sponsor')).toBe(true)
    expect(canTransition('pledged', 'payment_sent', 'admin')).toBe(true)
    
    // No skipping states
    expect(canTransition('pledged', 'payment_received', 'sponsor')).toBe(false)
    expect(canTransition('pledged', 'payment_received', 'coach')).toBe(false)
    expect(canTransition('pledged', 'payment_received', 'admin')).toBe(false)
  })

  it('correctly identifies open fulfillments', () => {
    expect(isOpenFulfillment('pledged')).toBe(true)
    expect(isOpenFulfillment('agreement_signed')).toBe(true)
    expect(isOpenFulfillment('payment_sent')).toBe(true)
    expect(isOpenFulfillment('payment_received')).toBe(false)
    expect(isOpenFulfillment('receipted')).toBe(false)
    expect(isOpenFulfillment('cancelled')).toBe(false)
    expect(isOpenFulfillment(null)).toBe(false)
    expect(isOpenFulfillment(undefined)).toBe(false)
    expect(isOpenFulfillment('something_else')).toBe(false)
  })
})
