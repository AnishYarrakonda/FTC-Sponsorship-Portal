import { z } from '@/lib/zod-config'
import { htmlToPlainText } from '@/lib/utils'

// Pitch fields are plain text. Any HTML a coach pastes (or legacy TipTap markup) is flattened
// to readable text on input, so nothing is stored or displayed as raw `<p>…</p>` markup.
export function plainTextField(min: number, max: number, minMsg: string, maxMsg: string) {
  return z
    .string()
    .trim()
    .transform((val) => htmlToPlainText(val))
    .superRefine((val, ctx) => {
      const text = val.trim()
      if (text.length < min) {
        ctx.addIssue({
          code: z.ZodIssueCode.too_small,
          minimum: min,
          type: 'string',
          inclusive: true,
          message: minMsg,
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

export const submissionSchema = z.object({
  sponsorId: z.string().uuid('Sponsor is required'),
  customPitchAlignment: plainTextField(
    50,
    1500,
    'Please explain why your team aligns with this company (at least 50 characters).',
    'Pitch alignment must be 1500 characters or fewer'
  ),
  specificNeedsStatement: plainTextField(
    50,
    1500,
    'Please detail your specific financial or material needs (at least 50 characters).',
    'Specific needs must be 1500 characters or fewer'
  ),
  localConnectionNotes: z.string().max(1000, 'Must be 1000 characters or fewer').optional(),
})

export type SubmissionInput = z.infer<typeof submissionSchema>
