'use server'

import { sponsorSchema, type SponsorInput } from '@/lib/schemas/sponsor'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAdmin, requireSuperAdmin } from '@/lib/actions-utils'
import { mapDbError } from '@/lib/errors'

/**
 * What a sponsor write records in audit_log — the identity of the company and the
 * capacity-bearing fields, and nothing else.
 *
 * Deliberately absent: contact_name / contact_email / contact_title and `notes`. audit_log
 * is append-only with no expiry and no redaction path, so a contact's details written here
 * outlive the sponsor row itself and survive any later deletion request. The fields kept
 * are the ones an auditor actually needs to answer "who changed this company's cap, and to
 * what" — the current contact details are one join away on `sponsors`.
 */
/** The stored row, in the same shape auditFields() takes, so `from` and `to` are comparable. */
function dbRowToAuditInput(row: {
  company_name: string
  industry: string | null
  website: string | null
  funding_cap_cents: number
  status: string
}) {
  return {
    companyName: row.company_name,
    industry: row.industry,
    website: row.website,
    fundingCapCents: row.funding_cap_cents,
    status: row.status,
  }
}

function auditFields(input: {
  companyName: string
  industry?: string | null
  website?: string | null
  fundingCapCents: number
  status: string
}) {
  return {
    company_name: input.companyName,
    industry: input.industry || null,
    website: input.website || null,
    funding_cap_cents: input.fundingCapCents,
    status: input.status,
  }
}

// Super admin (0084): creating a sponsor company sets a funding cap.
export async function adminCreateSponsor(data: SponsorInput) {
  const result = sponsorSchema.safeParse(data)
  if (!result.success) {
    return { error: 'Validation failed: ' + result.error.issues.map((i) => i.message).join(', ') }
  }

  let user, adminClient
  try {
    const auth = await requireSuperAdmin()
    user = auth.user
    adminClient = auth.adminClient
  } catch (e: any) {
    return { error: e.message }
  }

  const { data: created, error } = await adminClient
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
    .select('id')
    .single()

  if (error) {
    return { error: mapDbError(error, 'adminCreateSponsor.insert') }
  }

  // entity_id, not just metadata: without it the create and every later cap change on the
  // same company cannot be joined in the audit log — which is the one question this trail
  // exists to answer.
  await adminClient.from('audit_log').insert({
    actor_id: user.id,
    action: 'create_sponsor',
    entity_type: 'sponsors',
    entity_id: created.id,
    metadata: auditFields(result.data),
  })

  revalidatePath('/sponsors')
  return { success: true }
}

// Super admin (0084): this is THE funding-cap write.
export async function adminUpdateSponsor(id: string, data: SponsorInput) {
  const result = sponsorSchema.safeParse(data)
  if (!result.success) {
    return { error: 'Validation failed: ' + result.error.issues.map((i) => i.message).join(', ') }
  }
  // The id is a separate positional argument and was never validated; deleteSponsor below
  // already parses its own.
  const parsedId = z.string().uuid().safeParse(id)
  if (!parsedId.success) return { error: 'Invalid sponsor id' }

  let user, adminClient
  try {
    const auth = await requireSuperAdmin()
    user = auth.user
    adminClient = auth.adminClient
  } catch (e: any) {
    return { error: e.message }
  }

  // Read before write, for the audit row: `sponsors` holds only the current value, so
  // without this the log can say what the cap became but never what it was.
  const { data: before } = await adminClient
    .from('sponsors')
    .select('company_name, industry, website, funding_cap_cents, status')
    .eq('id', parsedId.data)
    .maybeSingle()

  const { data: updated, error } = await adminClient
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
    .eq('id', parsedId.data)
    .select('id')

  if (error) {
    return { error: mapDbError(error, 'adminUpdateSponsor.update') }
  }
  // A zero-row UPDATE is not an error in PostgREST. Without this the platform's only
  // funding-cap write path returns success and writes an audit row pointing at a sponsor
  // that does not exist — the same defect fixed in sponsor-approvals.ts (G-03).
  if (!updated || updated.length === 0) return { error: 'Sponsor not found' }

  // parsed output, never the raw `data` argument: audit_log has no expiry and this used to
  // record whatever a caller sent, unvalidated, including the contact email.
  await adminClient.from('audit_log').insert({
    actor_id: user.id,
    action: 'update_sponsor',
    entity_type: 'sponsors',
    entity_id: parsedId.data,
    metadata: { from: before ? auditFields(dbRowToAuditInput(before)) : null, to: auditFields(result.data) },
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

