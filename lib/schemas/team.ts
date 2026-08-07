import { z } from '@/lib/zod-config'
import DOMPurify from 'isomorphic-dompurify'
import { LIMITS } from './limits'

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

/**
 * The raw object shape, WITHOUT the cross-field superRefine below.
 *
 * Exported because `updateTeam` needs `.partial()` for its section-by-section patches,
 * and in Zod 4 `.partial()` THROWS on a schema carrying refinements:
 *   "TypeError: .partial() cannot be used on object schemas containing refinements"
 * Calling it on `teamOnboardingSchema` would have crashed every portfolio save. Caught by
 * lib/__tests__/remediation-invariants.test.ts.
 *
 * Dropping the refinements is correct for the patch path rather than merely convenient:
 * they are whole-object rules (status↔ftcTeamNumber, budget items summing to
 * financialAskCents) that cannot be evaluated against a patch that contains one side and
 * not the other — and `updateTeam` recomputes `financial_ask_cents` from `budgetItems`
 * itself, so that invariant holds by construction on that path.
 */
export const teamOnboardingBaseSchema = z.object({
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

  // Robot & Engineering (slim, optional): a single narrative summary + code link.
  technicalSummary: richTextField(null, LIMITS.technical, null, 'Must be 2000 characters or fewer').optional(),
  outreachSummary: richTextField(null, LIMITS.outreach, null, 'Must be 2000 characters or fewer').optional(),
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
  githubLink: z.preprocess((value) => emptyToUndefined(value),
    z.string().url().refine((u) => {
      try {
        const h = new URL(u).hostname.toLowerCase()
        return h === 'github.com' || h === 'gist.github.com'
      } catch { return false }
    }, { message: 'GitHub link must be on github.com or gist.github.com' }).optional()
  ),
  subteamBreakdown: z.string().trim().max(LIMITS.subteamBreakdown).optional(),
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
  coachExperience: z.string().trim().max(LIMITS.coachExperience, 'Must be 1000 characters or fewer').optional(),
  // Credibility
  pastSponsors: z.array(z.string().trim().min(1).max(LIMITS.pastSponsorName, 'Sponsor name is too long')).max(25).default([]),
  pressLinks: z.array(
    z.object({
      label: z.string().trim().min(1, 'Label required').max(LIMITS.pressLinkLabel, 'Label is too long'),
      // z.url() alone accepts `javascript:alert(1)` — it parses as a valid URL. These
      // links are rendered on the sponsor-facing pitch page, so restrict the scheme.
      url: z
        .string()
        .trim()
        .url('Press links must be valid URLs')
        .refine((u) => /^https?:\/\//i.test(u), 'Press links must start with http:// or https://'),
    })
  ).max(15, 'Please limit press links to 15').default([]),
  communityEndorsements: richTextField(null, LIMITS.communityEndorsements, null, 'Must be 2000 characters or fewer').optional(),
  // Community & Ethics Impact
  studentsReached: z.number().int().nonnegative().optional(),
  eventsHosted: z.number().int().nonnegative().optional(),
  volunteerHours: z.number().int().nonnegative().optional(),
})

export const teamOnboardingSchema = teamOnboardingBaseSchema.superRefine((data, ctx) => {
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
