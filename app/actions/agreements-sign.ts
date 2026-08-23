'use server'

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { requireAuth, requireSponsorRole, getClientIp } from '@/lib/actions-utils'
import { createAdminClient } from '@/lib/supabase/admin'
import { createInAppNotification } from '@/lib/notify'
import { signatureProvider } from '@/lib/agreements/in-house-provider'
import { MissingMergeFieldError } from '@/lib/agreements/render'
import { typedNameMatches } from '@/lib/agreements/typed-name-match'
import {
  prepareAgreementForSigningSchema,
  signAgreementSchema,
  getExecutedAgreementSchema,
} from '@/lib/schemas/agreement-signature'
import type { PreparedDocument, RetrievedSignature } from '@/lib/agreements/provider'
import { writeAudit } from '@/lib/audit'

type SignerRole = 'sponsor' | 'coach'

function resolveSignerRole(role: string): SignerRole | null {
  if (role === 'sponsor') return 'sponsor'
  if (role === 'coach') return 'coach'
  return null
}

function mapSignError(code: string): string {
  switch (code) {
    case 'unauthorized':
      return 'You are not authorized to sign this agreement.'
    case 'insufficient_org_role':
      return 'Only an approver or organization admin can sign a sponsorship agreement. Ask a teammate with that access to sign.'
    case 'awaiting_sponsor_signature':
      return 'Waiting for the sponsor to sign first.'
    case 'already_signed':
      return 'You have already signed this agreement.'
    case 'profile_incomplete':
      return 'Add your full legal name to your account before signing.'
    case 'template_not_effective':
    case 'template_changed':
      return 'This document was updated since you opened it. Please reload the page and try again.'
    /**
     * A-04-02. The template still carries needs_legal_review, which migration 0079 defines
     * as "an attorney must review it and an admin must clear the flag before this platform
     * relies on it in a real transaction". 0106 turned that from documentation into a gate.
     * The signer cannot resolve this themselves, so name who can.
     */
    case 'template_needs_legal_review':
      return 'This agreement is still awaiting review by counsel and cannot be signed yet. The platform administrator has been notified — you will be emailed when it is ready.'
    case 'document_changed':
      return 'This document changed since you opened it. Please reload the page and try again.'
    case 'submission_not_found':
      return 'That submission could not be found.'
    case 'no_bound_entity':
      return 'This agreement is no longer linked to a team or sponsor.'
    case 'fulfillment_transition_failed':
      return 'We could not finalize your signature. Please try again — if this keeps happening, contact support.'
    default:
      return 'We could not record your signature right now. Please try again.'
  }
}

export async function prepareAgreementForSigning(data: {
  submissionId: string
}): Promise<{ document?: PreparedDocument; alreadySigned?: true; signatureId?: string; error?: string }> {
  // 1. VALIDATE
  const parsed = prepareAgreementForSigningSchema.safeParse(data)
  if (!parsed.success) {
    return { error: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', ') }
  }

  // 2. AUTH / ROLE — one action serves both roles; the RPC does the real entitlement
  // check. requireSponsor()/requireVerifiedCoach() are deliberately not used here.
  let user, supabase, clerkUserId
  try {
    ;({ user, supabase, clerkUserId } = await requireAuth())
  } catch (e: any) {
    return { error: e.message }
  }
  if (user.role === 'admin') {
    return { error: 'Administrators cannot sign on behalf of a party.' }
  }
  const signerRole = resolveSignerRole(user.role)
  if (!signerRole) {
    return { error: 'Only sponsors and coaches can sign a sponsorship agreement.' }
  }

  // 3. Load the submission through the caller's own RLS-scoped client.
  const { data: submission } = await supabase
    .from('submissions')
    .select('id, sponsor_id, team_id')
    .eq('id', parsed.data.submissionId)
    .maybeSingle()
  if (!submission) {
    return { error: 'unauthorized' }
  }

  const { data: team } = await supabase
    .from('teams')
    .select('owner_id, team_name')
    .eq('id', submission.team_id)
    .maybeSingle()

  if (signerRole === 'coach') {
    if (!team || team.owner_id !== user.id) {
      return { error: 'unauthorized' }
    }
  } else if (submission.sponsor_id !== user.sponsor_id) {
    return { error: 'unauthorized' }
  }

  // 4. Not applicable — no fulfillment to sign for (or it was cancelled).
  const { data: fulfillment } = await supabase
    .from('funding_fulfillments')
    .select('id, status')
    .eq('submission_id', parsed.data.submissionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!fulfillment || fulfillment.status === 'cancelled') {
    return { error: 'not_applicable' }
  }

  // 5. Already signed — idempotent on refresh.
  const { data: existing } = await supabase
    .from('agreement_signatures')
    .select('id')
    .eq('submission_id', parsed.data.submissionId)
    .eq('signer_role', signerRole)
    .maybeSingle()
  if (existing) {
    return { alreadySigned: true, signatureId: existing.id }
  }

  // 6. Ordering — the coach sees "waiting", not a form, before the sponsor has signed.
  if (signerRole === 'coach') {
    const { data: sponsorSig } = await supabase
      .from('agreement_signatures')
      .select('id')
      .eq('submission_id', parsed.data.submissionId)
      .eq('signer_role', 'sponsor')
      .maybeSingle()
    if (!sponsorSig) {
      return { error: 'awaiting_sponsor_signature' }
    }
  }

  // 7. Prepare (read-only from the caller's perspective — no audit, no notify).
  try {
    const document = await signatureProvider.prepare({
      submissionId: parsed.data.submissionId,
      signerRole,
      signerProfileId: user.id,
      clerkUserId,
    })
    return { document }
  } catch (e) {
    if (e instanceof MissingMergeFieldError) {
      if (signerRole === 'coach') {
        return { error: 'Add your payout details before signing.' }
      }
      // Sponsor is blocked by something only the coach can fix. Nudge the coach —
      // best-effort; a failed notification should not also block the sponsor's page.
      if (team) {
        await createInAppNotification({
          recipientId: team.owner_id,
          type: 'general',
          title: 'Complete your payout profile to receive funding',
          body: `A sponsor is ready to sign your sponsorship agreement, but your team is missing payout details. Add them from your team settings to continue.`,
          submissionId: parsed.data.submissionId,
        })
      }
      return { error: 'This team has not finished its payout profile — we have notified them.' }
    }
    return { error: 'We could not prepare this document right now. Please try again.' }
  }
}

