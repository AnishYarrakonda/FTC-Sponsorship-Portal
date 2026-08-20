// Pure, network-free fuzzy comparison between a coach-claimed team identity and the
// official FIRST roster record. No imports beyond node builtins so the scoring rules
// are unit-testable in isolation from the network/DB code in lib/ftc-roster.ts.

const NOISE_TOKENS = new Set([
  'team', 'robotics', 'ftc', 'first', 'the', 'and', 'inc', 'llc',
  'high', 'school', 'academy', 'club', 'program',
])

export function normalizeTeamName(raw: string): string {
  let s = raw.toLowerCase()
  s = s.normalize('NFD').replace(/\p{Diacritic}/gu, '')
  s = s.replace(/^#?\d+\s*/, '')
  s = s.replace(/[^a-z0-9]+/g, ' ')
  const tokens = s.split(' ').filter((t) => t.length > 0 && !NOISE_TOKENS.has(t))
  return tokens.join(' ').trim()
}

// Bigrams over the normalized string AS-IS (word-separating spaces included, since
// normalizeTeamName joins surviving tokens with single spaces). Collapsing whitespace
// here would make "gear heads" and "gearheads" produce identical bigram sets — losing
// exactly the word-boundary signal that keeps a near-miss like that one out of auto_pass.
function bigrams(s: string): string[] {
  if (s.length < 2) return s.length === 1 ? [s] : []
  const out: string[] = []
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2))
  return out
}

// Sørensen–Dice coefficient over character bigrams. Identical strings -> 1. Either
// side empty -> 0.
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1

  const bigramsA = bigrams(a)
  const bigramsB = bigrams(b)
  if (bigramsA.length === 0 || bigramsB.length === 0) return 0

  const counts = new Map<string, number>()
  for (const bg of bigramsA) counts.set(bg, (counts.get(bg) ?? 0) + 1)

  let overlap = 0
  for (const bg of bigramsB) {
    const remaining = counts.get(bg) ?? 0
    if (remaining > 0) {
      overlap++
      counts.set(bg, remaining - 1)
    }
  }

  return (2 * overlap) / (bigramsA.length + bigramsB.length)
}

export interface MatchResult {
  nameScore: number
  organizationScore: number | null
  confidence: number
  outcome: 'auto_pass' | 'needs_review' | 'rejected'
}

export function scoreTeamMatch(input: {
  claimedTeamName: string
  claimedOrganization?: string | null
  officialTeamName: string | null
  officialOrganization?: string | null
}): MatchResult {
  const nameScore = similarity(
    normalizeTeamName(input.claimedTeamName),
    normalizeTeamName(input.officialTeamName ?? '')
  )

  const hasOrgComparison =
    !!input.claimedOrganization?.trim() && !!input.officialOrganization?.trim()
  const organizationScore = hasOrgComparison
    ? similarity(
        normalizeTeamName(input.claimedOrganization!),
        normalizeTeamName(input.officialOrganization!)
      )
    : null

  const confidence =
    organizationScore === null ? nameScore : 0.75 * nameScore + 0.25 * organizationScore

  // A near-exact name match short-circuits to auto_pass regardless of organization —
  // teams routinely list a different sponsor org than the coach types.
  if (nameScore >= 0.95) {
    return { nameScore, organizationScore, confidence, outcome: 'auto_pass' }
  }

  const outcome: MatchResult['outcome'] =
    confidence >= 0.85 ? 'auto_pass' : confidence >= 0.55 ? 'needs_review' : 'rejected'

  return { nameScore, organizationScore, confidence, outcome }
}
