import { z } from '@/lib/zod-config'
import { plainTextField } from './submission'
import { LIMITS } from './limits'

/** The three appealable subjects. 'team_verification' is declared but refused by the
 *  action until prompt 07's overrideTeamVerification exists — see app/actions/appeals.ts. */
export const APPEAL_SUBJECT_TYPES = ['submission', 'coach_verification', 'team_verification'] as const
export type AppealSubjectType = (typeof APPEAL_SUBJECT_TYPES)[number]

export const APPEAL_STATUSES = ['open', 'under_review', 'upheld', 'overturned', 'withdrawn'] as const
export type AppealStatus = (typeof APPEAL_STATUSES)[number]

/** How long a coach has to contest a decision, in days. Mirrored by the 30-day check in
 *  guard_appeal_transitions() (0086) — change both or neither. */
export const APPEAL_WINDOW_DAYS = 30

export function appealDeadline(decisionAt: string | Date): Date {
  const base = decisionAt instanceof Date ? decisionAt : new Date(decisionAt)
  return new Date(base.getTime() + APPEAL_WINDOW_DAYS * 86_400_000)
}

export function isAppealWindowOpen(decisionAt: string | Date, now: Date = new Date()): boolean {
  return appealDeadline(decisionAt) > now
}

export const createAppealSchema = z.object({
  subjectType: z.enum(APPEAL_SUBJECT_TYPES),
  subjectId: z.string().uuid(),
  statement: plainTextField(
    50,
    LIMITS.appealStatement,
    'Explain why you are appealing, in at least 50 characters.',
    `Appeals must be ${LIMITS.appealStatement} characters or fewer`
  ),
})

export const assignAppealSchema = z.object({
  appealId: z.string().uuid(),
  reviewerId: z.string().uuid(),
  // The soft different-reviewer rule: only supplied on the second attempt, and only a
  // super admin may supply it. 20 chars so it has to be a reason, not a shrug.
  overrideReason: z
    .string()
    .trim()
    .min(20, 'Give a reason of at least 20 characters — it is recorded in the audit log.')
    .max(LIMITS.feedback)
    .optional(),
})

export const resolveAppealSchema = z.object({
  appealId: z.string().uuid(),
  outcome: z.enum(['upheld', 'overturned']),
  resolutionNotes: plainTextField(
    20,
    LIMITS.feedback,
    'Tell the coach why, in at least 20 characters — they see this verbatim.',
    `Resolution notes must be ${LIMITS.feedback} characters or fewer`
  ),
})

export const withdrawAppealSchema = z.object({ appealId: z.string().uuid() })

export type CreateAppealInput = z.input<typeof createAppealSchema>
export type AssignAppealInput = z.input<typeof assignAppealSchema>
export type ResolveAppealInput = z.input<typeof resolveAppealSchema>
export type WithdrawAppealInput = z.input<typeof withdrawAppealSchema>

/**
 * Shared return shape for app/actions/appeals.ts. Declared here because a `'use server'`
 * module may only export async server actions, and callers need one union to narrow on.
 */
export type AppealActionResult = {
  success?: boolean
  error?: string
  /** assignAppeal: the reviewer made the original decision; a written reason is required. */
  requiresOverride?: boolean
  warning?: string
}

/** One appealable decision, as the coach-facing UI renders it. */
export type AppealableSubject = {
  subjectType: AppealSubjectType
  subjectId: string
  label: string
  decisionAt: string
  deadline: string
  windowOpen: boolean
  /** The admin's original reason, so the coach can answer it rather than guess. */
  originalReason: string | null
  existingAppeal: { id: string; status: AppealStatus } | null
}
