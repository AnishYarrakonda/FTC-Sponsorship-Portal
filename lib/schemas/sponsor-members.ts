import { z } from '@/lib/zod-config'

export const sponsorMemberRoleSchema = z.enum(['member', 'org_admin'])

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
