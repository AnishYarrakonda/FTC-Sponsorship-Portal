'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireSponsorRole } from '@/lib/actions-utils'
import { updateSponsorAsOrgAdmin } from '@/lib/sponsor-org-writes'
import { mapDbError } from '@/lib/errors'
import { writeAudit } from '@/lib/audit'

/**
 * A-12-04. Enterprise finance metadata: a purchase-order reference on a commitment, and
 * the month a sponsor's fiscal year begins.
 *
 * Neither of these touches money. The PO number is administrative text; the fiscal year is
 * a reporting boundary. `funding_cap_cents` remains the single enforcement point for
 * Capacity Integrity — see the header of migration 0110 for why a second per-year budget
 * was deliberately not introduced.
 */

const poSchema = z.object({
  fulfillmentId: z.string().uuid(),
  poNumber: z
    .string()
    .trim()
    .max(64, 'A PO number must be 64 characters or fewer')
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
})

export async function setFulfillmentPoNumber(data: z.input<typeof poSchema>) {
  // 1. VALIDATE
  const parsed = poSchema.safeParse(data)
  if (!parsed.success) {
    return { error: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', ') }
  }

  // 2. AUTH. `submitter` and above: recording the PO their AP department issued is part of
  //    the same job as offering the money, and it commits nothing.
  let user, sponsorIds, adminClient
  try {
    ;({ user, sponsorIds, adminClient } = await requireSponsorRole('submitter'))
  } catch (e: any) {
    return { error: e.message }
  }

  // 3. OWNERSHIP. Scoped by the caller's real orgs, so a fulfillment id from another
  //    tenant matches nothing rather than being written.
  const { data: fulfillment } = await adminClient
    .from('funding_fulfillments')
    .select('id, sponsor_id, po_number')
    .eq('id', parsed.data.fulfillmentId)
    .in('sponsor_id', sponsorIds)
    .maybeSingle()

  if (!fulfillment) return { error: 'That commitment could not be found.' }

  const { error } = await adminClient
    .from('funding_fulfillments')
    .update({ po_number: parsed.data.poNumber })
    .eq('id', parsed.data.fulfillmentId)
    .in('sponsor_id', sponsorIds)

  if (error) return { error: mapDbError(error, 'setFulfillmentPoNumber.update') }

  // 4. AUDIT
  await writeAudit(adminClient, {
    actor_id: user.id,
    action: 'set_fulfillment_po_number',
    entity_type: 'funding_fulfillments',
    entity_id: parsed.data.fulfillmentId,
    metadata: {
      sponsor_id: fulfillment.sponsor_id,
      from: fulfillment.po_number ?? null,
      to: parsed.data.poNumber,
    },
  })

  revalidatePath('/sponsor/funding')
  return { success: true }
}

const fiscalYearSchema = z.object({
  fiscalYearStartMonth: z
    .number()
    .int()
    .min(1, 'Choose a month')
    .max(12, 'Choose a month'),
})

export async function setFiscalYearStartMonth(data: z.input<typeof fiscalYearSchema>) {
  const parsed = fiscalYearSchema.safeParse(data)
  if (!parsed.success) {
    return { error: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', ') }
  }

  let user, sponsorId, adminClient
  try {
    ;({ user, sponsorId, adminClient } = await requireSponsorRole('org_admin'))
  } catch (e: any) {
    return { error: e.message }
  }

  const { data: before } = await adminClient
    .from('sponsors')
    .select('fiscal_year_start_month')
    .eq('id', sponsorId)
    .maybeSingle()

  // Column allowlist, same control as the approval threshold — an org admin reaches
  // `sponsors` only through the RLS-bypassing admin client, so this is what keeps
  // funding_cap_cents out of reach.
  const { error } = await updateSponsorAsOrgAdmin(adminClient, sponsorId, {
    fiscal_year_start_month: parsed.data.fiscalYearStartMonth,
  })
  if (error) return { error: mapDbError(error, 'setFiscalYearStartMonth.update') }

  await writeAudit(adminClient, {
    actor_id: user.id,
    action: 'update_org_fiscal_year',
    entity_type: 'sponsors',
    entity_id: sponsorId,
    metadata: {
      sponsor_id: sponsorId,
      from: before?.fiscal_year_start_month ?? null,
      to: parsed.data.fiscalYearStartMonth,
    },
  })

  revalidatePath('/sponsor/settings')
  revalidatePath('/sponsor/funding')
  return { success: true }
}
