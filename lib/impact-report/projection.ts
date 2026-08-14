/**
 * COPPA ALLOWLIST. Core Mandate #1.
 *
 * This module is the security control for CSR impact reports. Treat it accordingly:
 * heavy comments, no cleverness, no shortcuts.
 *
 * The arrays below are the ONLY columns that may appear in a report. They are used twice:
 *
 *   1. to build the PostgREST `.select()` string, so the database never returns a
 *      non-allowlisted column into this process at all; and
 *   2. to drive the explicit projections below, so nothing unknown can be copied into the
 *      output.
 *
 * NO OBJECT SPREAD, NO Object.assign, NO ...rest ANYWHERE IN THIS FILE. Every output
 * object is built key by key. A column added to `teams` next season therefore cannot reach
 * a report by accident — someone has to edit this file on purpose, and adding a field here
 * is a COPPA decision, not a formatting one. A unit test reads this file and fails the
 * build if a spread appears.
 *
 * This module never references `profiles`. Not for a coach's name, not for an email, not
 * for a "prepared by" line. The report is about the team.
 */

/** Team columns. `id` and `media_no_minors_confirmed_at` are internal — see projectTeam. */
export const IMPACT_TEAM_FIELDS = [
  'id',
  'ftc_team_number',
  'team_name',
  'organization',
  'city',
  'state',
  'tax_status',
  'founded_year',
  'seasons_competed',
  'team_size',
  'students_reached',
  'events_hosted',
  'volunteer_hours',
  'tagline',
  'mission_statement',
  'outreach_summary',
  'logo_url',
  'media_urls',
  'media_no_minors_confirmed_at',
] as const

/** The whole of team_achievements minus id/team_id/created_at. 0060:9 records that none of
 *  it is student PII. */
export const IMPACT_ACHIEVEMENT_FIELDS = ['season', 'event_name', 'award', 'description'] as const

/**
 * Not `payment_reference` (prompt 01 forbids it leaving the row, and a CSR report gets
 * emailed around) and not `notes` (free text that may name a person at the sponsor).
 */
export const IMPACT_FULFILLMENT_FIELDS = [
  'amount_cents',
  'status',
  'pledged_at',
  'payment_received_at',
  'receipted_at',
] as const

export const IMPACT_BENEFIT_FIELDS = ['benefit_type', 'status', 'delivered_at', 'proof_url'] as const

/**
 * Every one of these has a recorded reason:
 *
 *  - Everything on `profiles` — the report never joins it.
 *  - `coach_photo_url` — a photograph of a named adult, and a retention-managed artifact.
 *  - `coach_experience`, `community_endorsements`, `subteam_breakdown` — free text that in
 *    practice names individuals ("our captain Maya rebuilt the intake…"). A sanitiser
 *    cannot reliably find a first name, so the fields are excluded outright.
 *  - `press_links` — outbound links to articles that routinely name and photograph
 *    students. Linking to them from a document we publish is the same exposure at one
 *    remove.
 *  - `past_sponsors` — not PII. Excluded on judgment: naming other companies inside one
 *    sponsor's own CSR document is a needless awkwardness.
 *  - Free text on `submissions` — a coach's prose about a specific ask, not impact, and the
 *    highest-risk place for an incidental student mention.
 *  - `payment_reference`, `notes` — see IMPACT_FULFILLMENT_FIELDS.
 */
export const IMPACT_FORBIDDEN_KEYS = [
  'full_name',
  'email',
  'contact_email',
  'contact_name',
  'contact_title',
  'phone_number',
  'date_of_birth',
  'address_line1',
  'zip_code',
  'referral_source',
  'coach_credentials_url',
  'coach_photo_url',
  'coach_experience',
  'community_endorsements',
  'subteam_breakdown',
  'press_links',
  'past_sponsors',
  'custom_pitch_alignment',
  'specific_needs_statement',
  'local_connection_notes',
  'payment_reference',
  'notes',
  'clerk_user_id',
] as const

/** At most six portfolio photos per team. A report is a document, not a gallery. */
export const IMPACT_MEDIA_LIMIT = 6

// ─────────────────────────────────────────────────────────────────────────────
// Select strings — built from the allowlist. NEVER hand-write one, never select('*').
// ─────────────────────────────────────────────────────────────────────────────

export function impactTeamSelect(): string {
  return IMPACT_TEAM_FIELDS.join(',')
}
export function impactAchievementSelect(): string {
  return IMPACT_ACHIEVEMENT_FIELDS.join(',')
}
export function impactFulfillmentSelect(): string {
  return IMPACT_FULFILLMENT_FIELDS.join(',')
}
export function impactBenefitSelect(): string {
  return IMPACT_BENEFIT_FIELDS.join(',')
}

