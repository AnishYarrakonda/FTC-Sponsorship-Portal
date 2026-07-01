import { z } from 'zod'
import DOMPurify from 'isomorphic-dompurify'

// Legacy exports kept for any import sites; values no longer enforce DB enums
export const DRIVETRAIN_OPTIONS = ['mecanum', 'swerve', 'tank', 'other'] as const
export const BUILD_SYSTEM_OPTIONS = ['gobilda', 'rev', 'custom', 'other'] as const
export const PROGRAMMING_OPTIONS = ['java', 'blocks', 'other'] as const

const locationRegex = /^[A-Za-z][A-Za-z .'-]{1,79}$/
const emptyToUndefined = (value: unknown) => {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function richTextField(min: number | null, max: number, minMsg: string | null, maxMsg: string) {
  return z
    .string()
    .trim()
    .transform((val) => DOMPurify.sanitize(val))
    .superRefine((val, ctx) => {
      const text = val.replace(/<[^>]*>?/gm, '').trim()
      if (min !== null && text.length < min) {
        ctx.addIssue({
          code: z.ZodIssueCode.too_small,
          minimum: min,
          type: 'string',
          inclusive: true,
          message: minMsg!,
          origin: 'string',
        })
      }
      if (text.length > max) {
        ctx.addIssue({
          code: z.ZodIssueCode.too_big,
          maximum: max,
          type: 'string',
          inclusive: true,
          message: maxMsg,
          origin: 'string',
        })
      }
    })
}

export const teamOnboardingSchema = z.object({
  status: z.enum(['existing', 'incubator']),
  ftcTeamNumber: z.number().int().min(1, 'Team number must be positive').max(999999, 'Invalid FTC team number').optional(),
  teamName: z.string().trim().min(2, 'Team name must be at least 2 characters').max(120, 'Team name must be 120 characters or fewer'),
  tagline: z
    .string()
    .trim()
    .max(250, 'Tagline must be 250 characters or fewer')
    .optional(),
  organization: z.string().trim().max(200, 'Organization must be 200 characters or fewer').optional(),
  city: z
    .string()
    .trim()
    .min(2, 'City is required')
    .regex(locationRegex, 'City can only contain letters, spaces, periods, apostrophes, and hyphens'),
  state: z
    .string()
    .trim()
    .min(2, 'State is required')
    .max(40, 'State must be 40 characters or fewer')
    .regex(/^[A-Za-z][A-Za-z .'-]*$/, 'State can only contain letters, spaces, periods, apostrophes, and hyphens'),
  missionStatement: richTextField(
    50, 1500,
    'Mission statement must be at least 50 characters',
    'Mission statement must be 1500 characters or fewer'
  ),
  taxStatus: z.enum(['501c3', 'School', 'None']),
  communityInterestText: z.string().trim().max(2000, 'Must be 2000 characters or fewer').optional(),
  studentInterestCount: z.number().int().nonnegative().optional(),
  sustainabilityPlan: z.string().trim().max(2000, 'Must be 2000 characters or fewer').optional(),
  seedFundingGoalsCents: z.number().int().nonnegative().optional(),

  technicalSummary: richTextField(null, 2000, null, 'Must be 2000 characters or fewer').optional(),
  outreachSummary: richTextField(null, 2000, null, 'Must be 2000 characters or fewer').optional(),
  // Free-form text fields — DB columns changed to plain TEXT in migration 0024
  drivetrain: z.string().trim().max(120).optional(),
  buildSystem: z.string().trim().max(120).optional(),
  programming: z.string().trim().max(120).optional(),
  mediaUrls: z.array(
    z.string().trim().url('Media URLs must be valid URLs').refine((u) => {
      try {
        const h = new URL(u).hostname.toLowerCase()
        return h.includes('supabase.co') || h.includes('supabase.com')
      } catch { return false }
    }, { message: 'Media URLs must point to Supabase storage' })
  ).max(12, 'Please provide at most 12 media URLs').default([]),
  youtubeUrl: z.preprocess((value) => emptyToUndefined(value),
    z.string().url().refine((u) => {
      try {
        const h = new URL(u).hostname.toLowerCase()
        return h === 'youtu.be' || h === 'www.youtube.com' || h === 'youtube.com' || h.endsWith('.youtube.com')
      } catch { return false }
    }, { message: 'YouTube URL must be on youtube.com or youtu.be' }).optional().nullable()
  ),
  budgetItems: z.array(
    z.object({
      label: z.string().trim().min(1, 'Label required').max(120, 'Label is too long'),
      qty: z.number().int().positive('Must be positive'),
      unitCostCents: z.number().int().nonnegative('Must be non-negative'),
      totalCents: z.number().int().nonnegative(),
    })
  ).max(50, 'Please limit budget items to 50').default([]),
  financialAskCents: z.number().int().nonnegative().default(0),
  cadSoftware: z.string().trim().max(200).optional(),
  controlSystem: z.string().trim().max(200).optional(),
  // Comma-separated free-form text; converted to text[] by the action
  sensors: z.string().trim().max(400).optional(),
  githubLink: z.preprocess((value) => emptyToUndefined(value),
    z.string().url().refine((u) => {
      try {
        const h = new URL(u).hostname.toLowerCase()
        return h === 'github.com' || h === 'gist.github.com'
      } catch { return false }
    }, { message: 'GitHub link must be on github.com or gist.github.com' }).optional()
  ),
  autonomousDescription: z.string().trim().max(750).optional(),
  proudestMechanismName: z.string().trim().max(200).optional(),
  proudestMechanismProblem: z.string().trim().max(1000).optional(),
  proudestMechanismSolution: z.string().trim().max(1000).optional(),
  subteamBreakdown: z.string().trim().max(1000).optional(),
  // Comma-separated free-form text; converted to text[] by the action
  manufacturingCapabilities: z.string().trim().max(500).optional(),
  visualPitchItems: z.array(z.object({ url: z.string().trim().url(), caption: z.string().trim().max(100) })).max(20).default([]),
  achievements: z.array(
    z.object({
      season: z.string().trim().min(4, 'Season required').max(20),
      eventName: z.string().trim().min(2, 'Event name required').max(120),
      award: z.string().trim().max(200).optional(),
      description: z.string().trim().max(500).optional(),
    })
  ).max(25).default([]),
  coachPhotoUrl: z.preprocess((value) => emptyToUndefined(value), z.string().url().optional().nullable()),

  // Portfolio redesign (migration 0054) — Team Story & People
  foundedYear: z.number().int().min(1992, 'FTC started in 1992').max(2100).optional(),
  teamSize: z.number().int().nonnegative().max(200, 'Team size looks too large').optional(),
  seasonsCompeted: z.number().int().nonnegative().max(50).optional(),
  coachExperience: z.string().trim().max(1000, 'Must be 1000 characters or fewer').optional(),
  // Credibility
  pastSponsors: z.array(z.string().trim().min(1).max(120, 'Sponsor name is too long')).max(25).default([]),
  pressLinks: z.array(
    z.object({
      label: z.string().trim().min(1, 'Label required').max(120, 'Label is too long'),
      url: z.string().trim().url('Press links must be valid URLs'),
    })
  ).max(15, 'Please limit press links to 15').default([]),
  communityEndorsements: richTextField(null, 2000, null, 'Must be 2000 characters or fewer').optional(),
  // Community & Ethics Impact
  studentsReached: z.number().int().nonnegative().optional(),
  eventsHosted: z.number().int().nonnegative().optional(),
  volunteerHours: z.number().int().nonnegative().optional(),
}).superRefine((data, ctx) => {
  if (data.status === 'existing' && !data.ftcTeamNumber) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'FTC Team Number is required for existing teams',
      path: ['ftcTeamNumber'],
    })
  }
  if (data.status === 'incubator') {
    if (!data.communityInterestText || data.communityInterestText.trim().length < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Please describe the community interest',
        path: ['communityInterestText'],
      })
    }
    if (!data.sustainabilityPlan || data.sustainabilityPlan.trim().length < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Please provide a sustainability plan',
        path: ['sustainabilityPlan'],
      })
    }
    if (data.studentInterestCount === undefined || data.studentInterestCount < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Student interest count must be at least 1',
        path: ['studentInterestCount'],
      })
    }
    if (data.seedFundingGoalsCents === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Seed funding goal is required for incubator teams',
        path: ['seedFundingGoalsCents'],
      })
    }
  }

  let computedBudgetTotal = 0
  for (const [index, item] of data.budgetItems.entries()) {
    const computed = item.qty * item.unitCostCents
    computedBudgetTotal += computed
    if (computed !== item.totalCents) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Budget line item total does not match qty x unit cost',
        path: ['budgetItems', index, 'totalCents'],
      })
    }
  }

  if (computedBudgetTotal !== data.financialAskCents) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Portfolio ask must equal the sum of all budget line items',
      path: ['financialAskCents'],
    })
  }
})

export type TeamOnboardingInput = z.infer<typeof teamOnboardingSchema>
