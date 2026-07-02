'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { sponsorApplicationSchema, sponsorSchema, type SponsorApplicationInput, type SponsorInput } from '@/lib/schemas/sponsor'
import { sendSponsorApplicationConfirmation } from '@/lib/notify'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getClientIp, requireAdmin } from '@/lib/actions-utils'
import { mapDbError } from '@/lib/errors'
import * as Sentry from '@sentry/nextjs'

/**
 * Postgres-backed throttle (see 0055_coach_denial_and_throttle.sql). Callable
 * only via the admin client (EXECUTE is restricted to service_role). Returns
 * true when the caller is within the limit. Fails OPEN (with a Sentry report)
 * so a throttle outage never takes the public application form down.
 */
async function checkThrottle(
  adminClient: ReturnType<typeof createAdminClient>,
  key: string,
  limit: number,
  window: string
): Promise<boolean> {
  try {
    const { data, error } = await adminClient.rpc('check_throttle', {
      p_key: key,
      p_limit: limit,
      p_window: window,
    })
    if (error) {
      console.error('[sponsor-apply] check_throttle failed', error)
      Sentry.captureException(new Error(`[sponsor-apply] check_throttle failed: ${error.message}`), {
        extra: { key, limit, window },
      })
      return true
    }
    return data !== false
  } catch (err) {
    console.error('[sponsor-apply] check_throttle threw', err)
    Sentry.captureException(err)
    return true
  }
}

export async function submitSponsorApplication(data: SponsorApplicationInput) {
  const result = sponsorApplicationSchema.safeParse(data)
  if (!result.success) {
    return { error: 'Invalid data provided' }
  }

  const { companyName, contactName, contactEmail, proposedCapCents, message, website2 } = result.data

  // Honeypot: real users never see or fill this field. Pretend success so bots
  // get no signal, and do nothing else.
  if (website2 && website2.trim().length > 0) {
    return { success: true }
  }

  // Use admin client since the user may be unauthenticated
  const supabase = createAdminClient()

  // Abuse protection: per-IP (3/hour) and per-normalized-email (2/day) throttles.
  const ip = await getClientIp()
  if (!(await checkThrottle(supabase, `sponsor-apply:${ip}`, 3, '1 hour'))) {
    return { error: 'Too many applications from this network — please try again later.' }
  }

  const normalizedEmail = contactEmail.trim().toLowerCase()
  if (!(await checkThrottle(supabase, `sponsor-apply-email:${normalizedEmail}`, 2, '1 day'))) {
    return { error: 'Too many applications for this email address — please try again later.' }
  }

  const { error } = await supabase
    .from('sponsor_applications')
    .insert({
      company_name: companyName,
      contact_name: contactName,
      contact_email: contactEmail,
      proposed_cap_cents: proposedCapCents,
      message,
    })

  if (error) {
    return { error: mapDbError(error, 'submitSponsorApplication.insert') }
  }

  // Confirmation email failure is non-fatal — the application is saved and the
  // sender already reports to Sentry.
  await sendSponsorApplicationConfirmation(
    companyName,
    contactEmail,
    contactName ?? 'Sponsor',
    proposedCapCents
  )

  return { success: true }
}

export async function adminCreateSponsor(data: SponsorInput) {
  const result = sponsorSchema.safeParse(data)
  if (!result.success) {
    return { error: 'Invalid data provided' }
  }

  let user, adminClient
  try {
    const auth = await requireAdmin()
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

export async function adminUpdateSponsor(id: string, data: SponsorInput) {
  const result = sponsorSchema.safeParse(data)
  if (!result.success) {
    return { error: 'Invalid data provided' }
  }

  let user, adminClient
  try {
    const auth = await requireAdmin()
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

export async function deleteSponsor(id: string): Promise<{ success?: true; error?: string }> {
  const parsed = deleteSponsorSchema.safeParse({ id })
  if (!parsed.success) return { error: 'Invalid sponsor id' }

  let user, adminClient
  try {
    const auth = await requireAdmin()
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
export async function adminToggleSponsorStatus(id: string, newStatus: 'active' | 'inactive') {
  let user, adminClient
  try {
    const auth = await requireAdmin()
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

