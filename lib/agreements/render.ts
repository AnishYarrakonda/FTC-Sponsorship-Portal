import DOMPurify from 'isomorphic-dompurify'
import { MergeFieldKey, MergeContext, isMergeFieldKey } from './merge-fields'

const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g

const ALLOWED_TAGS = ['h1', 'h2', 'h3', 'p', 'ul', 'ol', 'li', 'strong', 'em', 'br', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td']
const ALLOWED_ATTR = ['class']

export class UnknownMergeFieldError extends Error {
  constructor(public readonly tokens: string[]) {
    super(`Unknown merge field(s): ${tokens.join(', ')}`)
    this.name = 'UnknownMergeFieldError'
  }
}

export class MissingMergeFieldError extends Error {
  constructor(public readonly keys: string[]) {
    super(`Missing value for merge field(s): ${keys.join(', ')}`)
    this.name = 'MissingMergeFieldError'
  }
}

/** Every distinct token referenced in the body, in first-seen order. */
export function extractMergeFields(body: string): string[] {
  const seen: string[] = []
  const known = new Set<string>()
  let match: RegExpExecArray | null
  const re = new RegExp(TOKEN_RE)
  while ((match = re.exec(body)) !== null) {
    const token = match[1]
    if (!known.has(token)) {
      known.add(token)
      seen.push(token)
    }
  }
  return seen
}

export type TemplateBodyValidation =
  | { ok: true; fields: MergeFieldKey[] }
  | { ok: false; unknown: string[] }

export function validateTemplateBody(body: string): TemplateBodyValidation {
  const tokens = extractMergeFields(body)
  const unknown = tokens.filter((t) => !isMergeFieldKey(t))
  if (unknown.length > 0) {
    return { ok: false, unknown }
  }
  return { ok: true, fields: tokens as MergeFieldKey[] }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Deterministic renderer. No Date, no Math.random, no locale-dependent formatting —
 * prompt 06 hashes this output, so a non-deterministic byte anywhere breaks signature
 * verification. `agreement_date` and `amount_formatted` arrive pre-formatted in `ctx`.
 */
export function renderAgreement(body: string, ctx: MergeContext): { html: string } {
  const tokens = extractMergeFields(body)
  const unknown = tokens.filter((t) => !isMergeFieldKey(t))
  if (unknown.length > 0) {
    throw new UnknownMergeFieldError(unknown)
  }

  const missing: string[] = []
  for (const token of tokens) {
    const key = token as MergeFieldKey
    const value = ctx[key]
    if (value === undefined || value === null || value.trim().length === 0) {
      missing.push(key)
    }
  }
  if (missing.length > 0) {
    // Never substitute a blank, a dash, or the field name here — a silently blank
    // payee line in an executed agreement is the exact failure mode this guards.
    throw new MissingMergeFieldError(missing)
  }

  const substituted = body.replace(TOKEN_RE, (_full, token: string) => {
    const key = token as MergeFieldKey
    return escapeHtml(ctx[key])
  })

  const html = DOMPurify.sanitize(substituted, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
  })

  return { html }
}
