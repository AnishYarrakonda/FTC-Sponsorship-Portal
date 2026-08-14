import { z } from '@/lib/zod-config'
import { LIMITS } from '@/lib/schemas/limits'

export const sponsorApplicationSchema = z.object({
  companyName: z.string().min(2, 'Company name is required'),
  contactName: z.string().min(2, 'Contact name is required'),
  // Normalized at the schema so every write path stores the same casing. profiles.email
  // is Clerk-lowercased, and approveSponsorApplication links the two by equality — a raw
  // "Jane@Acme.COM" matched zero rows and silently locked the sponsor out forever.
  contactEmail: z.string().trim().toLowerCase().email('Invalid email address'),
  proposedCapCents: z.number().min(0, 'Proposed funding cap cannot be negative'),
  message: z.string().optional(),
  // The `website2` honeypot that used to live here went with submitSponsorApplication:
  // that action was dead code reachable only from its own unit test, and the honeypot
  // input is rendered solely in the admin-only SponsorForm. The live public path is
  // createSponsorApplication (app/actions/auth.ts), which is protected by Vercel BotID,
  // check_throttle, and Clerk email-code verification instead.
})

export type SponsorApplicationInput = z.infer<typeof sponsorApplicationSchema>

export const sponsorSchema = z.object({
  companyName: z.string().min(2, 'Company name is required'),
  industry: z.string().optional(),
  website: z.string().trim().regex(/\./, 'Invalid website format (e.g. company.com)').optional().or(z.literal('')),
  contactName: z.string().min(2, 'Contact name is required'),
  // Normalized at the schema so every write path stores the same casing. profiles.email
  // is Clerk-lowercased, and approveSponsorApplication links the two by equality — a raw
  // "Jane@Acme.COM" matched zero rows and silently locked the sponsor out forever.
  contactEmail: z.string().trim().toLowerCase().email('Invalid email address'),
  contactTitle: z.string().optional(),
  fundingCapCents: z.number().min(0, 'Funding cap cannot be negative'),
  status: z.enum(['active', 'inactive', 'pending_review']),
  notes: z.string().optional(),
  /** Honeypot — see sponsorApplicationSchema.website2. */
  website2: z.string().optional(),
})

export type SponsorInput = z.infer<typeof sponsorSchema>

/**
 * One row of the `email_domain_rules` block/allow list (0090). Admin-only.
 *
 * `domain` is a BARE apex host — no scheme, no leading dot, no local part — because that
 * is exactly what `emailDomain()` produces and what the primary key stores.
 */
export const emailDomainRuleSchema = z.object({
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(253)
    .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, 'Enter a bare domain, e.g. acme.com'),
  rule: z.enum(['block', 'allow']),
  reason: z.string().trim().max(LIMITS.notes).optional(),
})

export type EmailDomainRuleInput = z.infer<typeof emailDomainRuleSchema>
