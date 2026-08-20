/* eslint-disable @typescript-eslint/no-explicit-any */
//
// DEV-ONLY coach portal preview.
//
// Lets you open the entire coach portal on localhost with NO Clerk sign-in and
// NO live Supabase — every read resolves to the static fixtures below, so the
// real (production) Supabase is never touched. Purely for UI/UX + feature work.
//
// HARD SAFETY GUARD: forced OFF whenever NODE_ENV === 'production', so even if
// NEXT_PUBLIC_COACH_PREVIEW=1 leaks into a deployed build it does nothing.
//
// Launch with:  npm run dev:coach-preview
// (mirrors the existing SPONSOR_PREVIEW pattern in lib/dev-preview.ts)
//
import type { Database } from './supabase/types'
import { PREVIEW_PLACEHOLDER_IMAGE } from './dev-placeholder-image'
import type { SupabaseClient } from '@supabase/supabase-js'

type Profile = Database['public']['Tables']['profiles']['Row']

/** True only in local dev with the env flag set. Never true in production. */
export const COACH_PREVIEW =
  process.env.NODE_ENV !== 'production' &&
  process.env.NEXT_PUBLIC_COACH_PREVIEW === '1'

// ── Stable ids / timestamps ──────────────────────────────────────────────────
// The profile id doubles as teams.owner_id and notifications.recipient_id so the
// real `.eq(...)` filters in the mock client resolve correctly.
const COACH_ID = 'preview-coach-profile'
const TEAM_ID = 'preview-coach-team'
const iso = (daysAgo = 0) =>
  new Date(Date.now() - daysAgo * 86_400_000).toISOString()

// ── Coach profile the auth guards hand back under preview ────────────────────
export const mockCoachProfile = {
  id: COACH_ID,
  clerk_user_id: 'preview-clerk-coach',
  role: 'coach',
  coach_verified: true,
  full_name: 'Dev Coach',
  email: 'coach@preview.local',
  sponsor_id: null,
  coach_credentials_url: null,
  date_of_birth: '1990-04-12',
  phone_number: '(214) 555-0131',
  address_line1: '120 Robotics Way',
  city: 'Plano',
  state: 'TX',
  zip_code: '75024',
  referral_source: 'FIRST regional',
  coppa_acknowledged: true,
  tos_accepted: true,
  pending_team_data: null,
  created_at: iso(60),
  updated_at: iso(5),
} as unknown as Profile

// ── Team owned by the coach (the Portfolio) ──────────────────────────────────
const team = {
  id: TEAM_ID,
  owner_id: COACH_ID,
  team_name: 'Exodius',
  ftc_team_number: 31579,
  slug: 'exodius',
  organization: 'Plano Robotics Collective',
  city: 'Plano',
  state: 'TX',
  tagline: 'Engineering the future, one match at a time.',
  mission_statement:
    'We are a student-led FTC team building competitive robots while running STEM outreach across North Texas.',
  technical_summary:
    'Custom swerve drive, dual-motor linear lift, and a vision-assisted auto routine.',
  outreach_summary:
    'Ran 6 community workshops reaching 400+ students this season.',
  community_interest_text: 'Mentoring two new rookie teams in our district.',
  subteam_breakdown: 'Build, Programming, Outreach, Business.',
  founded_year: 2020,
  team_size: 12,
  seasons_competed: 5,
  coach_experience: '5th season mentoring FTC; software engineer and North Texas FIRST volunteer.',
  past_sponsors: ['Plano Precision Machining', 'North Texas STEM Fund'],
  press_links: [
    { label: 'Plano Star: Local robotics team mentors rookies', url: 'https://news.example/exodius' },
  ],
  community_endorsements:
    '“Exodius runs the best student workshops in our district.” — Plano ISD STEM Coordinator',
  students_reached: 400,
  events_hosted: 6,
  volunteer_hours: 220,
  sustainability_plan: 'Recurring local sponsorships and workshop fees carry the team between seasons.',
  github_link: 'https://github.com/example/exodius',
  coach_photo_url: null,
  visual_pitch_items: [],
  tax_status: '501c3',
  status: 'existing',
  public: true,
  youtube_url: null,
  logo_url: null,
  budget_items: [
    { qty: 1, label: 'CNC mill time', unit_cost_cents: 90_000, total_cents: 90_000 },
    { qty: 4, label: 'NEO motors', unit_cost_cents: 15_000, total_cents: 60_000 },
    { qty: 1, label: 'Competition travel', unit_cost_cents: 100_000, total_cents: 100_000 },
  ],
  media_urls: [],
  financial_ask_cents: 250_000,
  seed_funding_goals_cents: 500_000,
  created_at: iso(60),
  updated_at: iso(2),
}

