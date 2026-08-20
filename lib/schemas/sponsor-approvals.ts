import { z } from '@/lib/zod-config'
import { LIMITS } from '@/lib/schemas/limits'

export const confirmProposalSchema = z.object({
  proposalId: z.string().uuid(),
  note: z.string().trim().max(LIMITS.proposalNote).optional(),
})

export const rejectProposalSchema = z.object({
  proposalId: z.string().uuid(),
  note: z.string().trim().min(1, 'A reason is required.').max(LIMITS.proposalNote),
})

export const withdrawProposalSchema = z.object({
  proposalId: z.string().uuid(),
})

export const orgApprovalSettingsSchema = z.object({
  approvalRequiredAboveCents: z.number().int().min(0).nullable(),
})

export type ConfirmProposalInput = z.infer<typeof confirmProposalSchema>
export type RejectProposalInput = z.infer<typeof rejectProposalSchema>
export type WithdrawProposalInput = z.infer<typeof withdrawProposalSchema>
export type OrgApprovalSettingsInput = z.infer<typeof orgApprovalSettingsSchema>
