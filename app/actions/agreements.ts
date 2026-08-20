'use server'

// Template CRUD is an internal admin operation with no per-user state change, so these
// actions deliberately skip step 5 (notify) of the canonical shape — house rule 8 in
// _CONTEXT.md covers *user-visible* state changes, and nobody outside the admin team is
// affected until a version is published and read through /legal/agreement.

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/actions-utils'
import { mapDbError } from '@/lib/errors'
import { validateTemplateBody } from '@/lib/agreements/render'
import {
  createAgreementDraftSchema,
  updateAgreementDraftSchema,
  publishAgreementVersionSchema,
  clearLegalReviewFlagSchema,
} from '@/lib/schemas/agreement'

export async function createAgreementDraft(data: {
  key: string
  title: string
  body: string
  consentText: string
}): Promise<{ success?: true; id?: string; error?: string; unknownFields?: string[] }> {
  // 1. VALIDATE
  const parsed = createAgreementDraftSchema.safeParse(data)
  if (!parsed.success) {
    return { error: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', ') }
  }

  const validation = validateTemplateBody(parsed.data.body)
  if (!validation.ok) {
    return {
      error: `Unknown merge field(s): ${validation.unknown.join(', ')}`,
      unknownFields: validation.unknown,
    }
  }

  // 2. AUTH / ROLE
  let user, supabase, adminClient
  try {
    ;({ user, supabase, adminClient } = await requireAdmin())
  } catch (e: any) {
    return { error: e.message }
  }

  // 3. MUTATE — the Supabase JS client has no `INSERT ... SELECT` escape hatch, so the
  // "next version" computation runs as a read-then-write rather than a single atomic
  // statement. UNIQUE(key, version) is still the race guard: a concurrent draft creation
  // for the same key collides on the version number and surfaces as 23505, not silent
  // double-drafting. The one-draft-per-key partial unique index is the primary guard —
  // this is only a fallback for the version number itself.
  const { data: maxRow } = await supabase
    .from('agreement_templates')
    .select('version')
    .eq('key', parsed.data.key)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextVersion = (maxRow?.version ?? 0) + 1

  const { data: row, error } = await supabase
    .from('agreement_templates')
    .insert({
      key: parsed.data.key,
      version: nextVersion,
      title: parsed.data.title,
      body: parsed.data.body,
      consent_text: parsed.data.consentText,
      merge_fields: validation.fields,
      status: 'draft',
      created_by: user.id,
    } as never)
    .select('id')
    .single()

  if (error?.code === '23505') {
    return { error: 'A draft already exists for this document. Edit it instead.' }
  }
  if (error) return { error: mapDbError(error, 'createAgreementDraft.insert') }

  await adminClient.from('audit_log').insert({
    actor_id: user.id,
    action: 'agreement_template_created',
    entity_type: 'agreement_templates',
    entity_id: row!.id,
    metadata: { key: parsed.data.key },
  })

  revalidatePath('/agreements')
  revalidatePath(`/agreements/${parsed.data.key}`)
  return { success: true, id: row!.id }
}

export async function updateAgreementDraft(data: {
  id: string
  title: string
  body: string
  consentText: string
}): Promise<{ success?: true; error?: string; unknownFields?: string[] }> {
  // 1. VALIDATE
  const parsed = updateAgreementDraftSchema.safeParse(data)
  if (!parsed.success) {
    return { error: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', ') }
  }

  const validation = validateTemplateBody(parsed.data.body)
  if (!validation.ok) {
    return {
      error: `Unknown merge field(s): ${validation.unknown.join(', ')}`,
      unknownFields: validation.unknown,
    }
  }

  // 2. AUTH / ROLE
  let user, supabase, adminClient
  try {
    ;({ user, supabase, adminClient } = await requireAdmin())
  } catch (e: any) {
    return { error: e.message }
  }

  // 3. MUTATE — the immutability trigger raises agreement_template_immutable if the row
  // is not a draft.
  const { data: existing, error: fetchError } = await supabase
    .from('agreement_templates')
    .select('id, key')
    .eq('id', parsed.data.id)
    .single()
  if (fetchError || !existing) return { error: 'That draft was not found.' }

  const { error } = await supabase
    .from('agreement_templates')
    .update({
      title: parsed.data.title,
      body: parsed.data.body,
      consent_text: parsed.data.consentText,
      merge_fields: validation.fields,
    } as never)
    .eq('id', parsed.data.id)

  if (error) {
    if (error.message?.includes('agreement_template_immutable')) {
      return { error: 'This version is already effective — create a new version to change it.' }
    }
    return { error: mapDbError(error, 'updateAgreementDraft.update') }
  }

  await adminClient.from('audit_log').insert({
    actor_id: user.id,
    action: 'agreement_template_updated',
    entity_type: 'agreement_templates',
    entity_id: parsed.data.id,
    metadata: { key: existing.key },
  })

  revalidatePath('/agreements')
  revalidatePath(`/agreements/${existing.key}`)
  return { success: true }
}

