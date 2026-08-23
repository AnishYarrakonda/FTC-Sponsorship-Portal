'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAdmin, requireVerifiedCoach } from '@/lib/actions-utils'
import {
  buildPlatformImpactPayload,
  buildSponsorImpactPayload,
  IMPACT_PAYLOAD_SCHEMA_VERSION,
} from '@/lib/impact-report/build'
import { findForbiddenKeys } from '@/lib/impact-report/projection'
import { writeAudit } from '@/lib/audit'

/**
 * Impact report administration.
 *
 * Regeneration happens here and in the nightly cron — never on a page render. A GET that
 * mutates turns every crawler into a rewrite of the record.
 */

const regenerateSchema = z.object({
  scope: z.enum(['sponsor', 'platform']),
  sponsorId: z.string().uuid().optional(),
  year: z.number().int().min(2000).max(2100),
})

const closeSchema = z.object({ year: z.number().int().min(2000).max(2100) })

const reopenSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  reason: z.string().trim().min(10, 'Give a reason of at least 10 characters.').max(1000),
})

const affirmSchema = z.object({ teamId: z.string().uuid(), confirmed: z.boolean() })

type ImpactActionResult = { success?: true; error?: string; generatedAt?: string; count?: number }

function mapImpactError(code: string | undefined): string {
  const messages: Record<string, string> = {
    unauthorized: 'You do not have permission to do that.',
    scope_mismatch: 'A sponsor report needs a sponsor, and a platform report must not have one.',
    year_closed: 'That year is closed. Reopen it first if you need to correct it.',
    reason_required: 'Give a reason of at least 10 characters.',
  }
  return messages[code ?? ''] ?? 'Unable to update the impact report.'
}

export async function regenerateImpactSnapshot(input: {
  scope: 'sponsor' | 'platform'
  sponsorId?: string
  year: number
}): Promise<ImpactActionResult> {
  const parsed = regenerateSchema.safeParse(input)
  if (!parsed.success) {
    return { error: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', ') }
  }
  if (parsed.data.scope === 'sponsor' && !parsed.data.sponsorId) {
    return { error: 'A sponsor report needs a sponsor.' }
  }

  let user, adminClient
  try {
    ;({ user, adminClient } = await requireAdmin())
  } catch (e: any) {
    return { error: e.message }
  }

  const payload =
    parsed.data.scope === 'sponsor'
      ? await buildSponsorImpactPayload(adminClient, parsed.data.sponsorId!, parsed.data.year)
      : await buildPlatformImpactPayload(adminClient, parsed.data.year)

  // Belt and braces over the projection's explicit enumeration. If this ever fires,
  // something bypassed a project*() function and the report must not be stored.
  const leaked = findForbiddenKeys(payload)
  if (leaked.length > 0) {
    console.error('[impact] Refusing to store a payload containing forbidden keys', leaked)
    return { error: 'The report could not be generated safely. An administrator has been alerted.' }
  }

  const { data: result, error: rpcError } = await (adminClient as any).rpc('upsert_impact_snapshot', {
    p_actor_profile_id: user.id,
    p_scope: parsed.data.scope,
    p_sponsor_id: parsed.data.sponsorId ?? null,
    p_report_year: parsed.data.year,
    p_payload: payload,
    p_schema_version: IMPACT_PAYLOAD_SCHEMA_VERSION,
  })

  if (rpcError) return { error: rpcError.message }
  if (!result || result.ok !== true) return { error: mapImpactError(result?.error) }

  await writeAudit(adminClient, {
    actor_id: user.id,
    action: 'admin_regenerate_impact_snapshot',
    entity_type: 'impact_report_snapshots',
    entity_id: result.id as string,
    metadata: {
      scope: parsed.data.scope,
      sponsor_id: parsed.data.sponsorId ?? null,
      report_year: parsed.data.year,
    },
  })

  revalidatePath('/impact')
  revalidatePath('/sponsor/impact')
  return { success: true, generatedAt: result.generated_at as string }
}

