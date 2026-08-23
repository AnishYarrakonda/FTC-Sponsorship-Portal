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
  /**
   * B-03-09. This was `z.string().max(1000).optional()` — the ONLY free-text pitch field
   * that did not go through plainTextField, so raw HTML (including `<script>`) was stored
   * byte-for-byte while the two fields beside it had their tags flattened. It was also
   * already selected into the sponsor's payload (lib/sponsor-visibility.ts) and typed on
   * the sponsor dashboard, so it was one render away from being live stored XSS.
   *
   * The field is kept and now actually shown — see the admin review queue and the sponsor
   * pitch view. A local connection ("we are two miles from your plant", "three of your
   * employees mentor us") is exactly the kind of fact a sponsor decides on, and the admin
   * gatekeeping sponsor-facing outreach has to be able to read every coach-authored word
   * that reaches the sponsor. Collected + unsanitized + unread was the worst of the three
   * available options.
   *
   * min 0 because it is optional: a coach with no local tie leaves it blank.
   */
  localConnectionNotes: plainTextField(
    0,
    1000,
    '',
    'Local connection notes must be 1000 characters or fewer'
  ).optional(),
})

export type SubmissionInput = z.infer<typeof submissionSchema>

/**
 * B-03-10. Draft autosave used to accept `Partial<SubmissionInput>` and never parse it —
 * no length cap, no htmlToPlainText, no schema — writing straight into `submissions`.
 * `.claude/rules/conventions.md` makes validation step 1 of every mutating action.
 *
 * A partial variant is the right shape rather than reusing `submissionSchema`: a
 * half-written draft cannot satisfy the 50-character minimums, and demanding them would
 * make autosave fail silently on every keystroke until the coach crossed the threshold.
 * What it DOES get is the transforms and the maximums, which is the part that matters.
 *
 * Scope note, since this was flagged as possibly-a-P0: the autosave payload is built
 * key-by-key in the action and cannot reach `status`, `sponsor_id`'s trust boundary, or
 * any amount column — `requested_amount_cents` is read from the team, not the request. So
 * this is a sanitisation and integrity gap, not a privilege-escalation one.
 */
export const submissionDraftSchema = z.object({
  sponsorId: z.string().uuid('Sponsor is required'),
  customPitchAlignment: plainTextField(0, 1500, '', 'Pitch alignment must be 1500 characters or fewer').optional(),
  specificNeedsStatement: plainTextField(0, 1500, '', 'Specific needs must be 1500 characters or fewer').optional(),
  localConnectionNotes: plainTextField(0, 1000, '', 'Local connection notes must be 1000 characters or fewer').optional(),
})
