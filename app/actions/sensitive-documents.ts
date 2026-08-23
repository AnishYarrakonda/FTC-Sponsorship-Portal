'use server'

import { z } from 'zod'
import { requireAdmin } from '@/lib/actions-utils'
import { writeAudit } from '@/lib/audit'

/**
 * A-06-03. On-demand signed URLs for the two most sensitive artefacts in the system: a
 * coach's government photo ID and a team's W-9.
 *
 * Both admin queues used to mint these at page render with a TTL of 1800 seconds. A signed
 * Supabase Storage URL carries its own authorization — anyone holding the string can fetch
 * the document, with no session, from anywhere. Thirty minutes is a long time for that
 * string to sit in a browser history entry, a referrer header, a screen-share, or a
 * clipboard.
 *
 * The TTL is now 60 seconds, which is the finding's recommendation and is ample for the
 * inline <img> to load. The reason the list render can afford to be that aggressive is
 * this action: the "open full size" control re-mints instead of reusing the render-time
 * URL, so a short TTL no longer turns into a dead link for an admin who left the queue
 * open. Short-lived AND usable, rather than trading one for the other.
 *
 * Every mint is audited. These are the documents where "who looked, and when" is the
 * question that gets asked afterwards.
 */
export const SENSITIVE_DOCUMENT_URL_TTL_SECONDS = 60

const mintSchema = z.object({
  kind: z.enum(['coach_credential', 'w9']),
  subjectId: z.string().uuid(),
})

type MintResult = { url?: string; error?: string }

export async function mintSensitiveDocumentUrl(
  data: z.input<typeof mintSchema>
): Promise<MintResult> {
  // 1. VALIDATE
  const parsed = mintSchema.safeParse(data)
  if (!parsed.success) {
    return { error: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', ') }
  }

  // 2. AUTH / ROLE
  let user, adminClient
  try {
    ({ user, adminClient } = await requireAdmin())
  } catch (e: any) {
    return { error: e.message }
  }

  const { kind, subjectId } = parsed.data

  /**
   * The storage path is resolved SERVER-SIDE from the subject id. The caller never supplies
   * a path — otherwise this action would be an arbitrary-object read oracle for any admin,
   * across every bucket, which is a much bigger capability than the queue needs.
   */
  let bucket: string
  let path: string | null = null

  if (kind === 'coach_credential') {
    const { data: row } = await adminClient
      .from('profiles')
      .select('coach_credentials_url')
      .eq('id', subjectId)
      .maybeSingle()
    bucket = 'coach-credentials'
    path = row?.coach_credentials_url ?? null
  } else {
    // Keyed on team_id, matching adminVerifyW9 / adminRejectW9 — a team has at most one
    // payout profile, and team_id is the id every other payout action is addressed by.
    const { data: row } = await adminClient
      .from('team_payout_profiles')
      .select('w9_document_path')
      .eq('team_id', subjectId)
      .maybeSingle()
    bucket = 'tax-documents'
    path = row?.w9_document_path ?? null
  }

  if (!path) {
    // Covers both "no such subject" and "the document was purged by the retention job".
    return { error: 'That document is no longer on file.' }
  }

  // 3. MUTATE (mint)
  const { data: signed, error } = await adminClient.storage
    .from(bucket)
    .createSignedUrl(path, SENSITIVE_DOCUMENT_URL_TTL_SECONDS)

  if (error || !signed?.signedUrl) {
    return { error: 'Could not open that document. Please try again.' }
  }

  // 4. AUDIT — never the URL itself, only that access happened.
  await writeAudit(adminClient, {
    actor_id: user.id,
    action: 'sensitive_document_viewed',
    entity_type: kind === 'coach_credential' ? 'profiles' : 'teams',
    entity_id: subjectId,
    metadata: { kind, bucket, ttl_seconds: SENSITIVE_DOCUMENT_URL_TTL_SECONDS },
  })

  return { url: signed.signedUrl }
}
