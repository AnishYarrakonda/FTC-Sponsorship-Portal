import { z } from '@/lib/zod-config'
import { SPONSOR_ROLES } from '@/lib/sponsor-roles'

export const sponsorMemberRoleSchema = z.enum(SPONSOR_ROLES)

export const inviteSponsorMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email address'),
  role: sponsorMemberRoleSchema,
})

export const updateSponsorMemberRoleSchema = z.object({
  memberId: z.string().uuid(),
  role: sponsorMemberRoleSchema,
})

export const removeSponsorMemberSchema = z.object({
  memberId: z.string().uuid(),
})

export type InviteSponsorMemberInput = z.infer<typeof inviteSponsorMemberSchema>
export type UpdateSponsorMemberRoleInput = z.infer<typeof updateSponsorMemberRoleSchema>
export type RemoveSponsorMemberInput = z.infer<typeof removeSponsorMemberSchema>