// ── Sponsors (v_sponsors_public) ─────────────────────────────────────────────
const sponsors = [
  { id: 'sp1', company_name: 'Acme Robotics', industry: 'Manufacturing', status: 'active', funding_cap_cents: 5_000_000, funding_used_cents: 1_250_000, website: 'https://acme.example', logo_url: null },
  { id: 'sp2', company_name: 'TechNova', industry: 'Software', status: 'active', funding_cap_cents: 3_000_000, funding_used_cents: 2_700_000, website: 'https://technova.example', logo_url: null },
  { id: 'sp3', company_name: 'BrightForge Tools', industry: 'Hardware', status: 'active', funding_cap_cents: 1_500_000, funding_used_cents: 450_000, website: null, logo_url: null },
  // Fully committed — exercises the "no remaining capacity" filter path.
  { id: 'sp4', company_name: 'Quantum Dynamics', industry: 'Aerospace', status: 'active', funding_cap_cents: 2_000_000, funding_used_cents: 2_000_000, website: 'https://quantumdyn.example', logo_url: null },
]

// ── Submissions (raw dashboard shape, with nested teams/sponsors joins) ───────
function makeSubmission(id: string, over: Record<string, unknown>) {
  return {
    id,
    team_id: TEAM_ID,
    sponsor_id: 'sp1',
    status: 'pending',
    admin_feedback: null,
    season: '2025-26',
    requested_amount_cents: 250_000,
    custom_pitch_alignment:
      'Your precision-machining focus maps directly onto our build season.',
    specific_needs_statement:
      'CNC time and four NEO motors to finish the swerve modules before regionals.',
    local_connection_notes: 'Two of our mentors are alumni of your apprenticeship program.',
    created_at: iso(6),
    updated_at: iso(2),
    teams: { team_name: 'Exodius' },
    sponsors: { company_name: 'Acme Robotics' },
    ...over,
  }
}

const submissions = [
  makeSubmission('preview-sub-1', { status: 'pending', sponsor_id: 'sp1', sponsors: { company_name: 'Acme Robotics' } }),
  makeSubmission('preview-sub-2', {
    status: 'approved', sponsor_id: 'sp2', requested_amount_cents: 180_000,
    updated_at: iso(4), sponsors: { company_name: 'TechNova' },
  }),
  makeSubmission('preview-sub-3', {
    status: 'changes_requested', sponsor_id: 'sp3', requested_amount_cents: 120_000,
    admin_feedback: 'Please clarify the travel budget line item before we proceed.',
    updated_at: iso(1), sponsors: { company_name: 'BrightForge Tools' },
  }),
  makeSubmission('preview-sub-4', {
    status: 'draft', sponsor_id: 'sp1', requested_amount_cents: 90_000,
    updated_at: iso(8), sponsors: { company_name: 'Acme Robotics' },
  }),
  // Live with a sponsor — the only state in which the Q&A composer is open, so the
  // preview needs one or the thread can never be exercised (0085).
  makeSubmission('preview-sub-5', {
    status: 'dispatched', sponsor_id: 'sp4', requested_amount_cents: 140_000,
    reserved_amount_cents: 140_000, sent_at: iso(5),
    expires_at: new Date(Date.now() + 9 * 864e5).toISOString(),
    updated_at: iso(5), sponsors: { company_name: 'Quantum Dynamics' },
  }),
]

