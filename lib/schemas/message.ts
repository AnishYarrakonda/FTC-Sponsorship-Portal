import { z } from '@/lib/zod-config'
import { plainTextField } from './submission'
import { LIMITS } from './limits'

// PLAIN text, deliberately — richTextField (lib/schemas/team.ts:13) DOMPurify-sanitizes and
// KEEPS markup, which means it keeps <img>. A Q&A message has no need for formatting and
// every reason not to be able to carry an image of a student. This is a COPPA control, not
// a formatting preference. There is no upload path on this feature at all; do not add one.
const messageBody = plainTextField(
  5,
  LIMITS.submissionMessage,
  'Write a message before sending.',
  `Messages must be ${LIMITS.submissionMessage} characters or fewer`
)

export const postMessageSchema = z.object({
  submissionId: z.string().uuid(),
  body: messageBody,
})

export const postMessageByTokenSchema = z.object({
  token: z.string().min(1),
  body: messageBody,
})

export const releaseMessageSchema = z.object({ messageId: z.string().uuid() })

export const rejectMessageSchema = z.object({
  messageId: z.string().uuid(),
  reason: z
    .string()
    .trim()
    .min(10, 'Give the coach a reason of at least 10 characters')
    .max(LIMITS.feedback, `Reasons must be ${LIMITS.feedback} characters or fewer`),
})

export const reportMessageSchema = z.object({
  messageId: z.string().uuid(),
  reason: z
    .string()
    .trim()
    .min(10, 'Tell us what is wrong with this message, in at least 10 characters')
    .max(LIMITS.feedback, `Reports must be ${LIMITS.feedback} characters or fewer`),
})

export type PostMessageInput = z.input<typeof postMessageSchema>
export type PostMessageByTokenInput = z.input<typeof postMessageByTokenSchema>
export type ReleaseMessageInput = z.input<typeof releaseMessageSchema>
export type RejectMessageInput = z.input<typeof rejectMessageSchema>
export type ReportMessageInput = z.input<typeof reportMessageSchema>

/**
 * Shared return shape for every action in app/actions/messages.ts.
 *
 * Declared here rather than in the action module because a `'use server'` file may only
 * export async server actions, and callers need the union to narrow on `.error` without
 * TypeScript splitting it into mutually exclusive branches.
 */
export type MessageActionResult = {
  success?: boolean
  error?: string
  /** postCoachReply only: the reply is queued for admin review, not sent. */
  pending?: boolean
  /** requireVerifiedCoach's NEEDS_VERIFICATION, surfaced so the UI can show the CTA. */
  code?: string
}