export async function signAgreement(data: {
  submissionId: string
  templateId: string
  documentHash: string
  typedName: string
  consentAccepted: boolean
}): Promise<{ success?: true; signatureId?: string; allSigned?: boolean; error?: string }> {
  // 1. VALIDATE
  const parsed = signAgreementSchema.safeParse(data)
  if (!parsed.success) {
    return { error: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', ') }
  }

  // 2. AUTH / ROLE
  let user, supabase, clerkUserId
  try {
    ;({ user, supabase, clerkUserId } = await requireAuth())
  } catch (e: any) {
    return { error: e.message }
  }
  if (user.role === 'admin') {
    return { error: 'Administrators cannot sign on behalf of a party.' }
  }
  const signerRole = resolveSignerRole(user.role)
  if (!signerRole) {
    return { error: 'Only sponsors and coaches can sign a sponsorship agreement.' }
  }

  // Belonging to a sponsor org is not authority to bind it. Signing commits the company
  // to a legally binding sponsorship agreement, so it sits at the same rank as confirming
  // a funding decision — approver and above. Without this a `viewer` (the rank every
  // SSO/JIT first login lands on, per jitMemberRole) could execute the contract.
  // sign_agreement_atomic re-checks this independently in SQL (0099); this layer exists
  // to return a message that explains itself. Coaches are unaffected — they sign as the
  // team owner, which the RPC verifies separately.
  if (signerRole === 'sponsor') {
    try {
      await requireSponsorRole('approver')
    } catch (e: any) {
      return {
        error:
          e?.code === 'INSUFFICIENT_ORG_ROLE'
            ? 'Only an approver or organization admin can sign a sponsorship agreement. Ask a teammate with that access to sign.'
            : e.message,
      }
    }
  }

  // Typed-name match — done here (not in the RPC) so the message can name the expected
  // value. The RPC stores whatever typed_name it is given.
  const expected = user.full_name ?? ''
  if (!typedNameMatches(parsed.data.typedName, expected)) {
    return {
      error: `The typed name must match the name on your account (${expected || 'your account name'}).`,
    }
  }

  const ipAddress = await getClientIp()
  const userAgent = (await headers()).get('user-agent') ?? 'unknown'

  // 3. MUTATE — via the provider only, never a raw table write.
  let capture
  try {
    capture = await signatureProvider.capture({
      submissionId: parsed.data.submissionId,
      signerRole,
      signerProfileId: user.id,
      clerkUserId,
      templateId: parsed.data.templateId,
      documentHash: parsed.data.documentHash,
      typedName: parsed.data.typedName,
      ipAddress,
      userAgent,
    })
  } catch (e) {
    return { error: mapSignError(e instanceof Error ? e.message : 'sign_failed') }
  }

  const adminClient = createAdminClient()

  // 4. AUDIT — via the admin client; audit_log is RLS-protected. IP is already a
  // first-class column on the signature row, so it is not duplicated into metadata.
  await writeAudit(adminClient, {
    actor_id: user.id,
    action: 'agreement_signed',
    entity_type: 'agreement_signatures',
    entity_id: capture.signatureId,
    metadata: {
      submission_id: parsed.data.submissionId,
      template_id: parsed.data.templateId,
      signer_role: signerRole,
      document_hash: capture.documentHash,
      all_signed: capture.allSigned,
    },
  })

  // 5. NOTIFY — transactional, both parties genuinely need the email (skipEmail stays
  // at its default false). No new notifications.type value; 'general' per house rule.
  const { data: submission } = await supabase
    .from('submissions')
    .select('id, team_id, sponsor_id')
    .eq('id', parsed.data.submissionId)
    .maybeSingle()

  if (submission) {
    if (signerRole === 'sponsor') {
      const { data: team } = await adminClient
        .from('teams')
        .select('owner_id')
        .eq('id', submission.team_id)
        .maybeSingle()
      if (team) {
        await createInAppNotification({
          recipientId: team.owner_id,
          type: 'general',
          title: 'Sign your sponsorship agreement',
          body: `Your sponsor has signed the sponsorship agreement. Countersign it at /submissions/${submission.id}/sign to finish executing it.`,
          submissionId: submission.id,
        })
      }
    } else {
      const [{ data: sponsorProfiles }, { data: team }] = await Promise.all([
        adminClient.from('profiles').select('id').eq('role', 'sponsor').eq('sponsor_id', submission.sponsor_id),
        adminClient.from('teams').select('team_name').eq('id', submission.team_id).maybeSingle(),
      ])
      for (const sponsorProfile of sponsorProfiles ?? []) {
        await createInAppNotification({
          recipientId: sponsorProfile.id,
          type: 'general',
          title: 'Agreement fully executed',
          body: `${team?.team_name ?? 'The team'} countersigned — your sponsorship agreement is fully executed.`,
          submissionId: submission.id,
        })
      }
    }
  }

  revalidatePath(`/sponsor/submissions/${parsed.data.submissionId}`)
  revalidatePath(`/submissions/${parsed.data.submissionId}`)
  revalidatePath(`/sponsor/submissions/${parsed.data.submissionId}/sign`)
  revalidatePath(`/submissions/${parsed.data.submissionId}/sign`)

  return { success: true, signatureId: capture.signatureId, allSigned: capture.allSigned }
}

