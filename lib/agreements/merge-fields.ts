// The single source of truth for merge fields a template body may reference.
// A template may reference ONLY these keys; anything else is rejected at save
// time (validateTemplateBody) and at render time (renderAgreement).
export const MERGE_FIELDS = {
  platform_name:          { label: 'Platform name',           example: 'FTC Pitfund' },
  platform_contact_email: { label: 'Platform contact email',  example: 'support@ftcpitfund.example' },
  agreement_date:         { label: 'Agreement date (UTC)',    example: '2026-08-09' },
  sponsor_company_name:   { label: 'Sponsor company name',    example: 'Acme Robotics, Inc.' },
  sponsor_contact_name:   { label: 'Sponsor signatory name',  example: 'Dana Whitfield' },
  sponsor_contact_email:  { label: 'Sponsor contact email',   example: 'dana@acme.example' },
  team_number:            { label: 'FTC team number',         example: '14821' },
  team_name:              { label: 'Team name',               example: 'Iron Kestrels' },
  team_organization:      { label: 'Team organization',       example: 'Northgate High School' },
  // Populated from the payout profile's legal_payee_name in prompt 06, falling back to
  // teams.organization. Declared here only — this slice does not import prompt 02 code.
  team_legal_payee_name:  { label: 'Legal payee name',        example: 'Northgate HS Robotics Boosters' },
  team_city:              { label: 'Team city',               example: 'Dayton' },
  team_state:             { label: 'Team state',              example: 'OH' },
  season:                 { label: 'Competition season',      example: '2026–2027' },
  amount_formatted:       { label: 'Sponsorship amount',      example: '$12,500.00' },
} as const

export type MergeFieldKey = keyof typeof MERGE_FIELDS
export type MergeContext = Record<MergeFieldKey, string>

export const MERGE_FIELD_KEYS = Object.keys(MERGE_FIELDS) as MergeFieldKey[]

export function isMergeFieldKey(key: string): key is MergeFieldKey {
  return Object.prototype.hasOwnProperty.call(MERGE_FIELDS, key)
}

/** The registry's example values, usable as a MergeContext for previews and specimens. */
export function exampleMergeContext(): MergeContext {
  const ctx = {} as MergeContext
  for (const key of MERGE_FIELD_KEYS) {
    ctx[key] = MERGE_FIELDS[key].example
  }
  return ctx
}
