import { z } from '@/lib/zod-config'

export const sponsorSignupSchema = z.object({
  // Step 1: Account
  fullName: z.string().trim().min(2, 'Full name must be at least 2 characters').max(200),
  email: z.string().trim().toLowerCase().email('Invalid email address'),
  password: z
    .string()
    .min(12, 'Password must be at least 12 characters')
    .regex(/[A-Z]/, 'Password must include at least one uppercase letter')
    .regex(/[a-z]/, 'Password must include at least one lowercase letter')
    .regex(/[0-9]/, 'Password must include at least one number'),
  confirmPassword: z.string().min(1, 'Please confirm your password'),

  // Step 2: Company Identity
  companyName: z.string().trim().min(2, 'Company name is required').max(200),
  industry: z.string().trim().min(2, 'Industry is required').max(100),
  website: z.string().trim().min(1, 'Website is required').regex(/\./, 'Invalid website format (e.g. company.com)').max(255),
  phoneNumber: z.string().trim().min(10, 'Work phone number is required'),
  companyAddress: z.string().trim().min(5, 'Company address is required'),

  // Step 3: Sponsorship Goals
  proposedCapCents: z.number().int().min(10000, 'Minimum proposed cap is $100.00'),
  sponsorshipReason: z.string().trim().min(1, 'Please share your motivation for supporting FTC teams').max(2000),
  fundingFrequency: z.enum(['One-time', 'Quarterly', 'Annual']),

  // Step 4: Industry Focus & Impact
  industryFocus: z.array(z.string()).min(1, 'Select at least one area of focus'),
  geographicFocus: z.string().trim().min(2, 'Geographic focus is required (e.g. National, Texas, Austin)').max(200),
  mentorshipOffered: z.boolean().default(false),

  // Step 5: Compliance & Review
  coppaAcknowledged: z.boolean().refine(val => val === true, 'This acknowledgement is required'),
  tosAccepted: z.boolean().refine(val => val === true, 'You must accept the terms'),
  ageConfirmed: z.boolean().refine(val => val === true, 'You must be at least 18 years old'),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
})

export type SponsorSignupInput = z.infer<typeof sponsorSignupSchema>