// ── Appeals (0086) ───────────────────────────────────────────────────────────
// One resolved appeal so the coach-side list, status pill and resolution card all render.
const coachAppeals = [
  {
    id: 'apl-c1', subject_type: 'submission', subject_id: 'preview-sub-3',
    appellant_profile_id: COACH_ID,
    statement: 'The travel budget was flagged as unclear, but the itemised quote was attached. Please take another look.',
    status: 'under_review', decision_at: iso(3), original_decider_id: null,
    assigned_reviewer_id: null, assigned_at: iso(1), override_reason: null,
    resolution_notes: null, resolved_by: null, resolved_at: null,
    created_at: iso(2), updated_at: iso(1),
  },
]

// ── Q&A thread (0085) ────────────────────────────────────────────────────────
// One answered exchange, one reply still in review, and one rejection the coach can see
// the reason for — the three states the coach-side thread has to render.
const submissionMessages = [
  {
    id: 'msg-1', submission_id: 'preview-sub-5', author_role: 'sponsor',
    author_profile_id: 'preview-sponsor-sp4', author_token_id: null,
    author_label: 'Lena Vogt', status: 'released',
    body: 'Does the $1,400 include the regional entry fee, or is that separate?',
    released_at: iso(4), released_by: null, rejected_reason: null,
    flagged_at: null, flagged_by: null, created_at: iso(4),
  },
  {
    id: 'msg-2', submission_id: 'preview-sub-5', author_role: 'coach',
    author_profile_id: COACH_ID, author_token_id: null,
    author_label: mockCoachProfile.full_name, status: 'released',
    body: 'Separate — the entry fee is covered by our district. The $1,400 is materials and travel only.',
    released_at: iso(3), released_by: null, rejected_reason: null,
    flagged_at: null, flagged_by: null, created_at: iso(3),
  },
  {
    id: 'msg-3', submission_id: 'preview-sub-5', author_role: 'coach',
    author_profile_id: COACH_ID, author_token_id: null,
    author_label: mockCoachProfile.full_name, status: 'pending',
    body: 'One more thing — we can send over the full parts list if that helps your team decide.',
    released_at: null, released_by: null, rejected_reason: null,
    flagged_at: null, flagged_by: null, created_at: iso(1),
  },
  {
    id: 'msg-4', submission_id: 'preview-sub-5', author_role: 'coach',
    author_profile_id: COACH_ID, author_token_id: null,
    author_label: mockCoachProfile.full_name, status: 'rejected',
    body: 'Our driver and programmer would both love to meet your engineers.',
    released_at: iso(2), released_by: null,
    rejected_reason: 'This identifies students by role. Please rewrite without referring to individual team members.',
    flagged_at: null, flagged_by: null, created_at: iso(2),
  },
]

// ── Notifications (in-app inbox) ─────────────────────────────────────────────
const notifications = [
  { id: 'ntf-1', recipient_id: COACH_ID, type: 'submission_changes_requested', title: 'Changes requested', body: 'BrightForge Tools asked for a clarification on your travel budget.', submission_id: 'preview-sub-3', read_at: null, created_at: iso(1) },
  { id: 'ntf-2', recipient_id: COACH_ID, type: 'submission_approved', title: 'Pitch approved', body: 'TechNova approved your sponsorship request. 🎉', submission_id: 'preview-sub-2', read_at: null, created_at: iso(4) },
  { id: 'ntf-3', recipient_id: COACH_ID, type: 'general', title: 'Welcome to the portal', body: 'Complete your portfolio to start pitching sponsors.', submission_id: null, read_at: null, created_at: iso(60) },
]