export async function getExecutedAgreement(data: {
  signatureId: string
}): Promise<{ signatures?: RetrievedSignature[]; error?: string }> {
  // 1. VALIDATE
  const parsed = getExecutedAgreementSchema.safeParse(data)
  if (!parsed.success) {
    return { error: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', ') }
  }

  // 2. AUTH
  let user, supabase
  try {
    ;({ user, supabase } = await requireAuth())
  } catch (e: any) {
    return { error: e.message }
  }

  // 3. Prove entitlement through the caller's RLS-respecting client BEFORE minting
  // anything. A non-party gets zero rows here — collapsed to "not found" for both
  // "doesn't exist" and "not yours".
  const { data: anchor } = await supabase
    .from('agreement_signatures')
    .select('id, submission_id')
    .eq('id', parsed.data.signatureId)
    .maybeSingle()
  if (!anchor) {
    return { error: 'not_found' }
  }

  let ids = [anchor.id]
  if (anchor.submission_id) {
    const { data: siblings } = await supabase
      .from('agreement_signatures')
      .select('id')
      .eq('submission_id', anchor.submission_id)
      .order('signed_at', { ascending: true })
    if (siblings && siblings.length > 0) {
      ids = siblings.map((s) => s.id)
    }
  }

  const signatures: RetrievedSignature[] = []
  for (const id of ids) {
    try {
      signatures.push(await signatureProvider.retrieve(id, user.id))
    } catch {
      // A signature disappearing between the RLS read and retrieve() is not expected —
      // skip it rather than fail the whole page.
    }
  }
  if (signatures.length === 0) {
    return { error: 'not_found' }
  }

  // 4. AUDIT
  const adminClient = createAdminClient()
  await writeAudit(adminClient, {
    actor_id: user.id,
    action: 'agreement_document_retrieved',
    entity_type: 'agreement_signatures',
    entity_id: parsed.data.signatureId,
    metadata: { submission_id: anchor.submission_id },
  })

  return { signatures }
}
