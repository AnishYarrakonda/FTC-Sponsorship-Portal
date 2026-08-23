import { createAdminClient } from '@/lib/supabase/admin'
import { renderAgreement } from './render'
import { buildSubmissionAgreementContext } from './context'
import { sha256Hex } from './hash'
import type {
  SignatureProvider,
  PrepareInput,
  PreparedDocument,
  CaptureInput,
  SignatureCapture,
  RetrievedSignature,
} from './provider'

// The only template key this slice signs. platform_tos and team_participation remain
// unsigned — see prompts/06 "Out of scope".
const TEMPLATE_KEY = 'sponsorship_agreement'
const BUCKET = 'executed-agreements'

/**
 * The only concrete SignatureProvider today. A vendor e-sign integration would be a new
 * file implementing the same interface plus a changed export below — never edit callers.
 */
export class InHouseSignatureProvider implements SignatureProvider {
  async prepare(input: PrepareInput): Promise<PreparedDocument> {
    const adminClient = createAdminClient()

    const { data: template, error: templateError } = await adminClient
      .from('agreement_templates')
      .select('id, key, version, title, body, consent_text, needs_legal_review')
      .eq('key', TEMPLATE_KEY)
      .eq('status', 'effective')
      .maybeSingle()
    if (templateError || !template) {
      throw new Error('no_effective_template')
    }

    const { data: signerProfile } = await adminClient
      .from('profiles')
      .select('full_name')
      .eq('id', input.signerProfileId)
      .single()

    // buildSubmissionAgreementContext throws MissingMergeFieldError when the team has no
    // legal payee name on file — let it propagate; the caller renders an actionable message.
    const ctx = await buildSubmissionAgreementContext(adminClient, input.submissionId)

    // renderAgreement is deterministic given (body, ctx). agreement_date inside ctx is
    // pinned once, here, at prepare time — that pinned string is what gets hashed and
    // stored, so it never drifts between prepare and capture even across midnight UTC.
    const { html } = renderAgreement(template.body, ctx.mergeContext)
    const sha256 = sha256Hex(html)
    const consentTextHash = sha256Hex(template.consent_text)

    // Storage is now the record of what was displayed — write it immediately, before the
    // signer can possibly type anything.
    const preparedStoragePath = `${input.clerkUserId}/${input.submissionId}/prepared-${sha256}.html`
    const { error: uploadError } = await adminClient.storage
      .from(BUCKET)
      .upload(preparedStoragePath, Buffer.from(html, 'utf-8'), {
        contentType: 'text/html',
        upsert: true,
      })
    if (uploadError) {
      throw new Error('prepared_document_storage_failed')
    }

    return {
      templateId: template.id,
      templateKey: template.key,
      templateVersion: template.version,
      title: ctx.title,
      html,
      sha256,
      preparedStoragePath,
      consentText: template.consent_text,
      consentTextHash,
      expectedSignerName: signerProfile?.full_name ?? '',
      needsLegalReview: template.needs_legal_review === true,
    }
  }

