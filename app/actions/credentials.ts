'use server'

import { requireAuth } from '@/lib/actions-utils'
import { createAdminClient } from '@/lib/supabase/admin'
import { validateCredentialFile } from '@/app/actions/auth'
import { sendCredentialUploadAlert } from '@/lib/notify'
import { mapDbError } from '@/lib/errors'

/**
 * Coach credential (photo ID) upload / re-upload. Replaces the old
 * browser-client direct upload: everything is validated server-side (size,
 * MIME allowlist, magic-byte sniffing) and written with the admin client so
 * no storage/table RLS gaps can be exploited from the browser.
 *
 * Also clears any prior denial (denial_reason / denied_at) so the coach
 * re-enters the review queue, and re-alerts the admins.
 */
export async function uploadCredentials(
  formData: FormData
): Promise<{ success?: true; error?: string }> {
  // 1. VALIDATE
  const file = formData.get('credentialFile')
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Please select a credential file to upload.' }
  }
  const validation = await validateCredentialFile(file)
  if (validation.error) return { error: validation.error }

  // 2. AUTH / ROLE
  let user, clerkUserId, adminClient
  try {
    const authed = await requireAuth()
    user = authed.user
    clerkUserId = authed.clerkUserId
    // Credentials belong to the coach flow only.
    if (user.role !== 'coach') return { error: 'Only coaches can upload credentials.' }
    if (user.coach_verified) return { error: 'Your account is already verified.' }
    adminClient = createAdminClient()
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Unauthorized' }
  }

  // 3. MUTATE — storage first, then the profile pointer.
  // Timestamped, MIME-derived path: retries and re-uploads never collide, and
  // a stale reviewer link can't point at a silently-replaced file.
  const filePath = `${clerkUserId}/credentials_${Date.now()}.${validation.ext}`

  const { error: uploadError } = await adminClient.storage
    .from('coach-credentials')
    .upload(filePath, file, { upsert: true })

  if (uploadError) {
    console.error('[uploadCredentials] storage upload failed:', uploadError)
    return { error: 'We could not store your file right now. Please try again.' }
  }

  const previousPath = user.coach_credentials_url

  const { error: updateError } = await adminClient
    .from('profiles')
    .update({
      coach_credentials_url: filePath,
      // A fresh upload supersedes any prior denial — back into the queue.
      denial_reason: null,
      denied_at: null,
    })
    .eq('id', user.id)

  if (updateError) {
    return { error: mapDbError(updateError, 'uploadCredentials.profileUpdate') }
  }

  // Best-effort cleanup of the superseded file (never block on it).
  if (previousPath && previousPath !== filePath) {
    const { error: removeError } = await adminClient.storage
      .from('coach-credentials')
      .remove([previousPath])
    if (removeError) console.error('[uploadCredentials] old file cleanup failed:', removeError)
  }

  // 4. AUDIT
  await adminClient.from('audit_log').insert({
    actor_id: user.id,
    action: 'upload_credentials',
    entity_type: 'profiles',
    entity_id: user.id,
    metadata: { file_path: filePath, replaced: previousPath ?? null },
  })

  // 5. NOTIFY — re-alert admins that credentials are ready for review.
  // (Return value intentionally ignored; failures are logged inside notify.)
  await sendCredentialUploadAlert(clerkUserId, user.full_name ?? 'Coach', user.email ?? '')

  return { success: true }
}
