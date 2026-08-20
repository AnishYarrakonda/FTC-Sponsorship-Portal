'use server'

import { sponsorSchema, type SponsorInput } from '@/lib/schemas/sponsor'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAdmin, requireSuperAdmin } from '@/lib/actions-utils'
import { mapDbError } from '@/lib/errors'

// Super admin (0084): creating a sponsor company sets a funding cap.
export async function adminCreateSponsor(data: SponsorInput) {
  const result = sponsorSchema.safeParse(data)
  if (!result.success) {
    return { error: 'Invalid data provided' }
  }

  let user, adminClient
  try {
    const auth = await requireSuperAdmin()
    user = auth.user
    adminClient = auth.adminClient
  } catch (e: any) {
    return { error: e.message }
  }

  const { error } = await adminClient
    .from('sponsors')
    .insert({
      company_name: result.data.companyName,
      industry: result.data.industry || null,
      website: result.data.website || null,
      contact_name: result.data.contactName,
      contact_email: result.data.contactEmail,
      contact_title: result.data.contactTitle || null,
      funding_cap_cents: result.data.fundingCapCents,
      status: result.data.status,
      notes: result.data.notes || null,
      source: 'admin_added',
    })

  if (error) {
    return { error: mapDbError(error, 'adminCreateSponsor.insert') }
  }

  await adminClient.from('audit_log').insert({
    actor_id: user.id,
    action: 'create_sponsor',
    entity_type: 'sponsors',
    metadata: result.data as any,
  })

  revalidatePath('/sponsors')
  return { success: true }
}

// Super admin (0084): this is THE funding-cap write.
export async function adminUpdateSponsor(id: string, data: SponsorInput) {
  const result = sponsorSchema.safeParse(data)
  if (!result.success) {
    return { error: 'Invalid data provided' }
  }

  let user, adminClient
  try {
    const auth = await requireSuperAdmin()
    user = auth.user
    adminClient = auth.adminClient
  } catch (e: any) {
    return { error: e.message }
  }

  const { error } = await adminClient
    .from('sponsors')
    .update({
      company_name: result.data.companyName,
      industry: result.data.industry || null,
      website: result.data.website || null,
      contact_name: result.data.contactName,
      contact_email: result.data.contactEmail,
      contact_title: result.data.contactTitle || null,
      funding_cap_cents: result.data.fundingCapCents,
      status: result.data.status,
      notes: result.data.notes || null,
    })
    .eq('id', id)

  if (error) {
    return { error: mapDbError(error, 'adminUpdateSponsor.update') }
  }

  // Write to audit log
  await adminClient.from('audit_log').insert({
    actor_id: user.id,
    action: 'update_sponsor',
    entity_type: 'sponsors',
    entity_id: id,
    metadata: data as any,
  })

  revalidatePath('/sponsors')
  return { success: true }
}

const deleteSponsorSchema = z.object({ id: z.string().uuid() })

// Super admin (0084).
export async function deleteSponsor(id: string): Promise<{ success?: true; error?: string }> {
  const parsed = deleteSponsorSchema.safeParse({ id })
  if (!parsed.success) return { error: 'Invalid sponsor id' }

  let user, adminClient
  try {
    const auth = await requireSuperAdmin()
    user = auth.user
    adminClient = auth.adminClient
  } catch (e: any) {
    return { error: e.message }
  }

  // Snapshot for audit metadata before delete.
  const { data: snapshot } = await adminClient
    .from('sponsors')
    .select('*')
    .eq('id', parsed.data.id)
    .single()

  if (!snapshot) return { error: 'Sponsor not found' }

  const { error } = await adminClient.from('sponsors').delete().eq('id', parsed.data.id)
  if (error) return { error: mapDbError(error, 'deleteSponsor.delete') }

  await adminClient.from('audit_log').insert({
    actor_id: user.id,
    action: 'delete_sponsor',
    entity_type: 'sponsors',
    entity_id: parsed.data.id,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata: { snapshot } as any,
  })

  revalidatePath('/sponsors')
  return { success: true }
}

/**
 * Search sponsors by company name, industry, or notes using the pg full-text
 * search index.  Falls back to an alphabetical listing when no query is given.
 * Uses the GIN-indexed `search_vector` column for efficient lookups.
 */
export async function searchSponsors(query?: string) {
  let adminClient
  try {
    const auth = await requireAdmin()
    adminClient = auth.adminClient
  } catch (e: any) {
    return { error: e.message as string }
  }

  const trimmed = query?.trim() ?? ''

  if (trimmed) {
    const { data, error } = await adminClient
      .from('sponsors')
      .select('*')
      .textSearch('search_vector', trimmed, { type: 'websearch', config: 'english' })

    if (error) return { error: mapDbError(error, 'searchSponsors.textSearch') }
    return { data: data ?? [] }
  }

  const { data, error } = await adminClient
    .from('sponsors')
    .select('*')
    .order('company_name', { ascending: true })

  if (error) return { error: mapDbError(error, 'searchSponsors.list') }
  return { data: data ?? [] }
}


/** Lightweight toggle — only updates status, no full schema validation required. */
// Super admin (0084): flipping a capped sponsor back to active is a capacity-governance act.
export async function adminToggleSponsorStatus(id: string, newStatus: 'active' | 'inactive') {
  let user, adminClient
  try {
    const auth = await requireSuperAdmin()
    user = auth.user
    adminClient = auth.adminClient
  } catch (e: any) {
    return { error: e.message }
  }

  const { error } = await adminClient
    .from('sponsors')
    .update({ status: newStatus })
    .eq('id', id)

  if (error) return { error: mapDbError(error, 'adminToggleSponsorStatus.update') }

  await adminClient.from('audit_log').insert({
    actor_id: user.id,
    action: 'toggle_sponsor_status',
    entity_type: 'sponsors',
    entity_id: id,
    metadata: { newStatus },
  })

  revalidatePath('/sponsors')
  return { success: true }
}

