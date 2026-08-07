import { z } from '@/lib/zod-config'

export const achievementSchema = z.object({
  season: z.string().min(4, 'Season is required (e.g. 2023-24)'),
  eventName: z.string().min(2, 'Event name is required'),
  award: z.string().optional(),
  description: z.string().optional(),
})

export type AchievementInput = z.infer<typeof achievementSchema>