export async function closeImpactYear(input: { year: number }): Promise<ImpactActionResult> {
  const parsed = closeSchema.safeParse(input)
  if (!parsed.success) return { error: 'Validation failed.' }

  let user, adminClient
  try {
    ;({ user, adminClient } = await requireAdmin())
  } catch (e: any) {
    return { error: e.message }
  }

  const { data: result, error: rpcError } = await (adminClient as any).rpc('close_impact_report_year', {
    p_actor_profile_id: user.id,
    p_year: parsed.data.year,
  })
  if (rpcError) return { error: rpcError.message }
  if (!result || result.ok !== true) return { error: mapImpactError(result?.error) }

  await writeAudit(adminClient, {
    actor_id: user.id,
    action: 'admin_close_impact_year',
    entity_type: 'impact_report_snapshots',
    entity_id: null,
    metadata: { report_year: parsed.data.year, closed: result.closed },
  })

  revalidatePath('/impact')
  revalidatePath('/sponsor/impact')
  return { success: true, count: result.closed as number }
}

export async function reopenImpactYear(input: {
  year: number
  reason: string
}): Promise<ImpactActionResult> {
  const parsed = reopenSchema.safeParse(input)
  if (!parsed.success) {
    return { error: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', ') }
  }

  let user, adminClient
  try {
    ;({ user, adminClient } = await requireAdmin())
  } catch (e: any) {
    return { error: e.message }
  }

  const { data: result, error: rpcError } = await (adminClient as any).rpc('reopen_impact_report_year', {
    p_actor_profile_id: user.id,
    p_year: parsed.data.year,
    p_reason: parsed.data.reason,
  })
  if (rpcError) return { error: rpcError.message }
  if (!result || result.ok !== true) return { error: mapImpactError(result?.error) }

  await writeAudit(adminClient, {
    actor_id: user.id,
    action: 'admin_reopen_impact_year',
    entity_type: 'impact_report_snapshots',
    entity_id: null,
    metadata: { report_year: parsed.data.year, reopened: result.reopened, reason: parsed.data.reason },
  })

  revalidatePath('/impact')
  revalidatePath('/sponsor/impact')
  return { success: true, count: result.reopened as number }
}

/**
 * The coach's portfolio-photo affirmation.
 *
 * Photos are excluded from every report until this is set, and a database trigger clears
 * it whenever media_urls changes — so adding a photo after affirming means affirming
 * again. Fail closed is the only acceptable default here.
 */
export async function confirmPortfolioMediaNoMinors(input: {
  teamId: string
  confirmed: boolean
}): Promise<ImpactActionResult> {
  const parsed = affirmSchema.safeParse(input)
  if (!parsed.success) return { error: 'Validation failed.' }

  let user, supabase
  try {
    ;({ user, supabase } = await requireVerifiedCoach())
  } catch (e: any) {
    return { error: e.message }
  }

  // Ownership proven by the filter AND checked by rowcount: a zero-row UPDATE is not an
  // error, which is the lesson app/actions/team.ts:199-211 records.
  const { data: updated, error } = await supabase
    .from('teams')
    .update({ media_no_minors_confirmed_at: parsed.data.confirmed ? new Date().toISOString() : null })
    .eq('id', parsed.data.teamId)
    .eq('owner_id', user.id)
    .select('id')

  if (error) return { error: error.message }
  if (!updated || updated.length === 0) return { error: 'Team not found.' }

  const { createAdminClient } = await import('@/lib/supabase/admin')
  await writeAudit(createAdminClient(), {
    actor_id: user.id,
    action: 'confirm_portfolio_media_no_minors',
    entity_type: 'teams',
    entity_id: parsed.data.teamId,
    metadata: { confirmed: parsed.data.confirmed },
  })

  revalidatePath('/dashboard')
  return { success: true }
}
