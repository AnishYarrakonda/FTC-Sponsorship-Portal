import { z } from '@/lib/zod-config'
import { LIMITS } from './limits'

export const prepareAgreementForSigningSchema = z.object({
  submissionId: z.string().uuid(),
})

export const signAgreementSchema = z.object({
  submissionId: z.string().uuid(),
  // Threaded through from the prepared document so the server can re-verify "the template
  // version it prepared against is still effective" — see lib/agreements/provider.ts.
  templateId: z.string().uuid(),
  documentHash: z.string().regex(/^[0-9a-f]{64}$/, 'Invalid document hash.'),
  // LIMITS.fullName is already 200 and is the right constant here — no new limit needed.
  typedName: z.string().trim().min(2).max(LIMITS.fullName),
  // An unchecked box is a validation failure, not a runtime `if`.
  consentAccepted: z.literal(true),
})

export const getExecutedAgreementSchema = z.object({
  signatureId: z.string().uuid(),
})