  async capture(input: CaptureInput): Promise<SignatureCapture> {
    const adminClient = createAdminClient()

    // Step 4 of "How the hash stays honest": the template it prepared against must still
    // be effective. templateId is threaded through from PreparedDocument (see provider.ts)
    // rather than persisted server-side — a stale/fabricated id here just fails this check
    // or, later, sign_agreement_atomic's own independent re-verification.
    const { data: template, error: templateError } = await adminClient
      .from('agreement_templates')
      .select('id, key, version, consent_text')
      .eq('id', input.templateId)
      .eq('status', 'effective')
      .maybeSingle()
    if (templateError || !template) {
      throw new Error('template_changed')
    }

    // Step 3: re-read the prepared object from storage by the client-supplied hash, and
    // require the client-supplied hash, the stored path, and a fresh digest of the
    // downloaded bytes to all agree. No trust is placed in a client-supplied document body
    // — only in bytes this server already wrote and is now reading back.
    const preparedStoragePath = `${input.clerkUserId}/${input.submissionId}/prepared-${input.documentHash}.html`
    const { data: downloaded, error: downloadError } = await adminClient.storage
      .from(BUCKET)
      .download(preparedStoragePath)
    if (downloadError || !downloaded) {
      throw new Error('document_changed')
    }
    const html = await downloaded.text()
    if (sha256Hex(html) !== input.documentHash) {
      throw new Error('document_changed')
    }

    const ctx = await buildSubmissionAgreementContext(adminClient, input.submissionId)
    const consentTextHash = sha256Hex(template.consent_text)

    const executedStoragePath =
      `${input.clerkUserId}/${input.submissionId}/` +
      `${template.key}-v${template.version}-${input.signerRole}-${Date.now()}.html`

    const { error: copyError } = await adminClient.storage
      .from(BUCKET)
      .copy(preparedStoragePath, executedStoragePath)
    if (copyError) {
      throw new Error('executed_document_storage_failed')
    }

    const { data: rpcData, error: rpcError } = await adminClient.rpc('sign_agreement_atomic', {
      p_template_id: template.id,
      p_signer_profile_id: input.signerProfileId,
      p_signer_role: input.signerRole,
      p_submission_id: input.submissionId,
      p_typed_name: input.typedName,
      p_ip: input.ipAddress,
      p_user_agent: input.userAgent.slice(0, 512),
      p_document_hash: input.documentHash,
      p_document_storage_path: executedStoragePath,
      p_consent_text_hash: consentTextHash,
      // EntitySnapshot (lib/agreements/context.ts) is a closed, COPPA-audited key set —
      // structurally a plain JSON object, just not literally typed as the generated Json
      // union.
      p_entity_snapshot: ctx.entitySnapshot as unknown as Record<string, string | number | null>,
    })

    if (rpcError) {
      throw new Error('sign_failed')
    }
    const outcome = rpcData as {
      ok: boolean
      error?: string
      signature_id?: string
      all_signed?: boolean
      fulfillment_status?: string
    } | null
    if (!outcome?.ok) {
      throw new Error(outcome?.error ?? 'sign_failed')
    }

    return {
      signatureId: outcome.signature_id!,
      signedAt: new Date().toISOString(),
      documentHash: input.documentHash,
      storagePath: executedStoragePath,
      allSigned: outcome.all_signed ?? false,
    }
  }

  async retrieve(signatureId: string, _requesterProfileId: string): Promise<RetrievedSignature> {
    const adminClient = createAdminClient()

    // The caller (app/actions/agreements-sign.ts) has already proven entitlement via an
    // RLS-respecting read before invoking this method — retrieve() itself runs on the
    // admin client purely to mint the signed URL, exactly as app/(admin)/coaches/page.tsx
    // does for coach-credentials.
    const { data: row, error } = await adminClient
      .from('agreement_signatures')
      .select(
        'id, template_key, template_version, signer_role, signer_legal_name, signer_email, typed_name, signed_at, ip_address, user_agent, document_hash, document_storage_path'
      )
      .eq('id', signatureId)
      .single()
    if (error || !row) {
      throw new Error('not_found')
    }

    const { data: signedUrlData, error: urlError } = await adminClient.storage
      .from(BUCKET)
      .createSignedUrl(row.document_storage_path, 1800)
    if (urlError || !signedUrlData?.signedUrl) {
      throw new Error('document_unavailable')
    }

    return {
      signatureId: row.id,
      templateKey: row.template_key,
      templateVersion: row.template_version,
      signerRole: row.signer_role as 'sponsor' | 'coach',
      signerLegalName: row.signer_legal_name,
      signerEmail: row.signer_email,
      typedName: row.typed_name,
      signedAt: row.signed_at,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      documentHash: row.document_hash,
      documentUrl: signedUrlData.signedUrl,
    }
  }
}

export const signatureProvider: SignatureProvider = new InHouseSignatureProvider()