export async function publishAgreementVersion(data: {
  id: string
}): Promise<{ success?: true; error?: string }> {
  // 1. VALIDATE
  const parsed = publishAgreementVersionSchema.safeParse(data)
  if (!parsed.success) {
    return { error: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', ') }
  }

  // 2. AUTH / ROLE
  let user, adminClient
  try {
    ;({ user, adminClient } = await requireAdmin())
  } catch (e: any) {
    return { error: e.message }
  }

  // 3. MUTATE — via RPC, not a plain UPDATE: the one-effective-per-key partial unique
  // index means the incumbent must be retired and the successor promoted atomically.
  const { data: result, error } = await adminClient.rpc('publish_agreement_version', {
    p_template_id: parsed.data.id,
    p_actor_profile_id: user.id,
  })

  if (error) return { error: mapDbError(error, 'publishAgreementVersion.rpc') }

  const outcome = result as { ok: boolean; error?: string; key?: string } | null
  if (!outcome?.ok) {
    if (outcome?.error === 'unauthorized') return { error: 'You do not have permission to publish this document.' }
    if (outcome?.error === 'not_a_draft') return { error: 'This version is not a draft and cannot be published.' }
    return { error: 'Publishing failed. Please try again.' }
  }

  // 4. AUDIT — the RPC already writes audit_log for the publish itself.

  revalidatePath('/agreements')
  if (outcome.key) revalidatePath(`/agreements/${outcome.key}`)
  revalidatePath('/legal/agreement')
  return { success: true }
}

export async function clearLegalReviewFlag(data: {
  id: string
  reviewerNote: string
}): Promise<{ success?: true; error?: string }> {
  // 1. VALIDATE
  const parsed = clearLegalReviewFlagSchema.safeParse(data)
  if (!parsed.success) {
    return { error: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', ') }
  }

  // 2. AUTH / ROLE
  let user, supabase, adminClient
  try {
    ;({ user, supabase, adminClient } = await requireAdmin())
  } catch (e: any) {
    return { error: e.message }
  }

  const { data: existing, error: fetchError } = await supabase
    .from('agreement_templates')
    .select('id, key')
    .eq('id', parsed.data.id)
    .single()
  if (fetchError || !existing) return { error: 'That version was not found.' }

  // 3. MUTATE — needs_legal_review is not one of the frozen columns in the immutability
  // trigger, so this UPDATE is permitted even on an effective/retired row.
  const { error } = await supabase
    .from('agreement_templates')
    .update({ needs_legal_review: false } as never)
    .eq('id', parsed.data.id)

  if (error) return { error: mapDbError(error, 'clearLegalReviewFlag.update') }

  // 4. AUDIT
  await adminClient.from('audit_log').insert({
    actor_id: user.id,
    action: 'agreement_template_legal_review_cleared',
    entity_type: 'agreement_templates',
    entity_id: parsed.data.id,
    metadata: { key: existing.key, reviewer_note: parsed.data.reviewerNote },
  })

  revalidatePath('/agreements')
  revalidatePath(`/agreements/${existing.key}`)
  return { success: true }
}
