/**
 * Upload validation by MIME allowlist + magic bytes.
 *
 * `uploadTeamLogo` (app/actions/team.ts) trusted two attacker-controlled values: the
 * filename extension, and `file.type`, which is whatever the browser (or a hand-rolled
 * multipart request) says it is. It then stored the object with
 * `contentType: file.type` in a **public** bucket, so a caller could upload arbitrary
 * bytes served back under a content type of their choosing.
 *
 * The correct implementation already existed in this repo — `validateCredentialFile` in
 * app/actions/auth.ts does MIME allowlist + magic bytes — but lived inside a `'use server'`
 * module, so it could not be shared. This module is that logic, extracted, with WebP added
 * for logos. Both call sites now go through it, so they cannot drift apart.
 *
 * Bounded honestly: these files are served from *.supabase.co, a different origin from the
 * app, so the risk is content hosting rather than app XSS. That does not make it fine to
 * accept a PDF or an HTML file as someone's team logo.
 */

export type AllowedImageMime = 'image/jpeg' | 'image/png' | 'image/webp'
export type AllowedDocMime = 'application/pdf' | 'image/jpeg' | 'image/png'

const EXT_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/** First bytes of the file, lowercase hex. 12 bytes covers WebP's RIFF....WEBP header. */
async function magicHex(file: File): Promise<string> {
  const buffer = await file.slice(0, 12).arrayBuffer()
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function magicMatches(mime: string, hex: string): boolean {
  switch (mime) {
    case 'application/pdf':
      return hex.startsWith('25504446') // %PDF
    case 'image/jpeg':
      return hex.startsWith('ffd8ff')
    case 'image/png':
      return hex.startsWith('89504e470d0a1a0a')
    case 'image/webp':
      // RIFF....WEBP — bytes 0-3 are 'RIFF', 8-11 are 'WEBP'; 4-7 are the file size.
      return hex.startsWith('52494646') && hex.slice(16, 24) === '57454250'
    default:
      return false
  }
}

export interface FileValidationOptions {
  allowedMimes: readonly string[]
  maxBytes: number
  /** Used only in the size-error copy. */
  label?: string
}

/**
 * Returns the canonical extension derived from the VERIFIED mime type — never from the
 * client-supplied filename.
 */
export async function validateUploadedFile(
  file: File,
  { allowedMimes, maxBytes, label = 'File' }: FileValidationOptions
): Promise<{ ext: string; mime: string; error?: never } | { ext?: never; mime?: never; error: string }> {
  if (!file || file.size === 0) return { error: 'No file provided.' }

  if (file.size > maxBytes) {
    const mb = Math.round((maxBytes / (1024 * 1024)) * 10) / 10
    return { error: `${label} is too large. Maximum size is ${mb} MB.` }
  }

  if (!allowedMimes.includes(file.type)) {
    const pretty = allowedMimes.map((m) => (EXT_BY_MIME[m] ?? m).toUpperCase()).join(', ')
    return { error: `Invalid file type. Only ${pretty} are allowed.` }
  }

  if (!magicMatches(file.type, await magicHex(file))) {
    return { error: 'The file contents do not match its type. Please upload a valid file.' }
  }

  const ext = EXT_BY_MIME[file.type]
  if (!ext) return { error: 'Invalid file type.' }
  return { ext, mime: file.type }
}

export const CREDENTIAL_MIMES: readonly AllowedDocMime[] = ['application/pdf', 'image/jpeg', 'image/png']
export const IMAGE_MIMES: readonly AllowedImageMime[] = ['image/jpeg', 'image/png', 'image/webp']


/**
 * Tax-document upload policy (W-9). PDF only, 5 MB.
 *
 * Lives here rather than in app/actions/auth.ts because it is a pure rule with no server
 * dependency, and importing it from that `'use server'` module drags in `server-only`
 * through the audit helper. `tests/e2e/payout-w9.spec.ts` imported it that way and could
 * not be COLLECTED at all — Playwright failed on the whole file, so every payout/W-9
 * security-boundary test in it had been silently absent from the suite. That is the same
 * failure class as B-04-12: a test that cannot run reads as a test that passed.
 */
export const MAX_TAX_DOC_FILE_SIZE = 5 * 1024 * 1024
export const ALLOWED_TAX_DOC_MIMES = ['application/pdf'] as const

export async function validateTaxDocumentFile(
  file: File
): Promise<{ ext: string; error?: never } | { ext?: never; error: string }> {
  const result = await validateUploadedFile(file, {
    allowedMimes: ALLOWED_TAX_DOC_MIMES,
    maxBytes: MAX_TAX_DOC_FILE_SIZE,
    label: 'Tax document',
  })
  if (result.error !== undefined) return { error: result.error }
  return { ext: result.ext }
}