// ── Team achievements ────────────────────────────────────────────────────────
const teamAchievements = [
  { id: 'ach-1', team_id: TEAM_ID, event_name: 'NorCal Regional', award: 'Inspire Award – 2nd', season: '2025-26', description: 'Top-tier judged award for overall excellence.', public: true, created_at: iso(40) },
  { id: 'ach-2', team_id: TEAM_ID, event_name: 'Silicon Valley Qualifier', award: 'Winning Alliance Captain', season: '2024-25', description: null, public: true, created_at: iso(220) },
]

const payoutProfiles = [
  { id: 'pop-1', team_id: TEAM_ID, stripe_account_id: 'acct_devmock', verified_at: iso(100), created_at: iso(100) }
]

const fulfillments = [
  { id: 'f-1', sponsor_id: 'sp1', submission_id: 'preview-sub-1', team_id: TEAM_ID, amount_cents: 250_000, status: 'payment_sent', pledged_at: iso(10), payment_sent_at: iso(2), payment_method: 'check', sponsors: { company_name: 'Acme Robotics' } },
  { id: 'f-2', sponsor_id: 'sp2', submission_id: 'preview-sub-2', team_id: TEAM_ID, amount_cents: 180_000, status: 'receipted', receipt_number: 'PF-2026-000002', pledged_at: iso(30), payment_sent_at: iso(20), payment_received_at: iso(15), sponsors: { company_name: 'TechNova' } },
]

const receipts = [
  {
    id: 'rec-2',
    receipt_number: 'PF-2026-000002',
    fulfillment_id: 'f-2',
    transaction_id: 'txn-2',
    sponsor_id: 'sp2',
    team_id: TEAM_ID,
    amount_cents: 180_000,
    contribution_date: iso(15).split('T')[0],
    variant: 'charitable_501c3',
    payee_legal_name: 'Exodius Robotics Inc.',
    payee_ein_last4: '5678',
    payee_tax_classification: '501c3_org',
    sponsor_legal_name: 'TechNova',
    document_html: '<div style="padding: 24px;"><h1>Contribution acknowledgment</h1><p>Exodius Robotics Inc. (EIN 98-7654321) acknowledges receipt of $1,800.00 from TechNova.</p><p><strong>No goods or services were provided by Exodius Robotics Inc. in exchange for this contribution.</strong></p></div>',
    document_sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    copy_version: '2026-08-v1',
    copy_reviewed_at: null,
    status: 'issued',
    issued_at: iso(15),
    teams: { team_name: 'Exodius' }
  }
]

function makeSignature(id: string, submissionId: string, role: 'sponsor' | 'coach', over: Record<string, unknown>) {
  return {
    id,
    template_id: 'agr-1',
    template_key: 'sponsorship_agreement',
    template_version: 1,
    signer_role: role,
    submission_id: submissionId,
    team_id: TEAM_ID,
    entity_snapshot: { team_number: team.ftc_team_number, team_name: team.team_name, team_organization: team.organization, sponsor_company_name: 'Acme Robotics', amount_cents: 250_000 },
    typed_name: role === 'coach' ? mockCoachProfile.full_name : 'Dana Cole',
    signed_at: iso(role === 'coach' ? 1 : 2),
    ip_address: role === 'coach' ? '203.0.113.42' : '203.0.113.10',
    user_agent: 'Mozilla/5.0 (dev preview)',
    document_hash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    document_storage_path: `preview/${id}.html`,
    consent_text_version: 1,
    consent_text_hash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    created_at: iso(role === 'coach' ? 1 : 2),
    ...over,
  }
}

const agreementSignatures = [
  makeSignature('00000000-0000-4000-8000-000000000201', 'preview-sub-1', 'sponsor', { sponsor_id: 'sp1', signer_profile_id: 'preview-sponsor-sp1', signer_legal_name: 'Dana Cole', signer_email: 'dana@acmerobotics.com' }),
  makeSignature('00000000-0000-4000-8000-000000000202', 'preview-sub-1', 'coach', { sponsor_id: 'sp1', signer_profile_id: COACH_ID, signer_legal_name: mockCoachProfile.full_name, signer_email: mockCoachProfile.email }),
  makeSignature('00000000-0000-4000-8000-000000000203', 'preview-sub-2', 'sponsor', { sponsor_id: 'sp2', signer_profile_id: 'preview-sponsor-sp2', signer_legal_name: 'Wei Chen', signer_email: 'wei@technova.io' }),
  makeSignature('00000000-0000-4000-8000-000000000204', 'preview-sub-2', 'coach', { sponsor_id: 'sp2', signer_profile_id: COACH_ID, signer_legal_name: mockCoachProfile.full_name, signer_email: mockCoachProfile.email }),
]

