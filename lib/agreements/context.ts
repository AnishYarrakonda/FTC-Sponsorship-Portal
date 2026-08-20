import type { createAdminClient } from '@/lib/supabase/admin'
import { SUPPORT_EMAIL } from '@/lib/site-config'
import { MergeContext } from './merge-fields'
import { MissingMergeFieldError } from './render'

type AdminClient = ReturnType<typeof createAdminClient>

// The only permitted keys in agreement_signatures.entity_snapshot (COPPA: no student
// names, no roster data, no minor's identity, ever). Adding a key here is a decision
// that must be re-justified against that rule, not a routine edit.
export interface EntitySnapshot {
  team_number: number | null
  team_name: string
  team_organization: string | null
  sponsor_company_name: string
  amount_cents: number
}

export interface SubmissionAgreementContext {
  mergeContext: MergeContext
  entitySnapshot: EntitySnapshot
  title: string
  submissionId: string
  sponsorId: string
  teamId: string
  teamOwnerId: string
}

function formatAmount(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

// submissions.season is not written by any current write path (checked: no INSERT/UPDATE
// sets it anywhere in app/), so it is always null/empty in practice. Derive the FTC
// competition season (Sept–Aug) from the same pinned agreementDate used elsewhere rather
// than trusting a column nothing populates — real DB value still wins if it's ever set.
function deriveFtcSeason(dateIso: string): string {
  const year = Number(dateIso.slice(0, 4))
  const month = Number(dateIso.slice(5, 7))
  return month >= 9 ? `${year}-${year + 1}` : `${year - 1}-${year}`
}

/**
 * Builds the MergeContext (and the denormalised entity_snapshot) for a specific
 * submission's sponsorship agreement. Deterministic given the same underlying rows: the
 * only "now"-derived value is agreement_date, pinned once per call in UTC so it does not
 * depend on process.env.TZ. Throws MissingMergeFieldError naming `team_legal_payee_name`
 * if the team has no legal payee name on file — never substitute a blank, a dash, or the
 * field name for that value (a silently blank payee line in an executed agreement is the
 * exact failure mode this guards against).
 */
export async function buildSubmissionAgreementContext(
  adminClient: AdminClient,
  submissionId: string
): Promise<SubmissionAgreementContext> {
  const { data: submission, error: submissionError } = await adminClient
    .from('submissions')
    .select('id, sponsor_id, team_id, reserved_amount_cents, season')
    .eq('id', submissionId)
    .single()
  if (submissionError || !submission) {
    throw new Error('submission_not_found')
  }

  const { data: team, error: teamError } = await adminClient
    .from('teams')
    .select('id, team_name, ftc_team_number, organization, city, state, owner_id')
    .eq('id', submission.team_id)
    .single()
  if (teamError || !team) {
    throw new Error('team_not_found')
  }

  const { data: sponsor, error: sponsorError } = await adminClient
    .from('sponsors')
    .select('id, company_name, contact_name, contact_email')
    .eq('id', submission.sponsor_id)
    .single()
  if (sponsorError || !sponsor) {
    throw new Error('sponsor_not_found')
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: payout } = await (adminClient as any)
    .from('team_payout_profiles')
    .select('legal_payee_name')
    .eq('team_id', team.id)
    .maybeSingle()

  const legalPayeeName: string =
    (payout?.legal_payee_name as string | undefined)?.trim() || (team.organization ?? '').trim()

  if (!legalPayeeName) {
    throw new MissingMergeFieldError(['team_legal_payee_name'])
  }

  const agreementDate = new Date().toISOString().slice(0, 10)
  const amountFormatted = formatAmount(submission.reserved_amount_cents)

  const mergeContext: MergeContext = {
    platform_name: 'FTC Pitfund',
    platform_contact_email: SUPPORT_EMAIL,
    agreement_date: agreementDate,
    sponsor_company_name: sponsor.company_name,
    sponsor_contact_name: sponsor.contact_name ?? '',
    sponsor_contact_email: sponsor.contact_email ?? '',
    team_number: team.ftc_team_number != null ? String(team.ftc_team_number) : '',
    team_name: team.team_name,
    team_organization: team.organization ?? '',
    team_legal_payee_name: legalPayeeName,
    team_city: team.city ?? '',
    team_state: team.state ?? '',
    season: submission.season?.trim() || deriveFtcSeason(agreementDate),
    amount_formatted: amountFormatted,
  }

  const entitySnapshot: EntitySnapshot = {
    team_number: team.ftc_team_number ?? null,
    team_name: team.team_name,
    team_organization: team.organization ?? null,
    sponsor_company_name: sponsor.company_name,
    amount_cents: submission.reserved_amount_cents,
  }

  return {
    mergeContext,
    entitySnapshot,
    title: `FTC Team Sponsorship Agreement — ${team.team_name} × ${sponsor.company_name}`,
    submissionId: submission.id,
    sponsorId: submission.sponsor_id,
    teamId: submission.team_id,
    teamOwnerId: team.owner_id,
  }
}
