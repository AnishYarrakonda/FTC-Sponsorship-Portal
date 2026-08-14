import { z } from 'zod'
import { LIMITS } from '@/lib/schemas/limits'
import { RECOGNITION_BENEFIT_TYPES } from '@/lib/recognition'

/**
 * Zod input schemas for app/actions/recognition.ts.
 *
 * Note what is NOT here: no .refine() comparing minAmountCents to maxAmountCents against
 * any other tier. Range validity and overlap are decided by admin_upsert_recognition_tier
 * under a table lock, because two admins saving concurrently is the only case that
 * matters and a Zod refine cannot see the other row. The single-field
 * `max > min` check below is a UX nicety that the RPC re-checks as `invalid_range`.
 */

export const markBenefitSchema = z.object({
  deliveryId: z.string().uuid(),
  // The three statuses a coach may set. waived/not_applicable are not reachable here.
  status: z.enum(['promised', 'in_progress', 'delivered']),
  note: z.string().max(LIMITS.recognitionDeliveryNote).optional(),
})

export const waiveBenefitSchema = z.object({
  deliveryId: z.string().uuid(),
  note: z.string().max(LIMITS.recognitionDeliveryNote).optional(),
})

export const adminSetBenefitStatusSchema = z.object({
  deliveryId: z.string().uuid(),
  status: z.enum(['promised', 'in_progress', 'delivered', 'waived', 'not_applicable']),
  // An admin override must be explained — it overrides a decision made by one of the two
  // counterparties.
  reason: z
    .string()
    .trim()
    .min(10, 'Give a reason of at least 10 characters.')
    .max(LIMITS.recognitionDeliveryNote),
})

export const adminVoidProofSchema = z.object({
  deliveryId: z.string().uuid(),
  reason: z
    .string()
    .trim()
    .min(10, 'Give a reason of at least 10 characters.')
    .max(LIMITS.recognitionVoidReason),
})

export const upsertTierSchema = z
  .object({
    tierId: z.string().uuid().optional(),
    name: z.string().trim().min(2).max(LIMITS.recognitionTierName),
    rank: z.number().int().min(0).max(100),
    minAmountCents: z.number().int().min(0),
    maxAmountCents: z.number().int().min(1).nullable().optional(),
    benefits: z.array(z.enum(RECOGNITION_BENEFIT_TYPES)),
    description: z.string().trim().max(LIMITS.recognitionTierDescription).optional(),
  })
  .refine((v) => v.maxAmountCents == null || v.maxAmountCents > v.minAmountCents, {
    message: 'The upper bound must be greater than the lower bound.',
    path: ['maxAmountCents'],
  })

export const archiveTierSchema = z.object({ tierId: z.string().uuid() })

/**
 * Declared here rather than in the action module: a `'use server'` file may only export
 * async server actions, so a shared return type cannot live alongside them.
 */
export type RecognitionActionResult = { success?: true; error?: string; url?: string }