const teamVerificationRecords = [
  {
    id: 'tvr-preview-1', team_id: TEAM_ID, profile_id: COACH_ID, ftc_team_number: team.ftc_team_number,
    claimed_team_name: team.team_name, claimed_organization: team.organization,
    official_team_name: team.team_name, official_organization: team.organization,
    source: 'first_api', name_score: 1, organization_score: 1, confidence: 1,
    outcome: 'auto_pass', override_reason: null, overridden_by: null, overridden_at: null,
    checked_at: iso(2),
  },
]

// One Silver award with three benefits: one delivered with proof, one voided by an admin
// (so the re-upload state is browsable), one still promised.
const recognitionAwards = [
  {
    id: 'award-preview-1',
    fulfillment_id: 'ff-preview-1',
    sponsor_id: sponsors[0].id,
    team_id: TEAM_ID,
    amount_cents: 300000,
    tier_id: 'tier-silver',
    tier_name_snapshot: 'Silver',
    tier_rank_snapshot: 2,
    tier_min_amount_cents_snapshot: 250000,
    benefits_snapshot: ['logo_on_website', 'social_media_mention', 'logo_on_team_shirt'],
    awarded_at: iso(18),
    created_at: iso(18),
    updated_at: iso(3),
    recognition_benefit_deliveries: [
      {
        id: 'del-preview-1', award_id: 'award-preview-1', benefit_type: 'logo_on_website',
        status: 'delivered',
        proof_url: PREVIEW_PLACEHOLDER_IMAGE,
        proof_uploaded_at: iso(3), no_minors_confirmed_at: iso(3), delivered_at: iso(3),
        coach_note: null, admin_voided_at: null, admin_void_reason: null,
        created_at: iso(18), updated_at: iso(3),
      },
      {
        id: 'del-preview-2', award_id: 'award-preview-1', benefit_type: 'logo_on_team_shirt',
        status: 'in_progress',
        proof_url: null, proof_uploaded_at: null, no_minors_confirmed_at: null, delivered_at: null,
        coach_note: null, admin_voided_at: iso(1),
        admin_void_reason: 'A student was visible in the background. Please reshoot the shirt on its own.',
        created_at: iso(18), updated_at: iso(1),
      },
      {
        id: 'del-preview-3', award_id: 'award-preview-1', benefit_type: 'social_media_mention',
        status: 'promised',
        proof_url: null, proof_uploaded_at: null, no_minors_confirmed_at: null, delivered_at: null,
        coach_note: null, admin_voided_at: null, admin_void_reason: null,
        created_at: iso(18), updated_at: iso(18),
      },
    ],
  },
]

const DATA: Record<string, any[]> = {
  profiles: [mockCoachProfile as any],
  teams: [team],
  sponsors,
  v_sponsors_public: sponsors,
  submissions,
  notifications,
  team_achievements: teamAchievements,
  team_payout_profiles: payoutProfiles,
  funding_fulfillments: fulfillments,
  funding_receipts: receipts,
  agreement_signatures: agreementSignatures,
  team_verification_records: teamVerificationRecords,
  submission_messages: submissionMessages,
  appeals: coachAppeals,
  sponsor_recognition_awards: recognitionAwards,
  recognition_benefit_deliveries: recognitionAwards.flatMap(
    (a: any) => a.recognition_benefit_deliveries
  ),
  audit_log: [],
}

