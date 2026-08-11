import { z } from 'zod'
import { LIMITS } from './limits'
import { FULFILLMENT_STATUSES } from '../fulfillment-status'

const paymentMethodSchema = z.enum(['check', 'ach', 'wire', 'other'])

export const markPaymentSentSchema = z.object({
  fulfillmentId: z.string().uuid(),
  paymentMethod: paymentMethodSchema,
  paymentReference: z.string().max(LIMITS.paymentReference).optional(),
  sentOn: z.string().optional(),
  note: z.string().max(LIMITS.fulfillmentNote).optional(),
})

export const confirmPaymentReceivedSchema = z.object({
  fulfillmentId: z.string().uuid(),
  receivedOn: z.string().optional(),
  note: z.string().max(LIMITS.fulfillmentNote).optional(),
})

export const adminOverrideFulfillmentStatusSchema = z.object({
  fulfillmentId: z.string().uuid(),
  toStatus: z.enum(['pledged', 'agreement_signed', 'payment_sent', 'payment_received', 'cancelled']),
  reason: z.string().min(10).max(LIMITS.fulfillmentNote),
  paymentMethod: paymentMethodSchema.optional(),
  occurredOn: z.string().optional(),
})
