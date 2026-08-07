import { z } from '@/lib/zod-config'

const locationRegex = /^[A-Za-z][A-Za-z .'-]{1,79}$/

/**
 * Team data collected during coach signup. Deliberately lean — the full
 * portfolio (story, credibility, impact, media, budget) is built after
 * verification inside the coach dashboard. Legacy robot-detail fields
 * (drivetrain, build system, programming, CAD, sensors, …) are NOT collected
 * here and must never be reintroduced (those columns are being dropped).
 */
export const signupTeamSchema = z
  .object({
    status: z.enum(['existing', 'incubator']),
    ftcTeamNumber: z
      .number()
      .int()
      .min(1, 'Team number must be positive')
      .max(999999, 'Invalid FTC team number')
      .optional(),
    teamName: z
      .string()
      .trim()
      .min(2, 'Team name must be at least 2 characters')
      .max(120, 'Team name must be 120 characters or fewer'),
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
    missionStatement: z
      .string()
      .trim()
      .min(50, 'Mission statement must be at least 50 characters')
      .max(1500, 'Mission statement must be 1500 characters or fewer'),
    taxStatus: z.enum(['501c3', 'School', 'None']),
    // Incubator (new team) fields
    communityInterestText: z.string().trim().max(2000, 'Must be 2000 characters or fewer').optional(),
    sustainabilityPlan: z.string().trim().max(2000, 'Must be 2000 characters or fewer').optional(),
    seedFundingGoalsCents: z.number().int().nonnegative().optional(),
  })
  .superRefine((data, ctx) => {
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
          message: 'Please describe the community interest in a new team',
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
      if (data.seedFundingGoalsCents === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Seed funding goal is required for incubator teams',
          path: ['seedFundingGoalsCents'],
        })
      }
    }
  })

export type SignupTeamInput = z.infer<typeof signupTeamSchema>

/**
 * Everything a coach profile needs EXCEPT account credentials. Shared between
 * the signup wizard (which adds password fields) and the orphan-recovery
 * /complete-profile flow (where the Clerk account already exists).
 */
export const coachProfileDataSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name must be at least 2 characters').max(200),
  email: z.string().trim().toLowerCase().email('Invalid email address'),

  // Coach identity
  dateOfBirth: z
    .string()
    .min(1, 'Date of birth is required')
    .refine((val) => !isNaN(Date.parse(val)), { message: 'Invalid date format' })
    .refine(
      (val) => {
        const birthDate = new Date(val)
        const today = new Date()
        let age = today.getFullYear() - birthDate.getFullYear()
        const m = today.getMonth() - birthDate.getMonth()
        if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
          age--
        }
        return age >= 18
      },
      { message: 'You must be at least 18 years old to register as a coach.' }
    ),
  phoneNumber: z.string().trim().min(10, 'Phone number is required (at least 10 digits)'),
  addressLine1: z.string().trim().min(5, 'Address is required'),
  city: z.string().trim().min(2, 'City is required'),
  state: z.string().trim().min(2, 'State is required'),
  zipCode: z.string().trim().min(5, 'Zip/Postal code is required'),

  // Verification & compliance
  photoIdFile: z.any().optional(), // client-side only; sent as a FormData part
  photoIdUrl: z.string().url().optional(),
  ageConfirmed: z.literal(true, { message: 'You must confirm you are 18 or older to register.' }),
  coppaAcknowledged: z.literal(true, { message: 'You must acknowledge your COPPA responsibilities.' }),
  tosAccepted: z.literal(true, { message: 'You must accept the Terms of Service and Privacy Policy.' }),
  referralSource: z.string().trim().optional(),

  // Team basics
  teamData: signupTeamSchema,
})

export type CoachProfileDataInput = z.infer<typeof coachProfileDataSchema>

export const signupSchema = coachProfileDataSchema
  .extend({
    password: z
      .string()
      .min(12, 'Password must be at least 12 characters')
      .regex(/[A-Z]/, 'Password must include at least one uppercase letter')
      .regex(/[a-z]/, 'Password must include at least one lowercase letter')
      .regex(/[0-9]/, 'Password must include at least one number'),
    confirmPassword: z.string().min(12, 'Password confirmation must be at least 12 characters'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  })

export type SignupInput = z.infer<typeof signupSchema>

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
})

export type LoginInput = z.infer<typeof loginSchema>
