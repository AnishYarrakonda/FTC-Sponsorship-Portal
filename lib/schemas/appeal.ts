import { z } from '@/lib/zod-config'
import { plainTextField } from './submission'
import { LIMITS } from './limits'

/** The three appealable subjects. All three are live: 'team_verification' subjects are
 *  team_verification_records rows with outcome='rejected' (0081), and resolveAppeal applies
 *  an overturn by delegating to overrideTeamVerification — see app/actions/appeals.ts. */
export const APPEAL_SUBJECT_TYPES = ['submission', 'coach_verification', 'team_verification'] as const
export type AppealSubjectType = (typeof APPEAL_SUBJECT_TYPES)[number]

/** One label per subject, so a new subject type cannot be silently mislabelled by a
 *  two-way ternary in four different files — which is what shipped when
 *  'team_verification' was inert. */
export const APPEAL_SUBJECT_LABELS: Record<AppealSubjectType, string> = {
  submission: 'Declined pitch',
  coach_verification: 'Coach verification',
  team_verification: 'FTC team number verification',
}

/**
 * Why an FTC number check was rejected, in the coach's words rather than the checker's.
 * team_verification_records stores scores, not prose — but an appeal form that shows the
 * coach nothing to answer produces statements that answer nothing.
 *
 * Here rather than in app/actions/appeals.ts because a `'use server'` module may only
 * export async server actions, and the admin queue renders this string too.
 */
export function verificationRejectionReason(record: {
  ftc_team_number: number
  claimed_team_name?: string | null
  official_team_name?: string | null
}): string {
  if (record.official_team_name) {
    return `The official FIRST record for Team #${record.ftc_team_number} is “${record.official_team_name}”, which did not match the name you entered${record.claimed_team_name ? ` (“${record.claimed_team_name}”)` : ''}.`
  }
  return `No official FIRST record could be matched to Team #${record.ftc_team_number}.`
}

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
