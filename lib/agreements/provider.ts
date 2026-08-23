// Deliberately narrow — three methods, no vendor concepts leaking in. Server actions
// import ONLY `signatureProvider` (the singleton in in-house-provider.ts) and these
// interface types, never the concrete class, so swapping in a vendor e-sign provider
// later is one new file plus one changed export. Do not build a plugin registry, a
// factory, or an env-var-selected provider — there is one implementation today, and
// speculative indirection beyond this interface is worse than none.

export interface PrepareInput {
  submissionId: string
  signerRole: 'sponsor' | 'coach'
  signerProfileId: string
  clerkUserId: string
}

export interface PreparedDocument {
  templateId: string
  templateKey: string
  templateVersion: number
  title: string
  html: string
  sha256: string
  preparedStoragePath: string
  consentText: string
  consentTextHash: string
  expectedSignerName: string
  /**
   * B-03-08. True while the effective template still carries needs_legal_review — today
   * the sponsorship agreement's Section 11 (Governing Law) is literally
   * "TODO(legal): jurisdiction to be set by counsel."
   *
   * The admin /agreements page already flags this. The signer never saw it, and the
   * signer is the one executing the document under ESIGN/UETA with a SHA-256 of the
   * exact bytes stored as evidence. Surfacing it is not a substitute for counsel writing
   * the clause — it is what stops someone signing while believing one exists.
   */
  needsLegalReview: boolean
}

export interface CaptureInput {
  submissionId: string
  signerRole: 'sponsor' | 'coach'
  signerProfileId: string
  clerkUserId: string
  // The template the prepared document was rendered against. Threaded through from
  // PreparedDocument.templateId so capture() can re-verify "the template version it
  // prepared against is still effective" (see in-house-provider.ts) without a new table
  // or an HMAC. A stale or fabricated value here is harmless: sign_agreement_atomic
  // re-verifies the template's effective status independently before inserting anything.
  templateId: string
  documentHash: string
  typedName: string
  ipAddress: string
  userAgent: string
}

export interface SignatureCapture {
  signatureId: string
  signedAt: string
  documentHash: string
  storagePath: string
  allSigned: boolean
}

export interface RetrievedSignature {
  signatureId: string
  templateKey: string
  templateVersion: number
  signerRole: 'sponsor' | 'coach'
  signerLegalName: string
  signerEmail: string
  typedName: string
  signedAt: string
  ipAddress: string
  userAgent: string
  documentHash: string
  documentUrl: string // short-lived signed URL
}

export interface SignatureProvider {
  prepare(input: PrepareInput): Promise<PreparedDocument>
  capture(input: CaptureInput): Promise<SignatureCapture>
  retrieve(signatureId: string, requesterProfileId: string): Promise<RetrievedSignature>
}
