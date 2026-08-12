import { z } from '@/lib/zod-config'
import { LIMITS } from './limits'

export const AGREEMENT_TEMPLATE_KEYS = ['sponsorship_agreement', 'platform_tos', 'team_participation'] as const
export type AgreementTemplateKey = (typeof AGREEMENT_TEMPLATE_KEYS)[number]

export const AGREEMENT_TEMPLATE_LABELS: Record<AgreementTemplateKey, string> = {
  sponsorship_agreement: 'Sponsorship Agreement',
  platform_tos: 'Platform Terms of Service',
  team_participation: 'Team Participation Agreement',
}

// The template body is raw template source (merge-field tokens like {{ field }}), not
// rich text — it must not be tiptap/DOMPurify-sanitized before storage, or the tokens
// would be mangled. Plain trimmed-length validation only.
export const createAgreementDraftSchema = z.object({
  key: z.enum(AGREEMENT_TEMPLATE_KEYS),
  title: z.string().trim().min(3).max(LIMITS.agreementTitle),
  body: z.string().min(200).max(LIMITS.agreementBody),
  consentText: z.string().trim().min(50).max(LIMITS.agreementConsentText),
})

export const updateAgreementDraftSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(3).max(LIMITS.agreementTitle),
  body: z.string().min(200).max(LIMITS.agreementBody),
  consentText: z.string().trim().min(50).max(LIMITS.agreementConsentText),
})

export const publishAgreementVersionSchema = z.object({
  id: z.string().uuid(),
})

export const clearLegalReviewFlagSchema = z.object({
  id: z.string().uuid(),
  reviewerNote: z.string().trim().min(1).max(LIMITS.agreementReviewerNote),
})
