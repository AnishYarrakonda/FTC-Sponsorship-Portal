import { z } from 'zod'
import type { Database } from '@/lib/supabase/types'

export type AdminLevel = Database['public']['Enums']['admin_level']

export const ADMIN_LEVELS = ['reviewer', 'super_admin'] as const

export const ADMIN_LEVEL_LABELS: Record<AdminLevel, string> = {
  reviewer: 'Reviewer',
  super_admin: 'Super admin',
}

export const ADMIN_LEVEL_DESCRIPTIONS: Record<AdminLevel, string> = {
  reviewer: 'Moderation queue and coach verification only.',
  super_admin:
    'Everything a reviewer can do, plus funding caps, sponsor applications, data exports, and admin provisioning.',
}

const adminLevelField = z.enum(ADMIN_LEVELS)

export const setAdminLevelSchema = z.object({
  profileId: z.string().uuid(),
  level: adminLevelField,
}).strict()

// Promotion is by email rather than profile id: the person being made an admin is
// usually named in a Slack message, not looked up in a table. profiles.email is
// Clerk-lowercased, so the action lowercases the input before matching.
export const provisionAdminSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  level: adminLevelField,
}).strict()

export const demoteAdminSchema = z.object({
  profileId: z.string().uuid(),
  newRole: z.enum(['coach', 'sponsor']),
}).strict()

export type SetAdminLevelInput = z.input<typeof setAdminLevelSchema>
export type ProvisionAdminInput = z.input<typeof provisionAdminSchema>
export type DemoteAdminInput = z.input<typeof demoteAdminSchema>