// ── Minimal in-memory query builder mimicking the supabase-js fluent API ──────
// Filters/order/limit are honoured so `.eq('owner_id', ...)`, `.is('read_at', null)`,
// count/head, and single/maybeSingle all behave like the real client.
class MockQuery implements PromiseLike<any> {
  private filters: ((r: any) => boolean)[] = []
  private orderBy?: { col: string; asc: boolean }
  private limitN?: number
  private wantCount = false
  private head = false
  private singleRow = false
  private inserted?: any[]

  constructor(private table: string) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (opts?.count) this.wantCount = true
    if (opts?.head) this.head = true
    return this
  }
  insert(payload: any) { this.inserted = Array.isArray(payload) ? payload : [payload]; return this }
  update(_p: any) { return this }
  delete() { return this }
  upsert(payload: any) { this.inserted = Array.isArray(payload) ? payload : [payload]; return this }

  eq(col: string, val: any) { this.filters.push((r) => r[col] === val); return this }
  neq(col: string, val: any) { this.filters.push((r) => r[col] !== val); return this }
  in(col: string, vals: any[]) { this.filters.push((r) => vals.includes(r[col])); return this }
  gte(col: string, val: any) { this.filters.push((r) => r[col] >= val); return this }
  lte(col: string, val: any) { this.filters.push((r) => r[col] <= val); return this }
  gt(col: string, val: any) { this.filters.push((r) => r[col] > val); return this }
  lt(col: string, val: any) { this.filters.push((r) => r[col] < val); return this }
  is(col: string, val: any) { this.filters.push((r) => (r[col] ?? null) === val); return this }
  not(col: string, op: string, val: any) {
    if (op === 'is' && val === null) this.filters.push((r) => r[col] != null)
    return this
  }
  like() { return this }
  ilike() { return this }
  or() { return this }
  contains() { return this }
  overlaps() { return this }
  order(col: string, opts?: { ascending?: boolean }) { this.orderBy = { col, asc: opts?.ascending ?? true }; return this }
  limit(n: number) { this.limitN = n; return this }
  range(from: number, to: number) { this.limitN = to - from + 1; return this }

  single() { this.singleRow = true; return this.resolve() }
  maybeSingle() { this.singleRow = true; return this.resolve() }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.resolve().then(onfulfilled, onrejected)
  }

  private async resolve() {
    if (this.inserted) {
      const rows = this.inserted.map((r, i) => ({ id: r.id ?? `mock-${i}`, ...r }))
      return { data: this.singleRow ? rows[0] ?? null : rows, error: null, count: rows.length }
    }
    let rows = (DATA[this.table] ?? []).slice()
    for (const f of this.filters) rows = rows.filter(f)
    const count = rows.length
    if (this.orderBy) {
      const { col, asc } = this.orderBy
      rows.sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1))
    }
    if (this.limitN != null) rows = rows.slice(0, this.limitN)
    if (this.head) return { data: null, error: null, count }
    if (this.singleRow) return { data: rows[0] ?? null, error: null, count }
    return { data: rows, error: null, count: this.wantCount ? count : null }
  }
}

/**
 * Stand-in Supabase client reading/writing only the canned datasets above.
 * Covers the fluent query API plus no-op storage (upload + public/signed URLs)
 * so the portfolio media uploader doesn't reach real storage in preview.
 */
export function createMockCoachClient(): SupabaseClient<Database> {
  return {
    from: (table: string) => new MockQuery(table),
    rpc: async () => ({ data: null, error: null }),
    storage: {
      from: () => ({
        upload: async () => ({ data: { path: 'dev-mock' }, error: null }),
        getPublicUrl: () => ({ data: { publicUrl: '#dev-mock' } }),
        createSignedUrl: async () => ({ data: { signedUrl: '#dev-mock' }, error: null }),
        remove: async () => ({ data: [], error: null }),
        // See dev-bypass: the retention purge lists a prefix before deleting it.
        list: async () => ({ data: [], error: null }),
      }),
    },
  } as unknown as SupabaseClient<Database>
}