// ─────────────────────────────────────────────────────────────────────────────
// Output types
// ─────────────────────────────────────────────────────────────────────────────

export interface ImpactTeam {
  ftc_team_number: number | null
  team_name: string
  organization: string | null
  city: string | null
  state: string | null
  tax_status: string | null
  founded_year: number | null
  seasons_competed: number | null
  team_size: number | null
  students_reached: number | null
  events_hosted: number | null
  volunteer_hours: number | null
  tagline: string | null
  mission_statement: string | null
  outreach_summary: string | null
  logo_url: string | null
  /** Present only when the coach has affirmed the gallery contains no identifiable minors. */
  media_urls: string[]
}

export interface ImpactAchievement {
  season: string | null
  event_name: string | null
  award: string | null
  description: string | null
}

export interface ImpactFulfillment {
  amount_cents: number
  status: string
  pledged_at: string | null
  payment_received_at: string | null
  receipted_at: string | null
}

export interface ImpactBenefit {
  benefit_type: string
  status: string
  delivered_at: string | null
  proof_url: string | null
}

// Raw rows are deliberately typed loosely: a real query returns exactly the allowlisted
// columns, but a fixture (and a future schema change) may carry more, and the whole point
// of the explicit enumeration below is that extra keys are ignored rather than trusted.
type RawRow = Record<string, unknown>

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * Explicit key enumeration. A column added to `teams` next season cannot reach a report
 * through this function without someone editing it on purpose.
 */
export function projectTeam(row: RawRow): ImpactTeam {
  // Portfolio photos are opt-in and fail closed: no affirmation, no photos. The
  // affirmation is cleared automatically by a trigger whenever media_urls changes, so a
  // coach who adds a photo after affirming has to affirm again.
  const affirmed = typeof row.media_no_minors_confirmed_at === 'string' && row.media_no_minors_confirmed_at.length > 0
  const rawMedia = Array.isArray(row.media_urls) ? row.media_urls : []
  const media = affirmed
    ? rawMedia.filter((u): u is string => typeof u === 'string').slice(0, IMPACT_MEDIA_LIMIT)
    : []

  return {
    ftc_team_number: num(row.ftc_team_number),
    team_name: str(row.team_name) ?? 'Unnamed team',
    organization: str(row.organization),
    city: str(row.city),
    state: str(row.state),
    tax_status: str(row.tax_status),
    founded_year: num(row.founded_year),
    seasons_competed: num(row.seasons_competed),
    team_size: num(row.team_size),
    students_reached: num(row.students_reached),
    events_hosted: num(row.events_hosted),
    volunteer_hours: num(row.volunteer_hours),
    tagline: str(row.tagline),
    mission_statement: str(row.mission_statement),
    outreach_summary: str(row.outreach_summary),
    logo_url: str(row.logo_url),
    media_urls: media,
  }
}

export function projectAchievement(row: RawRow): ImpactAchievement {
  return {
    season: str(row.season),
    event_name: str(row.event_name),
    award: str(row.award),
    description: str(row.description),
  }
}

export function projectFulfillment(row: RawRow): ImpactFulfillment {
  return {
    amount_cents: num(row.amount_cents) ?? 0,
    status: str(row.status) ?? 'pledged',
    pledged_at: str(row.pledged_at),
    payment_received_at: str(row.payment_received_at),
    receipted_at: str(row.receipted_at),
  }
}

export function projectBenefit(row: RawRow): ImpactBenefit {
  return {
    benefit_type: str(row.benefit_type) ?? 'unknown',
    status: str(row.status) ?? 'promised',
    delivered_at: str(row.delivered_at),
    proof_url: str(row.proof_url),
  }
}

/**
 * Test-and-CI safety net. Deep-walks a payload and returns every forbidden key it finds.
 *
 * This is a second line of defence, not the first: the projections above are what
 * guarantee the output shape. This exists so a test can assert the guarantee held, and so
 * a future assembly step that bypasses a projection is caught rather than shipped.
 */
export function findForbiddenKeys(payload: unknown): string[] {
  const forbidden = new Set<string>(IMPACT_FORBIDDEN_KEYS)
  const found = new Set<string>()

  const walk = (node: unknown, depth: number) => {
    if (depth > 20 || node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1)
      return
    }
    for (const [key, value] of Object.entries(node)) {
      if (forbidden.has(key)) found.add(key)
      walk(value, depth + 1)
    }
  }

  walk(payload, 0)
  return Array.from(found).sort()
}
