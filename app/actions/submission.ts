'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { submissionSchema, type SubmissionInput } from '@/lib/schemas/submission'
import { redirect } from 'next/navigation'
import { requireAuth, requireVerifiedCoach } from '@/lib/actions-utils'
import { createInAppNotification } from '@/lib/notify'
import { mapDbError } from '@/lib/errors'

const DUPLICATE_SUBMISSION_MESSAGE = 'You already have an active pitch to this sponsor.'

const EDITABLE_SUBMISSION_STATUSES = ['draft', 'declined', 'changes_requested'] as const

async function getCoachTeamId() {
  let user, supabase
  try {
    const auth = await requireAuth()
    user = auth.user
    supabase = auth.supabase
  } catch {
    return { error: 'Not authenticated' as const }
  }

  const { data: team } = await supabase
    .from('teams')
    .select('id, financial_ask_cents')
    .eq('owner_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!team) return { error: 'Team not found. Complete onboarding first.' as const }
  return { supabase, user, teamId: team.id, financialAsk: team.financial_ask_cents ?? 0 }
}

export async function saveSubmission(
  data: SubmissionInput,
  status: 'draft' | 'pending' = 'draft',
  submissionId?: string
) {
  if (status === 'pending') {
    const result = submissionSchema.safeParse(data)
    if (!result.success) return { error: 'Please complete all required fields before submitting' }
    // Submitting to sponsors requires verified-coach status.
    try {
      await requireVerifiedCoach()
    } catch (e: any) {
      return { error: e.message, code: e.code }
    }
  }

  const ctx = await getCoachTeamId()
  if ('error' in ctx) return { error: ctx.error }
  const { supabase, user, teamId, financialAsk } = ctx

  // Spec: max 3 pending submissions per rolling 7-day window
  if (status === 'pending') {
    const { count } = await supabase
      .from('submissions')
      .select('id', { count: 'exact', head: true })
      .eq('team_id', teamId)
      .eq('status', 'pending')
      .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())

    if ((count ?? 0) >= 3) {
      return { error: 'rate_limited', message: 'You may submit at most 3 proposals per 7-day window. Please wait for existing submissions to be reviewed.' }
    }
  }

  if (status === 'pending') {
    const { data: sponsor } = await supabase
      .from('sponsors')
      .select('status')
      .eq('id', data.sponsorId)
      .single()

    if (!sponsor || sponsor.status !== 'active') {
      return { error: 'This sponsor is not currently accepting new submissions.' }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload: any = {
    team_id: teamId,
    sponsor_id: data.sponsorId,
    custom_pitch_alignment: data.customPitchAlignment ?? null,
    specific_needs_statement: data.specificNeedsStatement ?? null,
    local_connection_notes: data.localConnectionNotes ?? null,
    status,
    submitted_at: status === 'pending' ? new Date().toISOString() : null,
    requested_amount_cents: financialAsk
  }

  if (submissionId) {
    const { data: existing } = await supabase
      .from('submissions')
      .select('id, status, team_id')
      .eq('id', submissionId)
      .eq('team_id', teamId)
      .single()

    if (!existing) return { error: 'Submission not found' }
    if (!EDITABLE_SUBMISSION_STATUSES.includes(existing.status as typeof EDITABLE_SUBMISSION_STATUSES[number])) {
      return { error: 'This submission can no longer be edited.' }
    }

    const { error } = await supabase
      .from('submissions')
      .update(payload)
      .eq('id', submissionId)

    if (error) return { error: mapDbError(error, 'saveSubmission.update') }
  } else {
    // Fast path: friendly rejection when an active submission already exists
    // for this team/sponsor combo.
    const { data: existingTarget } = await supabase
      .from('submissions')
      .select('id, status')
      .eq('team_id', teamId)
      .eq('sponsor_id', data.sponsorId)
      .not('status', 'in', '("declined","expired","bounced")')
      .maybeSingle()

    if (existingTarget) {
      return { error: DUPLICATE_SUBMISSION_MESSAGE }
    }

    // The pre-check above races with concurrent inserts; the partial unique
    // index on active (team_id, sponsor_id) is the real guard. Map its 23505
    // to the same friendly message instead of leaking a constraint error.
    const { data: inserted, error } = await supabase
      .from('submissions')
      .insert(payload)
      .select('id')
      .single()

    if (error) {
      if (error.code === '23505') return { error: DUPLICATE_SUBMISSION_MESSAGE }
      return { error: mapDbError(error, 'saveSubmission.insert') }
    }
    submissionId = inserted.id
  }

  // Audit log for draft→pending transition (material state change)
  if (status === 'pending') {
    const admin = createAdminClient()
    await admin.from('audit_log').insert({
      actor_id: user.id,
      action: 'submit_submission',
      entity_type: 'submissions',
      entity_id: submissionId ?? null,
      metadata: { sponsor_id: data.sponsorId },
    })

    // Notify every admin (inbox + email) that a pitch is awaiting moderation.
    const { data: admins } = await admin.from('profiles').select('id').eq('role', 'admin')
    if (admins?.length) {
      await Promise.all(
        admins.map((a) =>
          createInAppNotification({
            recipientId: a.id,
            type: 'general',
            title: 'New submission awaiting review',
            body: 'A coach has submitted a pitch for review. Open the moderation queue to approve, decline, or request changes.',
            submissionId: submissionId ?? undefined,
          })
        )
      )
    }

    redirect('/dashboard')
  }
  return { success: true }
}

export async function autoSaveSubmissionDraft(
  data: Partial<SubmissionInput>,
  submissionId?: string
): Promise<{ id?: string; error?: string }> {
  const ctx = await getCoachTeamId()
  if ('error' in ctx) return { error: ctx.error }
  const { supabase, teamId, financialAsk } = ctx

  if (!data.sponsorId) {
    return { error: 'Sponsor ID is required to autosave' }
  }

  const payload = {
    team_id: teamId,
    sponsor_id: data.sponsorId,
    custom_pitch_alignment: data.customPitchAlignment ?? null,
    specific_needs_statement: data.specificNeedsStatement ?? null,
    local_connection_notes: data.localConnectionNotes ?? null,
    status: 'draft' as const,
    requested_amount_cents: financialAsk
  }

  if (submissionId) {
    const { data: existing } = await supabase
      .from('submissions')
      .select('status, team_id')
      .eq('id', submissionId)
      .eq('team_id', teamId)
      .single()

    if (!existing) return { error: 'Submission not found' }
    if (!EDITABLE_SUBMISSION_STATUSES.includes(existing.status as typeof EDITABLE_SUBMISSION_STATUSES[number])) {
      return { error: 'Cannot auto-save a non-draft submission' }
    }

    const { error } = await supabase.from('submissions').update(payload).eq('id', submissionId)
    if (error) return { error: mapDbError(error, 'autoSaveSubmissionDraft.update') }
    return { id: submissionId }
  }

  // Attempt to update by team_id and sponsor_id if no ID is passed, to avoid duplicates
  const { data: existingTarget } = await supabase
    .from('submissions')
    .select('id, status')
    .eq('team_id', teamId)
    .eq('sponsor_id', data.sponsorId)
    .not('status', 'in', '("declined","expired","bounced")')
    .maybeSingle()

  if (existingTarget) {
    // If it's not a draft, we shouldn't overwrite it with auto-save
    if (!EDITABLE_SUBMISSION_STATUSES.includes(existingTarget.status as any)) {
      return { error: 'An active submission for this sponsor is already in progress and locked.' }
    }
    const { error } = await supabase.from('submissions').update(payload).eq('id', existingTarget.id)
    if (error) return { error: mapDbError(error, 'autoSaveSubmissionDraft.updateExisting') }
    return { id: existingTarget.id }
  }

  const { data: inserted, error } = await supabase
    .from('submissions')
    .insert(payload)
    .select('id')
    .single()

  if (error) {
    // Concurrent autosave can race the pre-check; the partial unique index on
    // active (team_id, sponsor_id) reports 23505 — map it to the friendly message.
    if (error.code === '23505') return { error: DUPLICATE_SUBMISSION_MESSAGE }
    return { error: mapDbError(error, 'autoSaveSubmissionDraft.insert') }
  }
  return { id: inserted.id }
}

