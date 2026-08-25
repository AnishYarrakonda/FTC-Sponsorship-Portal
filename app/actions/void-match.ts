'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAdmin } from '@/lib/actions-utils'
import { mapDbError } from '@/lib/errors'
import { writeAudit } from '@/lib/audit'
import { createInAppNotification } from '@/lib/notify'
import { sponsorRecipientProfiles } from '@/lib/sponsor-recipients'

/**
 * Reverse a sponsorship match.
 *
 * WHY THIS EXISTS. Before 0111, capacity committed at acceptance could be handed back by
 * cancelling the fulfillment row (0095). That row is gone, and
 * release_submission_reservation only covers PRE-decision statuses
 * (dispatched/delivered/opened) -- so without this action a match that falls through would
 * hold a sponsor's capacity permanently. The sponsor would drift toward `inactive` at cap
 * with no recourse but someone hand-editing funding_used_cents, which is precisely the
 * untracked write detect_capacity_drift() exists to catch.
 *
 * The reversal is a COMPENSATING NEGATIVE ROW in transactions_ledger, never a delete: the
 * ledger is append-only and is now the complete record of a match, so both halves of the
 * history stay readable and SUM() stays correct by construction.
 *
 * requireAdmin(), not requireSuperAdmin(): this is a correction, not a privileged
 * provisioning act, and making it hard to reach would push admins toward the dashboard
 * hand-edit this exists to prevent.
 */
const voidMatchSchema = z.object({
  submissionId: z.string().uuid(),
  // A void moves real money commitments; an unexplained one is unauditable. The RPC
  // enforces this too (`reason_required`) so a direct service-role call cannot skip it.
  reason: z.string().trim().min(10, 'Give a reason of at least 10 characters.').max(500),
})

export async function voidMatch(data: z.input<typeof voidMatchSchema>) {
  // 1. VALIDATE
  const parsed = voidMatchSchema.safeParse(data)
  if (!parsed.success) {
    return { error: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', ') }
  }
  const { submissionId, reason } = parsed.data

  // 2. AUTH / ROLE
  let user, adminClient
  try {
    const auth = await requireAdmin()
    user = auth.user
    adminClient = auth.adminClient
  } catch (e: any) {
    return { error: e.message }
  }

  // Read the parties BEFORE the RPC: it sets the submission to `withdrawn` and zeroes the
  // reservation, and the notification below needs the team name and sponsor either way.
  const { data: submission } = await adminClient
    .from('submissions')
    .select('sponsor_id, team_id, teams:team_id(team_name, owner_id)')
    .eq('id', submissionId)
    .maybeSingle()

  // 3. MUTATE — service_role-only RPC, so it must go through the admin client.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rpcResult, error } = await (adminClient as any).rpc('void_match_atomic', {
    p_submission_id: submissionId,
    p_admin_id: user.id,
    p_reason: reason,
  })
  if (error) return { error: mapDbError(error, 'voidMatch.rpc') }

  const result = rpcResult as { ok: boolean; error?: string; released_cents?: number }
  if (!result?.ok) {
    // Named codes only. A raw RPC string in the UI is the B-03-05 defect.
    const message =
      result?.error === 'not_approved'
        ? 'That pitch is not in an approved state, so there is no match to void.'
        : result?.error === 'already_voided'
          ? 'That match has already been voided.'
          : result?.error === 'reason_required'
            ? 'A reason is required.'
            : result?.error === 'forbidden' || result?.error === 'unauthorized'
              ? 'You do not have permission to void a match.'
              : 'Could not void that match. Please try again.'
    if (!['not_approved', 'already_voided', 'reason_required', 'forbidden', 'unauthorized'].includes(result?.error ?? '')) {
      console.error('[voidMatch] unmapped RPC error code', result?.error)
    }
    return { error: message }
  }

  const releasedCents = result.released_cents ?? 0

  // 4. AUDIT. void_match_atomic writes its own audit_log row inside the transaction; this
  // second row records the ACTION as taken through the admin UI, which is what an auditor
  // asking "who clicked this" will look for.
  await writeAudit(adminClient, {
    actor_id: user.id,
    action: 'void_match_admin',
    entity_type: 'submissions',
    entity_id: submissionId,
    metadata: { released_cents: releasedCents, reason },
  })

  // 5. NOTIFY both sides. A void is a decision being taken away from people who were told
  // they had one, so silence is not an option.
  const teamName =
    (submission?.teams as { team_name?: string } | null)?.team_name ?? 'your team'
  const amountDisplay = (releasedCents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  })

  const coachId = (submission?.teams as { owner_id?: string } | null)?.owner_id
  if (coachId) {
    await createInAppNotification({
      recipientId: coachId,
      type: 'general',
      title: 'A sponsorship match was voided',
      body:
        `An administrator voided the ${amountDisplay} match for ${teamName}. ` +
        `Reason: ${reason}. If you believe this is a mistake, contact support — and if the ` +
        'sponsor has already sent you money, tell us before doing anything else.',
      submissionId,
    })
  }

  if (submission?.sponsor_id) {
    const recipients = await sponsorRecipientProfiles(adminClient, submission.sponsor_id)
    for (const recipient of recipients) {
      await createInAppNotification({
        recipientId: recipient.id,
        type: 'general',
        title: 'A sponsorship match was voided',
        body:
          `An administrator voided your ${amountDisplay} match with ${teamName}. ` +
          `Reason: ${reason}. That amount has been released back to your funding capacity. ` +
          'No payment should be sent for this match.',
        submissionId,
      })
    }
  }

  revalidatePath('/admin/capacity')
  revalidatePath('/moderation')
  revalidatePath('/dashboard')
  revalidatePath('/sponsor/dashboard')

  return { success: true, releasedCents }
}
