/**
 * The single source of truth for "where is this team's W-9 up to".
 *
 * B-03-13. Three surfaces derived W-9 readiness from three different columns:
 *
 *   components/coach/funding-tab.tsx      keyed on `w9_uploaded_at`
 *   app/(coach)/team/payout/w9/page.tsx   keyed on `w9_verified_at`
 *   components/coach/portfolio-tab.tsx    keyed on `w9_document_path`
 *
 * They agree in the happy path and diverge the moment the retention job runs.
 * `purgeW9Document` (lib/credentials-retention.ts) deliberately nulls
 * `w9_document_path` and stamps `w9_purged_at` while leaving `w9_verified_at` and
 * `w9_uploaded_at` in place — the verification is a fact that happened, the document is
 * what we promised not to keep. That is correct retention behaviour, but it left one team
 * reading as "verified" on one page, "missing" on another, and the upload control was
 * removed on the page the coach was being sent to. A closed loop: told to do something,
 * told it was unnecessary, and denied the means to do it.
 *
 * The distinction the old code could not express is the one that matters:
 *
 *   VERIFIED           — verified AND the document is still on file. Nothing to do.
 *   VERIFIED_PURGED    — verified, but the document was destroyed under our retention
 *                        policy. Not an error and not the coach's fault, but a sponsor's
 *                        AP department asking for the W-9 cannot be served, so the upload
 *                        control MUST stay mounted.
 *
 * Every surface reads this function. Adding a fourth surface means calling it, not
 * inventing a fourth predicate.
 */

export type W9Status =
  | 'not_started' // no payout profile, or no legal payee name yet
  | 'awaiting_upload' // profile exists, no W-9 ever uploaded
  | 'rejected' // an admin rejected the uploaded W-9
  | 'in_review' // uploaded, awaiting admin verification
  | 'verified' // verified and on file
  | 'verified_purged' // verified, but the document has been purged by retention

export interface W9StatusInput {
  legal_payee_name?: string | null
  w9_document_path?: string | null
  w9_uploaded_at?: string | null
  w9_verified_at?: string | null
  w9_rejected_at?: string | null
  w9_purged_at?: string | null
}

export function resolveW9Status(profile: W9StatusInput | null | undefined): W9Status {
  if (!profile || !profile.legal_payee_name) return 'not_started'

  // Verified is checked FIRST, and then split on whether the document survives. Checking
  // the document path first is what produced "W-9 Missing" for a team that had in fact
  // been verified months earlier.
  if (profile.w9_verified_at) {
    return profile.w9_document_path ? 'verified' : 'verified_purged'
  }

  // A rejection outranks the upload that caused it.
  if (profile.w9_rejected_at) return 'rejected'
  if (profile.w9_document_path || profile.w9_uploaded_at) return 'in_review'
  return 'awaiting_upload'
}

/** True when the coach still has something to do about their W-9. */
export function w9NeedsCoachAction(status: W9Status): boolean {
  return status === 'not_started' || status === 'awaiting_upload' || status === 'rejected' || status === 'verified_purged'
}

/**
 * True when the upload control must be rendered. Note `verified_purged` is included —
 * that is the whole point of the state existing.
 */
export function w9AcceptsUpload(status: W9Status): boolean {
  return status !== 'verified'
}

export const W9_STATUS_COPY: Record<W9Status, { title: string; body: string; cta: string | null }> = {
  not_started: {
    title: 'Payout Readiness Required',
    body: 'Sponsors cannot pay you yet. Add your legal payee name, address and W-9.',
    cta: 'Set Up Payout Profile',
  },
  awaiting_upload: {
    title: 'W-9 Missing',
    body: 'Your payee details are saved, but no W-9 is on file. Corporate AP departments will not release funds without a W-9.',
    cta: 'Upload W-9',
  },
  rejected: {
    title: 'W-9 Needs Attention',
    body: 'Your W-9 needs attention. Please re-upload a valid form.',
    cta: 'Re-upload W-9',
  },
  in_review: {
    title: 'W-9 In Review',
    body: 'Your W-9 is in review. Sponsors can see your payee name but not yet that a W-9 is on file.',
    cta: null,
  },
  verified: {
    title: 'Payout details verified',
    body: 'Your W-9 has been verified and is on file. You do not need to re-upload it.',
    cta: null,
  },
  verified_purged: {
    title: 'W-9 verified — please re-upload',
    body:
      'Your W-9 was verified, but we deleted the document itself under our retention policy. ' +
      'Nothing is wrong with your account, and no payment is blocked. Upload a current Form W-9 ' +
      'so we can send it on if a sponsor’s finance team asks for it.',
    cta: 'Upload W-9',
  },
}
