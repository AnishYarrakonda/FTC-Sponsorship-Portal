import { z } from 'zod'

export const sponsorApplicationSchema = z.object({
  companyName: z.string().min(2, 'Company name is required'),
  contactName: z.string().min(2, 'Contact name is required'),
  contactEmail: z.string().email('Invalid email address'),
  proposedCapCents: z.number().min(0, 'Proposed funding cap cannot be negative'),
  message: z.string().optional(),
  /**
   * Honeypot — rendered visually hidden in the public form. Humans never fill
   * it; when a bot does, the action silently no-ops. Never validate it with an
   * error (that would tip off the bot).
   */
  website2: z.string().optional(),
})

export type SponsorApplicationInput = z.infer<typeof sponsorApplicationSchema>

export const sponsorSchema = z.object({
  companyName: z.string().min(2, 'Company name is required'),
  industry: z.string().optional(),
  website: z.string().trim().regex(/\./, 'Invalid website format (e.g. company.com)').optional().or(z.literal('')),
  contactName: z.string().min(2, 'Contact name is required'),
  contactEmail: z.string().email('Invalid email address'),
  contactTitle: z.string().optional(),
  fundingCapCents: z.number().min(0, 'Funding cap cannot be negative'),
  status: z.enum(['active', 'inactive', 'pending_review']),
  notes: z.string().optional(),
  /** Honeypot — see sponsorApplicationSchema.website2. */
  website2: z.string().optional(),
})

export type SponsorInput = z.infer<typeof sponsorSchema>
