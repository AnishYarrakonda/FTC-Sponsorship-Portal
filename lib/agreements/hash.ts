import { createHash } from 'crypto'

/**
 * SHA-256 hex digest of a UTF-8 string. The single hashing primitive the e-sign capture
 * flow relies on for document integrity (prompts/06) — an explicit 'utf-8' encoding so a
 * future change here cannot silently alter every stored document_hash.
 */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf-8').digest('hex')
}
