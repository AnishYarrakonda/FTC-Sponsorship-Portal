'use server'

import { requireAuth } from '@/lib/actions-utils'
import { createAdminClient } from '@/lib/supabase/admin'
import { validateCredentialFile } from '@/app/actions/auth'
import { sendCredentialUploadAlert } from '@/lib/notify'
import { mapDbError } from '@/lib/errors'
import { enqueueStorageDeletion, CREDENTIALS_BUCKET } from '@/lib/credentials-retention'

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
      // ...and supersedes the retention marker from the previous review, which now
      // describes a document that is two uploads out of date.
      coach_credentials_purged_at: null,
    })
    .eq('id', user.id)

  if (updateError) {
    return { error: mapDbError(updateError, 'uploadCredentials.profileUpdate') }
  }

  // A-06-02. This used to be a bare remove() whose failure was a console.error. The
  // pointer had already moved, so a failed delete left a government ID in storage that
  // nothing referenced — invisible to sweepUnpurgedCredentials(), which only walks live
  // pointers, and therefore retained indefinitely with no alarm. Now the path is
  // recorded before it stops being reachable and retried by the nightly sweep.
  // Still never blocks the upload.
  if (previousPath && previousPath !== filePath) {
    await enqueueStorageDeletion(adminClient, CREDENTIALS_BUCKET, previousPath, 'superseded_credentials')
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
